"""Rebuild the retrospective 2025 auction estimates from public inputs."""
import argparse
import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from zipfile import ZipFile

import numpy as np
import pandas as pd
import xgboost as xgb

from .train_predictor import FEATURE_PATH, ROOT

REGISTRY = ROOT / "data/raw/ipl_auctions/registered_auction_pool_2025.csv"
OUTCOMES = ROOT / "data/processed/standardized_2025_auction.csv"
ESTIMATES = ROOT / "data/processed/pool_estimates_2025.csv"
RETAINED_FORM = ROOT / "data/processed/retained_form_2025.csv"
CUTOFF = date(2024, 11, 24)
RECENT_START = date(2023, 11, 24)
DEATH_WICKETS = {"bowled", "caught", "caught and bowled", "lbw", "stumped", "hit wicket"}
PHASES = ("powerplay", "middle", "death")
NAME_ALIASES = {
    "ravichandaranashwin": "ravichandranashwin",
    "manyanthkumarl": "manvanthkumarl",
    "shahbazahamad": "shahbazahmad",
    "venkatasatyanarayanapemnetsa": "venkatasatyanarayanapenmetsa",
}


def name_key(name):
    normalized = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    key = re.sub(r"[^a-z0-9]", "", normalized.casefold())
    return NAME_ALIASES.get(key, key)


def unique_index(pairs):
    index = defaultdict(set)
    for key, value in pairs:
        if key and value:
            index[key].add(value)
    return {key: next(iter(values)) for key, values in index.items() if len(values) == 1}


def load_stats(match_files, people, names=None):
    aliases = []
    with people.open(encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            for column in ("name", "unique_name"):
                aliases.append((name_key(row[column]), row["identifier"]))
    if names:
        with names.open(encoding="utf-8-sig", newline="") as source:
            aliases.extend((name_key(row["name"]), row["identifier"]) for row in csv.DictReader(source))
    totals = defaultdict(Counter)
    match_count = set()
    for file in match_files:
        with ZipFile(file) as archive:
            for filename in archive.namelist():
                if not filename.endswith(".json") or filename in match_count:
                    continue
                match = json.loads(archive.read(filename))
                info = match["info"]
                started = date.fromisoformat(info["dates"][0])
                if info.get("match_type") != "T20" or not RECENT_START <= started < CUTOFF:
                    continue
                match_count.add(filename)
                identifiers = info["registry"]["people"]
                aliases.extend((name_key(name), identifier) for name, identifier in identifiers.items())
                for innings in match["innings"]:
                    if innings.get("super_over"):
                        continue
                    for over in innings["overs"]:
                        phase = "powerplay" if over["over"] < 6 else "death" if over["over"] >= 15 else "middle"
                        for ball in over["deliveries"]:
                            batter = totals[identifiers[ball["batter"]]]
                            bowler = totals[identifiers[ball["bowler"]]]
                            extras = ball.get("extras", {})
                            if not extras.get("wides"):
                                batter[f"{phase}_bat_balls"] += 1
                                batter[f"{phase}_runs"] += ball["runs"]["batter"]
                            bowler[f"{phase}_bowl_balls"] += int(not (extras.get("wides") or extras.get("noballs")))
                            bowler[f"{phase}_conceded"] += ball["runs"]["total"] - extras.get("byes", 0) - extras.get("legbyes", 0) - extras.get("penalty", 0)
                            bowler[f"{phase}_wickets"] += sum(w["kind"] in DEATH_WICKETS for w in ball.get("wickets", []))
    return unique_index(aliases), totals, len(match_count)


def write_retained_form(ids, stats, columns):
    retained = pd.read_csv(REGISTRY.with_name("squads_2024.csv"))
    names = retained.player_name.map(name_key)
    rows = []
    for key in names:
        counts = stats.get(ids.get(key))
        if counts:
            rows.append({"key": key, **{column: counts[column] for column in columns}})
    pd.DataFrame(rows, columns=["key", *columns]).to_csv(RETAINED_FORM, index=False)


def pool_frame(match_files, people, names=None):
    frame = pd.read_csv(REGISTRY, dtype={"registration_id": str})
    frame["key"] = frame.player_name.map(name_key)
    ids, stats, match_count = load_stats(match_files, people, names)
    keys = frame["key"].where(~frame["key"].duplicated(keep=False))
    frame["cricsheet_id"] = keys.map(ids)
    frame.loc[frame.cricsheet_id.duplicated(keep=False), "cricsheet_id"] = None
    stat_columns = []
    for phase in PHASES:
        for metric in ("bat_balls", "runs", "bowl_balls", "conceded", "wickets"):
            name = f"{phase}_{metric}"
            stat_columns.append(name)
            frame[name] = frame.cricsheet_id.map({
                identifier: counts[name] for identifier, counts in stats.items()
            })
    frame["recent_runs"] = frame[[f"{p}_runs" for p in ("powerplay", "middle", "death")]].sum(axis=1, min_count=1)
    frame["recent_wickets"] = frame[[f"{p}_wickets" for p in ("powerplay", "middle", "death")]].sum(axis=1, min_count=1)
    history = pd.read_csv(FEATURE_PATH)
    history = history[(history.auction_year < 2025) & (history.sold_price_crore > 0)].copy()
    history["key"] = history.player_name.map(name_key)
    history = history[~history.duplicated(["auction_year", "canonical_id"], keep=False)]
    history = history[~history.duplicated(["auction_year", "key"], keep=False)]
    last = history.sort_values("auction_year").drop_duplicates("key", keep="last").set_index("key")
    frame["prior_sale_cr"] = keys.map(last.sold_price_crore)
    frame["prior_sale_year"] = keys.map(last.auction_year)
    outcomes = pd.read_csv(OUTCOMES)
    outcomes["key"] = outcomes.player_name.str.replace(r"\s+\(R\)$", "", regex=True).map(name_key)
    if outcomes.key.duplicated().any():
        raise ValueError("Auction outcomes contain ambiguous names.")
    outcomes_by_name = outcomes.set_index("key").price_in_crores
    frame["sold_price"] = keys.map(outcomes_by_name)
    # The 2025 sale is for the left-arm seamer (registration 220), not the namesake.
    frame.loc[frame.registration_id.eq("220") & frame.key.eq("akashsingh"), "sold_price"] = outcomes_by_name["akashsingh"]
    if frame.sold_price.count() != 182 or not np.isclose(frame.sold_price.sum(), 639.15):
        raise ValueError("Auction outcomes do not reconcile to the official 182 sales and ₹639.15 crore.")
    write_retained_form(ids, stats, stat_columns)
    print(f"{len(frame)} registrations, {frame.cricsheet_id.notna().sum()} unique IDs, {frame.recent_runs.notna().sum()} with form from {match_count} fixtures.")
    return frame


def model_inputs(frame, form):
    """Use reserve and published lot position, plus shrunk rates for pricing."""
    numeric = ["reserve_price", "age", "ipl_matches", "prior_sale_cr", "prior_sale_year"]
    demand = frame[numeric].apply(pd.to_numeric, errors="coerce")
    demand = demand.join(pd.get_dummies(frame[["role", "cap_status"]], dtype=int))
    demand["overseas"] = frame.country.ne("India").astype(int)
    demand["marquee"] = frame.set_code.isin(["M1", "M2"]).astype(int)
    demand["set_order"] = np.log1p(frame.set_name)
    demand["registered_prev"] = frame.previous_team.notna().astype(int)
    pricing = demand.join(frame[form])
    for phase in PHASES:
        pricing[f"{phase}_sr_pct"] = 100 * (frame[f"{phase}_runs"] + 24) / (frame[f"{phase}_bat_balls"] + 20)
        pricing[f"{phase}_econ"] = 6 * (frame[f"{phase}_conceded"] + 24) / (frame[f"{phase}_bowl_balls"] + 18)
        pricing[f"{phase}_strike_wickets"] = (frame[f"{phase}_wickets"] + 0.75) / (frame[f"{phase}_bowl_balls"] + 18)
    return demand, pricing


def comparable_prices(frame, reserve, priced, test, quantiles):
    """Estimate conditional price premiums from comparable sold lots in the training sets."""
    stage = np.log(frame.set_name.to_numpy())
    role = frame.role.to_numpy()
    overseas = frame.country.ne("India").to_numpy()
    capped = frame.cap_status.eq("Capped").to_numpy()
    prior = np.log1p(frame.prior_sale_cr.fillna(0).to_numpy())
    experience = np.log1p(frame.ipl_matches.fillna(0).to_numpy())
    observed = np.log(frame.sold_price[priced].to_numpy() / reserve[priced])
    order = observed.argsort()
    result = []
    for i in np.flatnonzero(test):
        distances = (
            1.5 * abs(stage[priced] - stage[i])
            + 0.8 * abs(np.log(reserve[priced] / reserve[i]))
            + 1.15 * (capped[priced] != capped[i])
            + 0.5 * (role[priced] != role[i])
            + 0.3 * (overseas[priced] != overseas[i])
            + 0.3 * abs(prior[priced] - prior[i])
            + 0.15 * abs(experience[priced] - experience[i])
        )
        weights = np.exp(-2 * distances[order])
        cumulative = (weights.cumsum() - 0.5 * weights) / weights.sum()
        result.append(reserve[i] * np.exp(np.interp(quantiles, cumulative, observed[order])))
    return np.asarray(result)


def fit_pool(frame):
    form = [column for column in frame if column.startswith(("powerplay_", "middle_", "death_", "recent_"))]
    demand, pricing = model_inputs(frame, form)
    reserve = frame.reserve_price.to_numpy()
    sold = frame.sold_price.notna()
    groups = {group: index % 5 for index, group in enumerate(frame.set_code.unique())}
    fold = frame.set_code.map(groups)
    probability = np.zeros(len(frame))
    ranges = np.zeros((len(frame), 3))
    quantiles = [0.2, 0.5, 0.8]
    options = dict(n_estimators=120, max_depth=2, learning_rate=0.04, min_child_weight=5, reg_lambda=3, n_jobs=2, random_state=42)
    for i in range(5):
        train = fold.ne(i)
        test = ~train
        classifier = xgb.XGBClassifier(**options)
        classifier.fit(demand[train], sold[train])
        probability[test] = classifier.predict_proba(demand[test])[:, 1]
        priced = train & sold
        for column, alpha in enumerate(quantiles):
            estimator = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=alpha, **options)
            estimator.fit(pricing[priced], np.log(frame.sold_price[priced] / reserve[priced]))
            ranges[test, column] = reserve[test] * np.exp(estimator.predict(pricing[test]))
        # Comparable sales stabilize the tail when a set has few similar stars.
        folded_ranges = np.sort(np.maximum(ranges[test], reserve[test, None]), axis=1)
        ranges[test] = 0.25 * folded_ranges + 0.75 * comparable_prices(frame, reserve, priced, test, quantiles)
    ranges = np.sort(np.maximum(ranges, reserve[:, None]), axis=1)
    output = frame[["registration_id", "cricsheet_id", "prior_sale_cr", "prior_sale_year", *form]].copy()
    output["sale_probability"] = probability
    output[["price_p20_cr", "price_p50_cr", "price_p80_cr"]] = ranges
    output.round(5).to_csv(ESTIMATES, index=False)
    actual = frame.sold_price[sold].to_numpy()
    bounds = ranges[sold]
    premium = actual >= 8
    covered = (bounds[:, 0] <= actual) & (actual <= bounds[:, 2])
    error = bounds[:, 1] - actual
    print(f"Set-held-out Brier {np.mean((probability - sold.to_numpy()) ** 2):.3f}; median price MAE {np.mean(abs(bounds[:, 1] - actual)):.2f} Cr; P20–P80 coverage {np.mean((bounds[:, 0] <= actual) & (actual <= bounds[:, 2])):.1%}.")
    print(f"Premium sales (≥8 Cr): MAE {np.mean(abs(error[premium])):.2f} Cr; signed error {np.mean(error[premium]):+.2f} Cr; P20–P80 coverage {covered[premium].mean():.1%} ({premium.sum()} players).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--people", type=Path, required=True)
    parser.add_argument("--names", type=Path)
    parser.add_argument("matches", nargs="+", type=Path)
    args = parser.parse_args()
    fit_pool(pool_frame(args.matches, args.people, args.names))


if __name__ == "__main__":
    main()
