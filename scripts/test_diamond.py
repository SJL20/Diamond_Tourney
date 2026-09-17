#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.standings import sort_pool
from scripts.pb_client import auth, request

BASE = "http://127.0.0.1:8097"


class TiebreakTests(unittest.TestCase):
    def test_h2h_before_run_diff(self):
        a = {"id": "a", "name": "A", "w": 1, "l": 1, "rs": 20, "ra": 3}
        b = {"id": "b", "name": "B", "w": 1, "l": 1, "rs": 8, "ra": 3}
        games = [{"home": "a", "away": "b", "home_runs": 2, "away_runs": 5}]
        ranked = sort_pool([a, b], games)
        self.assertEqual(ranked[0]["id"], "b")


class BoardTests(unittest.TestCase):
    def test_central_saturday_board(self):
        board = request(BASE, "GET", "/api/event/central-saturday/board")
        self.assertEqual(board["event"]["slug"], "central-saturday")
        pools = {p["name"]: p["teams"] for p in board["standings"]}
        self.assertEqual([t["name"] for t in pools["A"]], ["Passion", "Hawks 10U", "Lady Dukes"])
        self.assertEqual(pools["A"][0]["w"], 2)
        self.assertEqual(pools["A"][1]["w"], 1)
        sf1 = next(g for g in board["bracket"] if g["round"] == "SF" and g["slot"] == 1)
        self.assertEqual(sf1["winner"], "Passion")
        finale = next(g for g in board["bracket"] if g["round"] == "F")
        self.assertEqual(finale["home"], "Passion")
        self.assertEqual(finale.get("side") or "championship", "championship")
        fifth = next(g for g in board["bracket"] if g["round"] == "5TH")
        self.assertEqual(fifth["side"], "consolation")
        self.assertEqual(fifth["home"], "Lady Dukes")
        self.assertEqual(fifth["away"], "Rivals 10U")
        third = next(g for g in board["bracket"] if g["round"] == "3RD")
        self.assertEqual(third["side"], "consolation")
        self.assertEqual(third["home"], "FP Select")
        self.assertGreaterEqual(len(board["leaders"]["hitting"]), 1)
        self.assertEqual(board["leaders"]["hitting"][0]["name_key"], "Maeve D #4")
        self.assertTrue(board["leaders"]["all_tournament"]["hitters"])

    def test_import_door_three(self):
        admin = auth(BASE, "owner@local.test", "RegionAdmin1!")
        csv = (ROOT / "testdata" / "clipboard_open.csv").read_text()
        out = request(BASE, "POST", "/api/event/import-schedule", admin, {
            "event_slug": "clipboard-open",
            "event_name": "Clipboard Open",
            "csv": csv,
            "replace": True,
        })
        self.assertGreaterEqual(out["imported"], 3)
        board = request(BASE, "GET", "/api/event/clipboard-open/board")
        pool_a = next(p for p in board["standings"] if p["name"] == "A")
        self.assertEqual(pool_a["teams"][0]["name"], "Northside")
        self.assertEqual(pool_a["teams"][0]["w"], 2)


class HostedSignupTests(unittest.TestCase):
    def test_native_create_and_gc_required(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Hosted Native Open",
            "slug": "hosted-native-open",
            "venue": "North Fields",
            "ages": "10U",
        })
        slug = created["event"]["slug"]
        self.assertTrue(created["event"]["signup_open"])
        self.assertEqual(created["event"]["source"], "native")

        with self.assertRaises(RuntimeError) as missing:
            request(BASE, "POST", f"/api/events/{slug}/signup", None, {
                "team_name": "Orphans",
            })
        self.assertIn("GameChanger", str(missing.exception))

        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", f"/api/events/{slug}/signup", None, {
                "team_name": "Orphans",
                "gamechanger_url": "https://example.com/not-gc",
            })
        self.assertIn("GameChanger", str(bad.exception))

        joined = request(BASE, "POST", f"/api/events/{slug}/signup", None, {
            "team_name": "Northside 10U",
            "pool": "A",
            "gamechanger_url": "https://web.gc.com/team/northside-10u",
            "contact_name": "Coach Kim",
            "contact_email": "kim@local.test",
        })
        self.assertTrue(joined["team"]["gc_linked"])
        self.assertEqual(joined["team"]["signed_up_by"], "team")

        director_add = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "West End 10U",
            "pool": "B",
            "gamechanger_url": "https://gc.com/team/west-end-10u",
            "as_director": True,
        })
        self.assertEqual(director_add["team"]["signed_up_by"], "director")

        roster = request(BASE, "GET", f"/api/events/{slug}/roster")
        names = [t["name"] for t in roster["teams"]]
        self.assertIn("Northside 10U", names)
        self.assertIn("West End 10U", names)
        self.assertTrue(all(t["gc_linked"] for t in roster["teams"]))

        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertTrue(board["event"]["signup_open"])
        self.assertGreaterEqual(len(board["roster"]), 2)

        synced = request(BASE, "POST", f"/api/events/{slug}/sync", td, {})
        self.assertTrue(any(r.get("kind") == "gamechanger" for r in synced["results"]))

        closed = request(BASE, "POST", f"/api/events/{slug}/settings", td, {"signup_open": False})
        self.assertFalse(closed["event"]["signup_open"])
        with self.assertRaises(RuntimeError) as shut:
            request(BASE, "POST", f"/api/events/{slug}/signup", None, {
                "team_name": "Late Team",
                "gamechanger_url": "https://gc.com/team/late",
            })
        self.assertIn("closed", str(shut.exception).lower())

    def test_tm_link_rejects_non_tm(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", "/api/events/create", td, {
                "source": "tourneymachine",
                "tm_url": "https://example.com/tournament",
            })
        self.assertIn("tourneymachine", str(bad.exception).lower())

        linked = request(BASE, "POST", "/api/events/create", td, {
            "source": "tourneymachine",
            "name": "Linked Classic",
            "slug": "linked-classic",
            "tm_url": "https://www.tourneymachine.com/Public/Results/Tournament.aspx?IDTournament=abc123xyz",
        })
        self.assertEqual(linked["event"]["source"], "tourneymachine")
        self.assertEqual(linked["event"]["tm_id"], "abc123xyz")
        self.assertTrue(linked["event"]["signup_open"])


if __name__ == "__main__":
    unittest.main()
