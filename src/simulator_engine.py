import csv
from collections import Counter
from dataclasses import dataclass
from itertools import groupby
from random import Random
from time import monotonic

import numpy as np
import pandas as pd
import xgboost as xgb

from .train_predictor import FEATURE_COLUMNS, FEATURE_PATH, METRICS, MODEL_PATH, ROLE_COLUMNS, ROOT
from .rebuild_pool import ESTIMATES, RETAINED_FORM, name_key
from .team_strategy import playing_quality, primary_skill, projected_xi, secondary_skills, xi_fit


TEAMS = {
    "CSK": ("Chennai Super Kings", "international_prestige_score", 1.35, "AR"),
    "DC": ("Delhi Capitals", "recent_wickets", 1.25, "WK"),
    "GT": ("Gujarat Titans", "career_economy", 1.30, "AR"),
    "KKR": ("Kolkata Knight Riders", "recent_strike_rate", 1.30, "AR"),
    "LSG": ("Lucknow Super Giants", "career_strike_rate", 1.25, "BOWL"),
    "MI": ("Mumbai Indians", "peak_season_wickets", 1.30, "BOWL"),
    "PBKS": ("Punjab Kings", "recent_runs", 1.25, "BAT"),
    "RR": ("Rajasthan Royals", "career_economy", 1.25, "BOWL"),
    "RCB": ("Royal Challengers Bengaluru", "career_runs", 1.40, "BAT"),
    "SRH": ("Sunrisers Hyderabad", "peak_season_runs", 1.35, "BAT"),
}
DATA = ROOT / "data/raw/ipl_auctions"
PURSE = 12000
OPENING_PAUSE = 2.4
CALL_PAUSE = 4.0
ACCELERATED_OPENING_PAUSE = 1.35
ACCELERATED_CALL_PAUSE = 2.35
NOMINATION_LIMIT = 10
RTM_SECONDS = 30
SQUAD_LIMIT = 25
MIN_SQUAD = 18
OVERSEAS_LIMIT = 8
RETENTION_SLABS = (1800, 1400, 1100, 1800, 1400)
UNCAPPED_RETAINEES = {
    "MS Dhoni", "Abishek Porel", "Rahul Tewatia", "Shahrukh Khan", "Harshit Rana",
    "Ramandeep Singh", "Mohsin Khan", "Ayush Badoni", "Shashank Singh",
    "Prabhsimran Singh", "Yash Dayal", "Sandeep Sharma",
}
RETAINED_SPINNERS = {
    "Ravindra Jadeja", "Axar Patel", "Rashid Khan", "Kuldeep Yadav",
    "Ravi Bishnoi", "Varun Chakaravarthy", "Sunil Narine",
}


@dataclass(frozen=True)
class MarketTuning:
    marquee: tuple[float, float] = (1.38, 1.01)
    capped_pace: float = 1.32
    first_nominations: int = 40
    second_nominations: int = 18
    late_interest: float = 0.10
    slot_budget: bool = True
    depth_target: int = 23
    accelerated_purse_share: float = 0.25
    capped_top_order: float = 0.62
    late_budget_pressure: float = 0.75


def retention_deduction(roster):
    capped = [p["price"] for p in roster if not p["uncapped"]]
    return max(sum(capped), sum(RETENTION_SLABS[:len(capped)])) + sum(
        max(400, p["price"]) for p in roster if p["uncapped"]
    )


def read_rows(filename):
    with (DATA / filename).open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def next_price(price):
    return price + (5 if price < 100 else 10 if price < 200 else 20 if price < 500 else 25)


def set_category(code):
    if code == "Released retentions" or code.startswith("Accelerated"):
        return code
    prefix = code.rstrip("0123456789")
    if prefix == "M":
        return "Marquee players"
    group = "Uncapped" if prefix.startswith("U") else "Capped"
    roles = {"BA": "batters", "AL": "all-rounders", "WK": "wicketkeepers", "SP": "spinners", "FA": "fast bowlers"}
    return f"{group} {roles.get(prefix[1:] if group == 'Uncapped' else prefix, 'players')}"


@dataclass
class Catalog:
    players: list
    retained: dict

    @classmethod
    def load(cls):
        retained = {code: [] for code in TEAMS}
        codes = {details[0].upper(): code for code, details in TEAMS.items()}
        for row in read_rows("squads_2024.csv"):
            retained[codes[row["team_name"]]].append({
                "name": row["player_name"], "role": row["role"],
                "overseas": row["nationality"] == "Overseas",
                "price": round(float(row["cost"]) * 100), "retained": True,
                "uncapped": row["player_name"] in UNCAPPED_RETAINEES,
                "bowling_style": "spin" if row["player_name"] in RETAINED_SPINNERS else "",
            })

        pool = read_rows("registered_auction_pool_2025.csv")
        # Published top buys from https://www.iplt20.com/auction/2024.
        official_prior = {
            name_key(row["player_name"]): float(row["price_crore"])
            for row in read_rows("official_2024_top_sales.csv")
        }
        forecasts = {
            row["registration_id"]: row for row in pd.read_csv(
                ESTIMATES, dtype={"registration_id": str}
            ).to_dict("records")
        } if ESTIMATES.is_file() else {}
        features = pd.read_csv(FEATURE_PATH)
        current = features.loc[features.auction_year == 2025].drop_duplicates("canonical_id", keep=False).copy()
        current["key"] = current.player_name.map(name_key)
        current = current.drop_duplicates("key", keep=False).set_index("key")
        pool_names = Counter(name_key(row["player_name"]) for row in pool)
        matched = []
        players = []
        for row in pool:
            key = name_key(row["player_name"])
            role = "WK" if key == "rishabhpant" else row["role"]
            overseas = row["country"] != "India"
            registration_id = row["registration_id"]
            estimate = forecasts.get(registration_id, {})
            form = {k: v for k, v in estimate.items() if k.startswith(("death_", "middle_", "powerplay_", "recent_")) and pd.notna(v)}
            prior = estimate.get("prior_sale_cr")
            prior_year = estimate.get("prior_sale_year")
            if pool_names[key] == 1 and key in official_prior:
                prior, prior_year = official_prior[key], 2024
            player = {
                "id": registration_id,
                "name": row["player_name"], "role": role, "country": row["country"],
                "overseas": overseas, "set": row["set_name"],
                "set_code": row.get("set_code") or row["set_name"],
                "reserve": round(float(row["reserve_price"]) * 100),
                "valuation": None, "preferences": [],
                "stats": None,
                "previous": row["previous_team"] or None,
                "rtm_team": row["rtm_team"] or None,
                "uncapped": row["cap_status"] == "Uncapped" and not overseas,
                "bowling_style": row["bowling_style"],
                "form": form,
                "prior_sale": round(prior * 100) if pd.notna(prior) else None,
                "prior_sale_year": int(prior_year) if pd.notna(prior_year) else None,
                "sale_probability": estimate.get("sale_probability"),
                "price_range": [round(estimate[f"price_p{i}_cr"] * 100) for i in (20, 50, 80)] if estimate else None,
            }
            player["skill"] = primary_skill(player)
            player["secondary_skills"] = secondary_skills(player)
            player["quality"] = playing_quality(player)
            player["market_value"] = player["price_range"][1] if estimate else player["reserve"]
            players.append(player)
            if pool_names[key] == 1 and key in current.index:
                feature = current.loc[key].copy()
                feature["is_overseas"] = int(overseas)
                feature[ROLE_COLUMNS] = [int(column == f"role_{role}") for column in ROLE_COLUMNS]
                matched.append((player, feature))

        if matched:
            model = xgb.XGBRegressor(n_jobs=2)
            model.load_model(MODEL_PATH)
            inputs = pd.DataFrame([feature for _, feature in matched])[FEATURE_COLUMNS].astype(float)
            predicted = np.maximum(0, np.expm1(model.predict(inputs)))
            historical = features.loc[features.auction_year < 2025]
            thresholds = {
                code: historical.loc[historical[f"role_{role}"] == 1, metric].quantile(0.69)
                for code, (_, metric, _, role) in TEAMS.items()
            }
            for (player, feature), value in zip(matched, predicted):
                player["valuation"] = round(float(value) * 100)
                player["stats"] = {
                    metric: round(float(feature[metric]), 2)
                    for metric in [*METRICS, "career_matches", "recent_matches"]
                    if pd.notna(feature.get(metric))
                }
                # Original franchise preferences use peer percentiles from historical sales.
                for code, (_, metric, _, role) in TEAMS.items():
                    if player["role"] == role and feature[metric] > thresholds[code]:
                        player["preferences"].append(code)
        retained_form = pd.read_csv(RETAINED_FORM).set_index("key").to_dict("index") if RETAINED_FORM.is_file() else {}
        for roster in retained.values():
            for player in roster:
                player["form"] = retained_form.get(name_key(player["name"]), {})
                player["skill"] = primary_skill(player)
                player["secondary_skills"] = secondary_skills(player)
                player["quality"] = playing_quality(player)
                player["market_value"] = player["price"]
        return cls(players, retained)


class Auction:
    def __init__(self, catalog, user, kept, *, rng=None, market=None):
        if (user is not None and user not in TEAMS) or not isinstance(kept, list):
            raise ValueError("Choose a franchise and its retentions.")
        allowed = {player["name"] for player in catalog.retained.get(user, [])}
        if any(not isinstance(name, str) or name not in allowed for name in kept):
            raise ValueError("Choose retentions from your franchise.")
        self.user = user
        self.rng = rng if rng is not None else Random()
        self.market = market if market is not None else MarketTuning()
        self.rosters = {
            code: [player for player in roster if code != user or player["name"] in kept]
            for code, roster in catalog.retained.items()
        }
        self.deductions = {code: retention_deduction(roster) for code, roster in self.rosters.items()}
        self.purses = {code: PURSE - deduction for code, deduction in self.deductions.items()}
        retained = {name_key(player["name"]) for roster in self.rosters.values() for player in roster}
        # Released saved retentions are offered after the official list.
        self.players = [p for p in catalog.players if name_key(p["name"]) not in retained]
        self.players.sort(key=lambda player: (int(player["set"]), player["set_code"]))
        pool_keys = {name_key(p["name"]) for p in self.players}
        for player in catalog.retained.get(user, []):
            key = name_key(player["name"])
            if key not in retained and key not in pool_keys:
                self.players.append({
                    **player, "country": "Overseas" if player["overseas"] else "India",
                    "set": "Released retentions", "set_code": "Released retentions",
                    "reserve": 200, "valuation": None,
                    "previous": user, "preferences": [], "stats": None,
                    "id": f"released-{key}", "rtm_team": user,
                    "sale_probability": None, "price_range": None,
                })
        self.recall_pool = {p["id"]: p for p in self.players if not p["set"].isdigit() or int(p["set"]) > 17}
        self.players = [p for p in self.players if p["id"] not in self.recall_pool]
        shuffled = []
        for _, members in groupby(self.players, key=lambda p: (p["set"], p["set_code"])):
            lots = list(members)
            self.rng.shuffle(lots)
            shuffled.extend(lots)
        self.players = shuffled
        self.offered = set()
        self.sets = {}
        for player in self.players:
            code = player["set_code"]
            group = self.sets.setdefault((player["set"], code), {
                "number": player["set"], "code": code, "category": set_category(code),
                "players": [],
            })
            group["players"].append({"id": player["id"], "name": player["name"], "role": player["role"], "reserve": player["reserve"]})
        self.rtm_slots = {
            code: Counter("uncapped" if player["uncapped"] else "capped" for player in roster)
            for code, roster in self.rosters.items()
        }
        self.recall_round = 0
        self.nomination_sheets = {}
        self.results = []
        self.lineup = None
        self.version = 0
        self.paused_seconds = None
        self.index = -1
        self.advance()

    @property
    def player(self):
        return self.players[self.index] if self.index < len(self.players) else None

    @property
    def rtm(self):
        return self.rtm_cards(self.user)["total"] if self.user else 0

    def rtm_cards(self, code):
        used = self.rtm_slots[code]
        total = 6 - used.total()
        return {"total": total, "capped": min(total, 5 - used["capped"]), "uncapped": min(total, 2 - used["uncapped"])}

    def eligible(self, code, price):
        roster = self.rosters[code]
        return (
            price <= self.bid_limit(code)
            and len(roster) < SQUAD_LIMIT
            and (not self.player["overseas"] or sum(p["overseas"] for p in roster) < OVERSEAS_LIMIT)
        )

    def bid_limit(self, code):
        return self.purses[code] - 30 * max(0, MIN_SQUAD - len(self.rosters[code]) - 1)

    def log(self, message, code=None, price=None, *, kind="notice"):
        self.events.append({"message": message, "team": code, "price": price, "kind": kind})

    def advance(self):
        previous_set = self.player["set_code"] if self.index >= 0 and self.player else None
        self.version += 1
        self.index += 1
        self.leader = None
        self.price = None
        self.cue = None
        self.rtm_holder = None
        self.rtm_stage = None
        self.events = []
        self.ceilings = {}
        if self.player is None:
            self.phase = "nomination" if self.recall_pool and self.recall_round < 2 else "complete"
            return
        if self.player["set_code"] != previous_set:
            self.phase = "reveal"
        else:
            self.open_lot()

    def open_lot(self):
        self.phase = "bidding"
        self.cue = "open"
        self.deadline = monotonic() + (ACCELERATED_OPENING_PAUSE if self.recall_round else OPENING_PAUSE)
        player = self.player
        average = max(1, sum(self.purses.values()) / len(TEAMS))
        reserve = player["reserve"]
        estimate = player["price_range"]
        base = (0.65 * estimate[1] + 0.35 * estimate[2]) if estimate else (player["valuation"] or reserve)
        marquee = player["set_code"] in {"M1", "M2"}
        probability = player["sale_probability"] if player["sale_probability"] is not None else 0.25
        if marquee:
            base = max(base, reserve * 1.55) * self.market.marquee[int(player["set_code"][-1]) - 1]
        elif not self.recall_round and self.rng.random() > min(0.94, 0.14 + 0.90 * probability):
            # One shared draw captures lots where the entire market passes on reserve.
            self.log("Bidding opened")
            return
        market_interest = self.rng.uniform(0.66, 1.18)
        progress = min(1, (0.54 if self.recall_round else 0) + 0.46 * self.index / max(1, len(self.players) - 1))
        # Leave room for subsequent sets, especially overseas specialists.
        held_slots = max(0, 4 - int(progress * 5)) if self.recall_round < 2 else 0
        held_overseas = max(0, 2 - int(progress * 3)) if self.recall_round < 2 else 0
        available = self.players[self.index + 1:] + [p for p in self.recall_pool.values() if p["id"] not in self.offered]
        alternatives = Counter(
            (p["skill"], p["overseas"]) for p in available
            if p["market_value"] >= .55 * player["market_value"] and p["quality"] >= .85 * player["quality"]
        )
        remaining_slot_budgets = {
            code: self.purses[code] / max(4, 23 - len(roster)) for code, roster in self.rosters.items()
        } if self.market.slot_budget else {}
        average_slot_budget = max(1, sum(remaining_slot_budgets.values()) / len(TEAMS))
        for code, (_, _, weight, _) in TEAMS.items():
            if code == self.user or not self.eligible(code, reserve):
                continue
            roster = self.rosters[code]
            overseas = sum(p["overseas"] for p in roster)
            nominated = player["id"] in self.nomination_sheets.get(code, ())
            if not (marquee or nominated) and (len(roster) >= SQUAD_LIMIT - held_slots or (
                player["overseas"] and overseas >= OVERSEAS_LIMIT - held_overseas
            )):
                continue
            fit = xi_fit(player, roster, alternatives)
            preference = weight if code in player["preferences"] else 1
            incumbent = player["previous"] == code
            interest = (0.045 + 0.31 * probability + 0.13 * incumbent + 0.10 * (preference > 1)) * fit
            interest *= min(1.65, base / reserve) * market_interest
            if marquee:
                interest = max(interest, .34 + .20 * min(1, fit / 1.15))
            else:
                # Crowded squads become selective even when they still have legal slots.
                interest *= min(1.15, 0.55 + 0.06 * (SQUAD_LIMIT - len(roster)))
                if self.recall_round:
                    interest += self.market.late_interest * min(1, max(0, 22 - len(roster)) / 8)
            if not nominated and self.rng.random() > interest:
                continue
            budget = (self.purses[code] / average) ** 0.35
            if self.market.slot_budget:
                budget = (remaining_slot_budgets[code] / average_slot_budget) ** 0.27
            ceiling = base * market_interest * budget * fit
            if self.recall_round and self.market.late_budget_pressure:
                depth_cost = 30 * max(1, self.market.depth_target - len(roster))
                headroom = max(0, self.purses[code] - depth_cost)
                # A team with surplus cash can chase a scarce upgrade late in the auction.
                ceiling *= 1 + self.market.late_budget_pressure * min(1, headroom / max(300, 0.20 * (PURSE - self.deductions[code])))
            if not player["uncapped"] and player["skill"] in {"pace", "death"}:
                ceiling *= self.market.capped_pace
            elif not player["uncapped"] and not marquee and player["skill"] == "top_order":
                ceiling *= self.market.capped_top_order
            ceiling *= preference * (1.16 if incumbent else 1) * self.rng.uniform(0.8, 1.24)
            if estimate:
                # Allow a strategic premium while dampening stacked multipliers.
                upper = estimate[2]
                if ceiling > upper:
                    ceiling = upper + (ceiling - upper) * (.55 if fit >= 1 else .32)
            # A team will rarely put its remaining purse into a single signing.
            reserve_for_later = (held_slots + held_overseas) * 30
            future_depth_cost = 30 * max(0, self.market.depth_target - len(roster) - 1)
            limit = min(
                max(reserve, int(self.purses[code] * 0.40)),
                self.bid_limit(code) - reserve_for_later,
                self.purses[code] - future_depth_cost,
            )
            if self.recall_round and len(roster) < self.market.depth_target:
                ceiling = max(reserve, ceiling)
            if not self.recall_round:
                accelerated_budget = int((PURSE - self.deductions[code]) * self.market.accelerated_purse_share)
                limit = min(limit, self.purses[code] - accelerated_budget)
            if nominated:
                ceiling = max(reserve, ceiling)
                limit = max(reserve, limit)
            self.ceilings[code] = min(int(ceiling), limit, self.purses[code])
        self.log("Bidding opened")

    def ask_price(self):
        return self.player["reserve"] if self.price is None else next_price(self.price)

    def ai_bid(self):
        ask = self.ask_price()
        bidders = [
            code for code, ceiling in self.ceilings.items()
            if ceiling >= ask and code != self.leader and self.eligible(code, ask)
        ]
        if not bidders:
            return False
        self.bid(self.rng.choice(bidders), ask)
        return True

    def bid(self, code, price):
        self.leader, self.price = code, price
        self.cue = "open"
        delay = self.rng.uniform(1.30, 1.75) if self.recall_round else self.rng.uniform(2.10, 2.90)
        self.deadline = monotonic() + delay
        self.log("Raised a paddle", code, price, kind="bid")

    def rtm_eligible(self, code, price):
        bucket = "uncapped" if self.player["uncapped"] else "capped"
        return (
            code in TEAMS and code != self.leader and self.rtm_slots[code].total() < 6
            and self.rtm_slots[code][bucket] < (2 if bucket == "uncapped" else 5)
            and self.eligible(code, price)
        )

    def offer_rtm(self, stage):
        self.phase = "rtm"
        self.rtm_stage = stage
        self.deadline = monotonic() + RTM_SECONDS

    def finish_rtm(self, match):
        if match and self.rtm_eligible(self.rtm_holder, self.price):
            bucket = "uncapped" if self.player["uncapped"] else "capped"
            self.rtm_slots[self.rtm_holder][bucket] += 1
            self.leader = self.rtm_holder
            self.rtm_stage = "matched"
            self.log("Matched the final bid", self.leader, self.price, kind="bid")
        self.award()

    def final_bid(self, price):
        if price != self.price:
            if type(price) is not int or price <= self.price or not self.eligible(self.leader, price):
                raise ValueError("Enter a final price above the current bid and within your available purse.")
            self.price = price
            self.log("Raised the final RTM bid", self.leader, self.price, kind="bid")
        if not self.rtm_eligible(self.rtm_holder, self.price):
            self.award()
        elif self.rtm_holder == self.user:
            self.offer_rtm("match")
            self.log("Final RTM decision", self.rtm_holder, self.price)
        else:
            self.finish_rtm(self.rtm_limit >= self.price)

    def challenge_rtm(self, interactive):
        if interactive and self.leader == self.user:
            self.offer_rtm("final")
            return
        ceiling = self.ceilings.get(self.leader, 0)
        # Keep the option to stand on the original winning bid.
        price = max(self.price, min(ceiling, self.bid_limit(self.leader)))
        if interactive:
            self.final_bid(price)
        else:
            self.price = price
            self.finish_rtm(self.rtm_limit >= price)

    def settle(self, interactive=True):
        holder = self.player["rtm_team"]
        if self.leader and self.rtm_eligible(holder, self.price):
            self.rtm_holder = holder
            if holder == self.user:
                if interactive:
                    self.offer_rtm("offer")
                    self.log("Right to Match available", holder, self.price)
                    return
            else:
                # RTM has standalone value even if the franchise stayed out of open bidding.
                self.rtm_limit = max(
                    self.ceilings.get(holder, 0),
                    int(self.player["market_value"] * xi_fit(self.player, self.rosters[holder], Counter()) * 1.10),
                )
                if self.rtm_limit >= self.price:
                    self.challenge_rtm(interactive)
                    return
        self.award()

    def award(self):
        player = self.player
        self.offered.add(player["id"])
        if self.leader:
            self.purses[self.leader] -= self.price
            self.rosters[self.leader].append({
                "id": player["id"], "name": player["name"], "role": player["role"],
                "overseas": player["overseas"], "price": self.price, "retained": False,
                "skill": player["skill"], "market_value": player["market_value"],
                "quality": player["quality"],
                "secondary_skills": player.get("secondary_skills", ()),
            })
            self.recall_pool.pop(player["id"], None)
        else:
            self.recall_pool[player["id"]] = player
        self.results.append({
            "id": player["id"], "name": player["name"], "team": self.leader,
            "price": self.price, "set": player["set_code"], "round": self.recall_round,
            "via_rtm": self.rtm_stage == "matched",
        })
        self.phase = "result"
        self.log("Sold" if self.leader else "Unsold", self.leader, self.price)

    def nominate(self, nominations):
        pool = self.nomination_pool()
        if (len(nominations) > NOMINATION_LIMIT or len(set(nominations)) != len(nominations)
                or any(player_id not in pool for player_id in nominations)):
            raise ValueError(f"Nominate up to {NOMINATION_LIMIT} distinct players available in this round.")
        sheets = {self.user: set(nominations)} if self.user else {}
        alternatives = Counter((p["skill"], p["overseas"]) for p in pool.values())
        for code, roster in self.rosters.items():
            if code == self.user or len(roster) >= SQUAD_LIMIT:
                continue
            candidates = [
                p for p in pool.values()
                if p["reserve"] <= self.bid_limit(code) and (not p["overseas"] or sum(r["overseas"] for r in roster) < OVERSEAS_LIMIT)
                and (p["sale_probability"] or 0) >= 0.10
            ]
            candidates.sort(key=lambda p: p["sale_probability"] * xi_fit(p, roster, alternatives) * p["market_value"] ** 0.45 * self.rng.uniform(0.7, 1.3), reverse=True)
            quota = min(self.market.first_nominations if self.recall_round == 0 else self.market.second_nominations, 4 * (SQUAD_LIMIT - len(roster)))
            sheets[code] = {p["id"] for p in candidates[:quota]}
        self.nomination_sheets = sheets
        selected = set().union(*sheets.values())
        self.recall_round += 1
        if not selected:
            self.phase = "nomination" if self.recall_round < 2 and self.recall_pool else "complete"
            self.version += 1
            return
        label = f"Accelerated round {self.recall_round}"
        players = [
            {**player, "set": label, "set_code": label} for player in self.recall_pool.values()
            if player["id"] in selected
        ]
        for registration_id in selected:
            self.recall_pool.pop(registration_id)
        self.rng.shuffle(players)
        self.players.extend(players)
        self.sets[(label, label)] = {
            "number": label, "code": label, "category": label,
            "players": [{"id": p["id"], "name": p["name"], "role": p["role"], "reserve": p["reserve"]} for p in players],
        }
        self.index -= 1
        self.advance()

    def nomination_pool(self):
        if self.recall_round == 0:
            return {key: p for key, p in self.recall_pool.items() if key not in self.offered}
        return self.recall_pool

    def act(self, action, *, amount=None, nominations=()):
        if action == "pause":
            if self.phase in {"bidding", "rtm"} and self.paused_seconds is None:
                self.paused_seconds = max(.25, self.deadline - monotonic())
                self.version += 1
            return
        if action == "resume":
            if self.paused_seconds is not None:
                self.deadline = monotonic() + self.paused_seconds
                self.paused_seconds = None
                self.version += 1
            return
        if self.paused_seconds is not None:
            raise ValueError("Close the squad panel to resume bidding.")
        if self.phase == "nomination" and action == "nominate":
            self.nominate(nominations)
            return
        if self.phase == "reveal" and action == "open":
            self.open_lot()
            self.version += 1
            return
        if self.phase == "result" and action == "next":
            self.advance()
            return
        if self.phase in {"bidding", "rtm", "result"} and action == "skip":
            if self.phase == "result":
                return
            if self.phase == "bidding":
                while self.ai_bid():
                    pass
            if self.phase == "rtm":
                if self.rtm_stage == "final":
                    self.final_bid(self.price)
                else:
                    self.finish_rtm(False)
            elif self.phase == "bidding":
                self.settle(interactive=False)
            self.version += 1
            return
        if self.phase == "rtm" and action in {"match", "pass", "raise"}:
            if self.rtm_stage == "final" and action in {"raise", "pass"}:
                self.final_bid(amount if action == "raise" else self.price)
            elif self.rtm_stage == "offer" and action == "match":
                self.rtm_limit = 0
                self.challenge_rtm(interactive=True)
            elif self.rtm_stage in {"offer", "match"} and action in {"match", "pass"}:
                self.finish_rtm(action == "match")
            else:
                raise ValueError("This Right to Match action is unavailable.")
        elif self.phase == "bidding" and action == "bid":
            ask = self.ask_price()
            if self.leader == self.user or not self.eligible(self.user, ask):
                raise ValueError("You already lead or your purse or squad limits prevent this bid.")
            self.bid(self.user, ask)
        else:
            raise ValueError("This action is unavailable.")
        self.version += 1

    def tick(self):
        if self.paused_seconds is not None or self.phase not in {"bidding", "rtm"} or monotonic() < self.deadline:
            return
        if self.phase == "rtm":
            self.act("pass")
            return
        if not self.ai_bid():
            if self.cue == "twice":
                self.settle()
            else:
                self.cue = "once" if self.cue == "open" else "twice"
                self.log("Going once" if self.cue == "once" else "Going twice")
                self.deadline = monotonic() + (ACCELERATED_CALL_PAUSE if self.recall_round else CALL_PAUSE)
        self.version += 1

    def save_lineup(self, order, keeper):
        if self.phase != "complete" or self.user not in self.rosters:
            raise ValueError("Complete the auction before saving your Playing XI.")
        roster = self.rosters[self.user]
        if len(order) != 11 or len(set(order)) != 11 or any(index < 0 or index >= len(roster) for index in order):
            raise ValueError("Select eleven different players from your squad.")
        if sum(roster[index]["overseas"] for index in order) > 4:
            raise ValueError("Choose at most four overseas players.")
        if keeper not in order or roster[keeper]["role"] != "WK":
            raise ValueError("Select a wicketkeeper from your Playing XI.")
        self.lineup = {"order": list(order), "keeper": keeper}
        self.version += 1

    def snapshot(self):
        self.tick()
        timed = self.phase in {"bidding", "rtm"}
        return {
            "user": self.user, "version": self.version, "phase": self.phase,
            "lot": min(self.index + 1, len(self.players)), "total": len(self.players), "player": self.player,
            "set": self.sets[(self.player["set"], self.player["set_code"])] if self.player else None,
            "leader": self.leader, "price": self.price,
            "cue": self.cue,
            "lineup": self.lineup,
            "bid_id": len(self.events) if self.events and self.events[-1]["kind"] == "bid" else None,
            "next_price": self.ask_price() if self.phase == "bidding" else None,
            "can_bid": self.phase == "bidding" and self.leader != self.user and self.eligible(self.user, self.ask_price()),
            "paused": self.paused_seconds is not None,
            "seconds": self.paused_seconds if self.paused_seconds is not None else max(0, self.deadline - monotonic()) if timed else None,
            "rtm": self.rtm, "rtm_stage": self.rtm_stage if self.phase == "rtm" else None,
            "rtm_team": self.rtm_holder if self.phase == "rtm" else None,
            "rtm_eligible_team": (
                self.player["rtm_team"] if self.phase == "bidding" and self.leader
                and self.rtm_eligible(self.player["rtm_team"], self.price) else None
            ),
            "final_bid_min": self.price + 1 if self.phase == "rtm" and self.rtm_stage == "final" else None,
            "final_bid_max": self.bid_limit(self.user) if self.phase == "rtm" and self.rtm_stage == "final" else None,
            "nomination_round": self.recall_round + 1 if self.phase == "nomination" else None,
            "accelerated_round": self.recall_round,
            "nomination_limit": NOMINATION_LIMIT,
            "nominees": [
                {key: p[key] for key in ("id", "name", "role", "country", "overseas", "reserve", "skill")}
                | {"recalled": p["id"] in self.offered}
                for p in self.nomination_pool().values()
            ] if self.phase == "nomination" else [],
            "events": self.events[-30:], "results": self.results.copy(),
            "teams": {
                code: {
                    "purse": self.purses[code], "retention_deduction": self.deductions[code],
                    "rtm_cards": self.rtm_cards(code),
                    "roster": roster.copy(), "playing_xi": projected_xi(roster),
                }
                for code, roster in self.rosters.items()
            },
        }
