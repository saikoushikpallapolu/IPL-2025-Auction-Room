from collections import Counter
from random import Random
from unittest import TestCase
from unittest.mock import patch

from src.simulator_engine import Auction, Catalog, next_price
from src.team_strategy import projected_xi, xi_fit


def player(identifier, rtm_team=None, uncapped=False):
    return {
        "id": identifier, "name": f"Player {identifier}", "role": "BOWL",
        "country": "India", "overseas": False, "reserve": 30, "valuation": 120,
        "price_range": [30, 120, 200], "sale_probability": .5, "market_value": 120,
        "preferences": [], "previous": rtm_team, "rtm_team": rtm_team, "quality": 1.0,
        "set": "6", "set_code": "FA1", "skill": "death", "uncapped": uncapped,
    }


class AuctionRulesTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = Catalog.load()

    def make_auction(self, players):
        auction = Auction(Catalog(players, {**self.catalog.retained, "DC": []}), "DC", [], rng=Random(42))
        auction.act("open")
        return auction

    def test_official_opening_purses(self):
        known = dict(CSK=5500, DC=7300, GT=6900, KKR=5100, LSG=6900, MI=4500, PBKS=11050, RR=4100, RCB=8300, SRH=4500)
        self.assertEqual(Auction(self.catalog, None, []).purses, known)

    def test_bid_increments_at_purse_brackets(self):
        self.assertEqual([next_price(price) for price in (30, 95, 100, 190, 200, 480, 500)],
                         [35, 100, 110, 200, 220, 500, 525])

    def test_mid_auction_lineup_draft_allows_empty_spots_and_carries_to_final(self):
        auction = Auction(self.catalog, "CSK", [p["name"] for p in self.catalog.retained["CSK"]])
        keeper = next(i for i, p in enumerate(auction.rosters["CSK"]) if p["role"] == "WK")
        auction.act("open")
        auction.act("pause")
        auction.save_lineup([1, keeper], keeper, draft=True)
        self.assertEqual(auction.snapshot()["lineup"], {"order": [1, keeper], "keeper": keeper, "draft": True})
        self.assertTrue(auction.snapshot()["paused"])
        with self.assertRaises(ValueError):
            auction.save_lineup([1, 1], None, draft=True)
        auction.phase = "complete"
        with self.assertRaises(ValueError):
            auction.save_lineup([1, keeper], keeper)
        self.assertTrue(auction.snapshot()["lineup"]["draft"])

    def test_retained_spin_and_pant_wicketkeeping_are_available_in_xi(self):
        chennai = projected_xi(self.catalog.retained["CSK"])
        self.assertIn(("Ravindra Jadeja", "spin"), {(p["name"], p["skill"]) for p in chennai["players"]})
        pant = next(p for p in self.catalog.players if p["name"] == "Rishabh Pant")
        self.assertEqual((pant["role"], pant["skill"], pant["rtm_team"]), ("WK", "keeper", "DC"))

    def test_secondary_role_can_fill_vacancy_without_double_counting_a_player(self):
        roster = [dict(player(str(i)), skill="top_order", price=100) for i in range(3)]
        roster.append(dict(player("flex"), skill="top_order", price=100, secondary_skills=("spin",)))
        lineup = projected_xi(roster)
        self.assertEqual(len(lineup["players"]), 4)
        self.assertNotIn("spin", lineup["vacancies"])
        self.assertEqual(len({p["roster_index"] for p in lineup["players"]}), 4)

    def test_user_can_bid_during_opening_and_both_closing_calls(self):
        for call_count, cue in enumerate(("open", "once", "twice")):
            with self.subTest(cue=cue):
                auction = self.make_auction([player("bid-window")])
                auction.ceilings.clear()
                auction.bid("MI", 50)
                for _ in range(call_count):
                    auction.deadline = 0
                    auction.tick()
                before = auction.snapshot()
                self.assertEqual(before["cue"], cue)
                self.assertTrue(before["can_bid"])
                auction.act("bid")
                self.assertEqual((auction.leader, auction.price, auction.cue), ("DC", before["next_price"], "open"))

    def test_squad_pause_freezes_bidding_and_rtm_clocks(self):
        for phase in ("bidding", "rtm"):
            with self.subTest(phase=phase):
                auction = self.make_auction([player("pause", "DC")])
                auction.ceilings.clear()
                if phase == "rtm":
                    auction.bid("MI", 50)
                    auction.settle()
                auction.deadline = 104
                with patch("src.simulator_engine.monotonic", return_value=100):
                    auction.act("pause")
                with patch("src.simulator_engine.monotonic", return_value=200):
                    self.assertEqual(auction.snapshot()["seconds"], 4)
                    self.assertEqual(auction.phase, phase)
                    with self.assertRaisesRegex(ValueError, "resume bidding"):
                        auction.act("skip")
                    auction.act("resume")
                    self.assertEqual(auction.deadline, 204)
                    self.assertFalse(auction.snapshot()["paused"])

    def test_leading_team_can_raise_before_user_confirms_rtm(self):
        auction = self.make_auction([player("a", "DC")])
        auction.ceilings["MI"] = 120
        auction.bid("MI", 50)
        auction.settle()
        self.assertEqual(auction.rtm_stage, "offer")
        auction.act("match")
        self.assertEqual((auction.rtm_stage, auction.leader, auction.price, auction.rtm), ("match", "MI", 120, 6))
        auction.act("match")
        self.assertEqual((auction.results[-1]["team"], auction.rtm), ("DC", 5))

    def test_user_can_raise_against_ai_rtm(self):
        auction = self.make_auction([player("a", "MI", uncapped=True)])
        auction.bid("DC", 50)
        auction.settle()
        self.assertEqual(auction.rtm_stage, "final")
        auction.act("raise", amount=500)
        self.assertEqual((auction.results[-1]["team"], auction.results[-1]["price"]), ("DC", 500))

    def test_final_rtm_acceptance_and_decline_only_charge_the_winner(self):
        for decision, winner in (("match", "DC"), ("pass", "MI")):
            with self.subTest(decision=decision):
                auction = self.make_auction([player("final", "DC")])
                purses = auction.purses.copy()
                auction.ceilings["MI"] = 1800
                auction.bid("MI", 1500)
                auction.settle()
                self.assertEqual(auction.rtm_stage, "offer")
                auction.act("match")
                self.assertEqual((auction.rtm_stage, auction.price), ("match", 1800))
                auction.act(decision)
                self.assertEqual(auction.results[-1]["team"], winner)
                self.assertEqual(auction.results[-1]["via_rtm"], decision == "match")
                self.assertEqual(auction.rtm_cards("DC")["total"], 5 if decision == "match" else 6)
                self.assertEqual(auction.purses[winner], purses[winner] - 1800)
                other = "MI" if winner == "DC" else "DC"
                self.assertEqual(auction.purses[other], purses[other])

    def test_skip_during_final_offer_keeps_ai_rtm_right(self):
        auction = self.make_auction([player("skip-rtm", "MI", uncapped=True)])
        auction.bid("DC", 40)
        auction.settle()
        self.assertEqual(auction.rtm_stage, "final")
        auction.act("skip")
        result = auction.results[-1]
        self.assertEqual((result["team"], result["price"], result["via_rtm"]), ("MI", 40, True))

    def test_player_without_rtm_entitlement_does_not_trigger_offer(self):
        unlisted = player("a")
        unlisted["previous"] = "DC"
        auction = self.make_auction([unlisted])
        auction.bid("MI", 50)
        auction.settle()
        self.assertEqual(auction.phase, "result")

    def test_sold_players_cannot_be_recalled(self):
        auction = self.make_auction([player("a"), player("b")])
        unsold, sold = (lot["id"] for lot in auction.players)
        auction.ceilings.clear()
        auction.act("skip")
        self.assertEqual(auction.phase, "result")
        self.assertEqual(auction.snapshot()["lot"], 1)
        auction.act("skip")
        self.assertEqual(auction.phase, "result")
        auction.act("next")
        auction.bid("DC", 50)
        auction.ceilings.clear()
        auction.act("skip")
        auction.act("next")
        self.assertEqual(auction.phase, "nomination")
        self.assertEqual(auction.nomination_pool(), {})
        auction.act("nominate")
        with self.assertRaises(ValueError):
            auction.act("nominate", nominations=[sold])
        auction.act("nominate", nominations=[unsold])
        self.assertEqual((auction.phase, auction.player["id"], auction.recall_round), ("reveal", unsold, 2))

    def test_accelerated_sheets_merge_and_final_sheet_can_recall_unsold_lots(self):
        late = dict(player("late"), set="18", set_code="UBA2")
        auction = self.make_auction([player("early"), late])
        auction.ceilings.clear()
        auction.act("skip")
        auction.act("next")
        self.assertEqual(set(auction.nomination_pool()), {"late"})
        state = auction.snapshot()
        self.assertEqual(state["nomination_round"], 1)
        self.assertEqual(state["nominees"][0]["reserve"], late["reserve"])
        auction.act("nominate", nominations=["late"])
        self.assertEqual(auction.nomination_sheets["DC"], {"late"})
        self.assertTrue(any("late" in sheet for code, sheet in auction.nomination_sheets.items() if code != "DC"))
        self.assertEqual([p["id"] for p in auction.sets[("Accelerated round 1", "Accelerated round 1")]["players"]], ["late"])
        auction.act("open")
        self.assertLess(auction.snapshot()["seconds"], 1.5)
        auction.ceilings.clear()
        auction.act("skip")
        auction.act("next")
        self.assertEqual(auction.snapshot()["nomination_round"], 2)
        self.assertEqual({p["id"] for p in auction.snapshot()["nominees"] if p["recalled"]}, {"early", "late"})

    def test_lots_are_shuffled_within_each_set(self):
        first = [player(str(i)) for i in range(6)]
        second = [dict(player(str(i)), set="7", set_code="FA2") for i in range(6, 12)]
        auction = self.make_auction(first + second)
        for original, actual in ((first, auction.players[:6]), (second, auction.players[6:])):
            original_ids = [p["id"] for p in original]
            actual_ids = [p["id"] for p in actual]
            self.assertCountEqual(original_ids, actual_ids)
            self.assertNotEqual(original_ids, actual_ids)
            key = (actual[0]["set"], actual[0]["set_code"])
            self.assertEqual([p["name"] for p in actual], [p["name"] for p in auction.sets[key]["players"]])

    def test_missing_death_bowler_has_higher_marginal_value(self):
        candidate = player("a")
        stocked = [dict(player("b"), price=100), dict(player("c"), price=100)]
        self.assertGreater(xi_fit(candidate, [], Counter()), xi_fit(candidate, stocked, Counter()))

    def test_projected_xi_respects_overseas_limit(self):
        skills = ["keeper", "death", "spin", "pace", "finisher"]
        roster = [{**player(str(i)), "overseas": True, "skill": skill} for i, skill in enumerate(skills)]
        self.assertEqual(len(projected_xi(roster)["players"]), 4)

    def test_saved_lineup_checks_squad_eligibility(self):
        auction = Auction(self.catalog, "CSK", [])
        auction.phase = "complete"
        auction.rosters["CSK"] = [
            {"role": "WK" if i == 0 else "BAT", "overseas": i > 7}
            for i in range(13)
        ]
        with self.assertRaises(ValueError):
            auction.save_lineup([0] * 11, 0)
        with self.assertRaises(ValueError):
            auction.save_lineup([0, *range(3, 13)], 0)
        with self.assertRaises(ValueError):
            auction.save_lineup(list(range(11)), 1)
        auction.save_lineup(list(range(11)), 0)
        self.assertEqual(auction.lineup, {"order": list(range(11)), "keeper": 0})

    def test_projected_xi_preserves_overseas_slot_for_unique_keeper(self):
        roster = [
            {**player("domestic"), "skill": "spin", "quality": 0.85},
            *[{**player(f"foreign-{skill}"), "overseas": True, "skill": skill, "quality": 1.2}
              for skill in ("spin", "death", "pace", "finisher")],
            {**player("keeper"), "overseas": True, "skill": "keeper", "quality": 1.0},
        ]
        names = {p["name"] for p in projected_xi(roster)["players"]}
        self.assertIn("Player keeper", names)
        self.assertIn("Player domestic", names)
