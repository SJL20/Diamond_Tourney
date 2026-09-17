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


if __name__ == "__main__":
    unittest.main()
