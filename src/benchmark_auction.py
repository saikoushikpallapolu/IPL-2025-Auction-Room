"""Run seeded AI-only auctions and compare outcomes with the 2025 replay."""
import argparse
from collections import Counter
from random import Random
from statistics import mean

import pandas as pd

from .rebuild_pool import OUTCOMES, name_key
from .simulator_engine import Auction, Catalog, OVERSEAS_LIMIT, SQUAD_LIMIT
from .team_strategy import projected_xi

# End-of-auction purse and squad totals, in lakh and players respectively.
ACTUAL_TEAMS = {
    "CSK": (5, 25), "DC": (20, 23), "GT": (15, 25), "KKR": (5, 21), "LSG": (10, 24),
    "MI": (20, 23), "PBKS": (35, 25), "RCB": (75, 22), "RR": (30, 20), "SRH": (20, 20),
}


def simulate(catalog, seed, market=None):
    auction = Auction(catalog, None, [], rng=Random(seed), market=market)
    while auction.phase != "complete":
        if auction.phase == "nomination":
            auction.act("nominate")
        elif auction.phase == "reveal":
            auction.act("open")
        else:
            auction.act("skip")
    ids = [result["id"] for result in auction.results if result["team"]]
    assert len(ids) == len(set(ids))
    for code, roster in auction.rosters.items():
        assert len(roster) <= SQUAD_LIMIT
        assert sum(p["overseas"] for p in roster) <= OVERSEAS_LIMIT
        assert auction.purses[code] >= 0
        assert auction.purses[code] + auction.deductions[code] + sum(p["price"] for p in roster if not p["retained"]) == 12000
    return auction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=30)
    parser.add_argument("--seed-start", type=int, default=0)
    args = parser.parse_args()
    if args.seeds < 1:
        parser.error("--seeds must be positive")
    catalog = Catalog.load()
    pools = {p["id"]: p for p in catalog.players}
    outcomes = pd.read_csv(OUTCOMES)
    actual = {
        name_key(row.player_name.removesuffix(" (R)")): row.price_in_crores
        for row in outcomes.itertuples()
    }
    rows = []
    set_spend = Counter()
    team_purses = Counter()
    team_sizes = Counter()
    team_overseas = Counter()
    for seed in range(args.seed_start, args.seed_start + args.seeds):
        simulation = simulate(catalog, seed)
        sold = [r for r in simulation.results if r["team"]]
        misses = []
        for roster in simulation.rosters.values():
            misses.append(sum(projected_xi(roster)["vacancies"].values()))
        rows.append({
            "sold": len(sold), "overseas": sum(pools[r["id"]]["overseas"] for r in sold),
            "spend_cr": sum(r["price"] for r in sold) / 100,
            "top_price_cr": max((r["price"] for r in sold), default=0) / 100,
            "not_signed_pct": 100 * (1 - len(sold) / len(pools)),
            "offered_unsold_pct": 100 * (1 - len(sold) / len(simulation.offered)),
            "marquee_spend_cr": sum(r["price"] for r in sold if pools[r["id"]]["set_code"] in {"M1", "M2"}) / 100,
            "unfilled_xi_roles": mean(misses),
            "accelerated_sales": sum(r["round"] > 0 for r in sold),
            "team_size_mae": mean(abs(len(roster) - ACTUAL_TEAMS[code][1]) for code, roster in simulation.rosters.items()),
            "team_purse_mae_cr": mean(abs(simulation.purses[code] - target[0]) / 100 for code, target in ACTUAL_TEAMS.items()),
        })
        for result in sold:
            set_spend[pools[result["id"]]["set_code"]] += result["price"] / 100
        for code, roster in simulation.rosters.items():
            team_purses[code] += simulation.purses[code]
            team_sizes[code] += len(roster)
            team_overseas[code] += sum(player["overseas"] for player in roster)
    for metric in rows[0]:
        print(f"{metric:23} {mean(row[metric] for row in rows):8.2f}")
    print(f"Actual 2025: {len(actual)} signings, {sum(actual.values()):.2f} Cr, top price {max(actual.values()):.2f} Cr")
    print("Team   Left Cr   Actual   Squad   Actual   Overseas")
    for code, (remaining, size) in ACTUAL_TEAMS.items():
        print(f"{code:5} {team_purses[code]/args.seeds/100:8.2f} {remaining/100:8.2f} {team_sizes[code]/args.seeds:7.2f} {size:8} {team_overseas[code]/args.seeds:10.2f}")
    print("Set         Sim Cr    Actual Cr")
    actual_sets = Counter()
    for player in pools.values():
        if player["name"] == "Akash Singh" and player["id"] != "220":
            continue
        actual_sets[player["set_code"]] += actual.get(name_key(player["name"]), 0)
    print(f"Absolute error across set mean spends: {sum(abs(set_spend[code] / args.seeds - amount) for code, amount in actual_sets.items()):.2f} Cr")
    for code in dict.fromkeys(p["set_code"] for p in pools.values()):
        print(f"{code:10} {set_spend[code] / args.seeds:8.2f} {actual_sets[code]:11.2f}")


if __name__ == "__main__":
    main()
