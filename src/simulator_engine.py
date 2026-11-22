import csv
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from random import Random
from time import monotonic

import numpy as np
import pandas as pd
import xgboost as xgb

from .train_predictor import FEATURE_COLUMNS, FEATURE_PATH, METRICS, MODEL_PATH, ROLE_COLUMNS, ROOT


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
CALL_PAUSE = 2.6
RTM_SECONDS = 30
SQUAD_LIMIT = 25
OVERSEAS_LIMIT = 8


def name_key(name):
    normalized = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", normalized.casefold())


def read_rows(filename):
    with (DATA / filename).open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def next_price(price):
    return price + (10 if price < 200 else 20 if price < 500 else 50)


def set_category(code):
    if code == "Released retentions":
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
            })

        pool = read_rows("registered_auction_pool_2025.csv")
        features = pd.read_csv(FEATURE_PATH)
        current = features.loc[features.auction_year == 2025].drop_duplicates("canonical_id", keep=False).copy()
        current["key"] = current.player_name.map(name_key)
        current = current.drop_duplicates("key", keep=False).set_index("key")
        pool_names = Counter(name_key(row["player_name"]) for row in pool)
        matched = []
        players = []
        for row in pool:
            key = name_key(row["player_name"])
            role = row["role"]
            overseas = row["country"] != "India"
            player = {
                "name": row["player_name"], "role": role, "country": row["country"],
                "overseas": overseas, "set": row["set_name"],
                "set_code": row.get("set_code") or row["set_name"],
                "reserve": round(float(row["reserve_price"]) * 100),
                "valuation": None, "preferences": [],
                "stats": None,
                "previous": row["previous_team"] or None,
            }
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
        return cls(players, retained)


class Auction:
    def __init__(self, catalog, user, kept, *, rng=None):
        if user not in TEAMS or not isinstance(kept, list):
            raise ValueError("Choose a franchise and its retentions.")
        allowed = {player["name"] for player in catalog.retained[user]}
        if any(not isinstance(name, str) or name not in allowed for name in kept):
            raise ValueError("Choose retentions from your franchise.")
        self.user = user
        self.rng = rng if rng is not None else Random()
        self.rosters = {
            code: [player for player in roster if code != user or player["name"] in kept]
            for code, roster in catalog.retained.items()
        }
        self.purses = {
            code: PURSE - sum(player["price"] for player in roster)
            for code, roster in self.rosters.items()
        }
        retained = {name_key(player["name"]) for roster in self.rosters.values() for player in roster}
        # Released saved retentions are offered after the official list.
        self.players = [p for p in catalog.players if name_key(p["name"]) not in retained]
        self.players.sort(key=lambda player: (int(player["set"]), player["set_code"]))
        pool_keys = {name_key(p["name"]) for p in self.players}
        for player in catalog.retained[user]:
            key = name_key(player["name"])
            if key not in retained and key not in pool_keys:
                self.players.append({
                    **player, "country": "Overseas" if player["overseas"] else "India",
                    "set": "Released retentions", "set_code": "Released retentions",
                    "reserve": 200, "valuation": None,
                    "previous": user, "preferences": [], "stats": None,
                })
        self.sets = {}
        for player in self.players:
            code = player["set_code"]
            group = self.sets.setdefault((player["set"], code), {
                "number": player["set"], "code": code, "category": set_category(code),
                "players": [],
            })
            group["players"].append({"name": player["name"], "role": player["role"]})
        self.rtm = 6 - len(self.rosters[user])
        self.results = []
        self.version = 0
        self.index = -1
        self.advance()

    @property
    def player(self):
        return self.players[self.index] if self.index < len(self.players) else None

    def eligible(self, code, price):
        roster = self.rosters[code]
        return (
            price <= self.purses[code]
            and len(roster) < SQUAD_LIMIT
            and (not self.player["overseas"] or sum(p["overseas"] for p in roster) < OVERSEAS_LIMIT)
        )

    def log(self, message, code=None, price=None, *, kind="notice"):
        self.events.append({"message": message, "team": code, "price": price, "kind": kind})

    def advance(self):
        previous_set = self.player["set_code"] if self.index >= 0 and self.player else None
        self.version += 1
        self.index += 1
        self.leader = None
        self.price = None
        self.cue = None
        self.events = []
        self.ceilings = {}
        if self.player is None:
            self.phase = "complete"
            return
        if self.player["set_code"] != previous_set:
            self.phase = "reveal"
        else:
            self.open_lot()

    def open_lot(self):
        self.phase = "bidding"
        self.cue = "open"
        self.deadline = monotonic() + OPENING_PAUSE
        player = self.player
        average = max(1, sum(self.purses.values()) / len(TEAMS))
        reserve = player["reserve"]
        base = player["valuation"] if player["valuation"] is not None else reserve
        marquee = player["set_code"] in {"M1", "M2"}
        if marquee:
            # Scouting adds a strong marquee prior when the historical model underprices a headliner.
            base = max(base, reserve * 1.55)
        market_interest = self.rng.uniform(0.66, 1.18)
        progress = self.index / max(1, len(self.players) - 1)
        # Leave room for subsequent sets, especially overseas specialists.
        held_slots = max(0, 4 - int(progress * 5))
        held_overseas = max(0, 2 - int(progress * 3))
        for code, (_, _, weight, _) in TEAMS.items():
            if code == self.user or not self.eligible(code, reserve):
                continue
            roster = self.rosters[code]
            overseas = sum(p["overseas"] for p in roster)
            if not marquee and (len(roster) >= SQUAD_LIMIT - held_slots or (
                player["overseas"] and overseas >= OVERSEAS_LIMIT - held_overseas
            )):
                continue
            role_count = sum(p["role"] == player["role"] for p in roster)
            need = 1 / (role_count + 1)
            preference = weight if code in player["preferences"] else 1
            incumbent = player["previous"] == code
            interest = (0.08 + 0.12 * need + 0.13 * incumbent + 0.16 * (preference > 1))
            interest *= min(1.65, base / reserve) * market_interest
            if marquee:
                interest = max(interest, 0.60 + 0.12 * need)
            else:
                # Crowded squads become selective even when they still have legal slots.
                interest *= min(1.15, 0.55 + 0.06 * (SQUAD_LIMIT - len(roster)))
            if self.rng.random() > interest:
                continue
            budget = (self.purses[code] / average) ** 0.35
            ceiling = base * market_interest * budget * (1 + 0.35 * need)
            ceiling *= preference * (1.16 if incumbent else 1) * self.rng.uniform(0.8, 1.24)
            # A team will rarely put its remaining purse into a single signing.
            reserve_for_later = (held_slots + held_overseas) * 30
            limit = min(max(reserve, int(self.purses[code] * 0.40)), self.purses[code] - reserve_for_later)
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
        self.deadline = monotonic() + self.rng.uniform(1.45, 2.25)
        self.log("Raised a paddle", code, price, kind="bid")

    def settle(self, allow_rtm=True):
        if (
            allow_rtm and self.leader and self.leader != self.user and self.rtm
            and self.player["previous"] == self.user and self.eligible(self.user, self.price)
        ):
            self.phase = "rtm"
            self.deadline = monotonic() + RTM_SECONDS
            self.log("Right to match available", self.user, self.price)
            return
        if self.leader:
            self.purses[self.leader] -= self.price
            self.rosters[self.leader].append({
                "name": self.player["name"], "role": self.player["role"],
                "overseas": self.player["overseas"], "price": self.price, "retained": False,
            })
        self.results.append({
            "name": self.player["name"], "team": self.leader, "price": self.price,
        })
        self.phase = "result"
        self.log("Sold" if self.leader else "Unsold", self.leader, self.price)

    def act(self, action):
        if self.phase == "reveal" and action == "open":
            self.open_lot()
            self.version += 1
            return
        if self.phase == "result" and action == "next":
            self.advance()
            return
        if self.phase in {"bidding", "rtm", "result"} and action == "skip":
            if self.phase == "bidding":
                while self.ai_bid():
                    pass
            if self.phase != "result":
                self.settle(allow_rtm=False)
            self.advance()
            return
        if self.phase == "rtm" and action in {"match", "pass"}:
            if action == "match":
                self.leader = self.user
                self.rtm -= 1
                self.log("Matched the winning bid", self.user, self.price, kind="bid")
            self.settle(allow_rtm=False)
        elif self.phase == "bidding" and action == "bid":
            ask = self.ask_price()
            if self.leader == self.user or not self.eligible(self.user, ask):
                raise ValueError("You already lead or your purse or squad limits prevent this bid.")
            self.bid(self.user, ask)
        else:
            raise ValueError("This action is unavailable.")
        self.version += 1

    def tick(self):
        if self.phase not in {"bidding", "rtm"} or monotonic() < self.deadline:
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
                self.deadline = monotonic() + CALL_PAUSE
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
            "bid_id": len(self.events) if self.events and self.events[-1]["kind"] == "bid" else None,
            "next_price": self.ask_price() if self.phase == "bidding" else None,
            "can_bid": self.phase == "bidding" and self.leader != self.user and self.eligible(self.user, self.ask_price()),
            "seconds": max(0, self.deadline - monotonic()) if timed else None,
            "rtm": self.rtm, "events": self.events[-30:], "results": self.results.copy(),
            "teams": {
                code: {"purse": self.purses[code], "roster": roster.copy()}
                for code, roster in self.rosters.items()
            },
        }
