#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
import uuid
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

        paper = request(BASE, "POST", f"/api/events/{slug}/signup", None, {
            "team_name": "Orphans",
        })
        self.assertFalse(paper["team"]["gc_linked"])

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
        self.assertTrue(any(t["name"] == "Orphans" and not t["gc_linked"] for t in roster["teams"]))
        self.assertTrue(any(t["name"] == "Northside 10U" and t["gc_linked"] for t in roster["teams"]))

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


class AccountAndYearTests(unittest.TestCase):
    def test_register_login_and_owned_event(self):
        email = f"pat.{uuid.uuid4().hex[:8]}@local.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "DirectorPass1!",
            "display_name": "Pat Director",
            "intent": "director",
        })
        token = auth(BASE, email, "DirectorPass1!")
        home = request(BASE, "GET", "/api/account/home", token)
        self.assertEqual(home["user"]["email"], email)
        created = request(BASE, "POST", "/api/events/create", token, {
            "source": "native",
            "name": "Pat Labor Day",
            "slug": "pat-labor-day",
            "venue": "Harbor",
            "ages": "10U",
        })
        self.assertTrue(created["event"]["created_by"])
        home2 = request(BASE, "GET", "/api/account/home", token)
        slugs = [e["slug"] for e in home2["created"]]
        self.assertTrue(any(s.startswith("pat-labor-day") for s in slugs))

    def test_register_cannot_self_assign_admin(self):
        out = request(BASE, "POST", "/api/account/register", None, {
            "email": f"notadmin.{uuid.uuid4().hex[:8]}@local.test",
            "password": "NotAdmin99!",
            "display_name": "Not Admin",
            "intent": "director",
            "role": "region_admin",
        })
        self.assertEqual(out["role"], "event_td")

    def test_find_central_saturday(self):
        found = request(BASE, "GET", "/api/events/search?q=central")
        slugs = [e["slug"] for e in found["events"]]
        self.assertIn("central-saturday", slugs)

    def test_year_2026_includes_hawks(self):
        board = request(BASE, "GET", "/api/year/2026/board")
        self.assertEqual(board["year"], "2026")
        names = [t["name"] for t in board["teams"]]
        self.assertIn("Hawks 10U", names)
        self.assertTrue(any(e["slug"] == "central-saturday" for e in board["events"]))
        self.assertTrue(board["hitting"])
        hit_names = [r["name_key"] for r in board["hitting"]]
        self.assertIn("Maeve D #4", hit_names)

    def test_keystone_clash_from_popup(self):
        found = request(BASE, "GET", "/api/events/search?q=keystone")
        slugs = [e["slug"] for e in found["events"]]
        self.assertIn("keystone-clash-2026", slugs)
        ev = next(e for e in found["events"] if e["slug"] == "keystone-clash-2026")
        self.assertEqual(ev["source"], "popup")
        self.assertFalse(ev["signup_open"])

        board = request(BASE, "GET", "/api/event/keystone-clash-2026/board")
        names = [t["name"] for t in board["roster"]]
        self.assertEqual(len(names), 8)
        self.assertIn("Pittsburgh Passion", names)
        self.assertIn("Lady Dukes WPA 2033", names)
        passion = next(t for t in board["roster"] if t["name"] == "Pittsburgh Passion")
        self.assertTrue(passion["gc_linked"])
        self.assertIn("web.gc.com/teams/Lk2mlbKyLsGh", passion["gamechanger_url"])
        dukes = next(t for t in board["roster"] if t["name"] == "Lady Dukes WPA 2033")
        self.assertTrue(dukes["host"])

        pool = board["standings"][0]["teams"]
        self.assertEqual(pool[0]["name"], "All American Prady")
        self.assertEqual(pool[0]["seed"], 1)
        self.assertEqual(pool[0]["w"], 2)
        self.assertEqual(pool[2]["name"], "Pittsburgh Passion")

        final = next(g for g in board["bracket"] if g["round"] == "F")
        self.assertEqual(final["winner"], "Pittsburgh Passion")
        self.assertEqual(final["home_runs"] + 0, final["home_runs"])
        self.assertTrue(final["winner"] in (final["home"], final["away"]))
        self.assertIn(8, (final["home_runs"], final["away_runs"]))
        self.assertIn(5, (final["home_runs"], final["away_runs"]))

        seventh = next(g for g in board["bracket"] if g["round"] == "7TH")
        self.assertTrue(seventh["tie"])
        self.assertEqual(seventh["side"], "consolation")

        self.assertEqual(board["packet"]["champion"]["team"], "Pittsburgh Passion")
        self.assertTrue(board["leaders"]["published_hitting"])
        self.assertEqual(board["leaders"]["published_hitting"][0]["player"], "Lily M #15")

        year = request(BASE, "GET", "/api/year/2026/board")
        year_names = [t["name"] for t in year["teams"]]
        self.assertIn("Pittsburgh Passion", year_names)
        top = next(t for t in year["teams"] if t["name"] == "Pittsburgh Passion")
        self.assertEqual(top["w"], 5)

    def test_popup_import_rejects_other_sites(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", "/api/events/import-popup", td, {
                "url": "https://example.com/not-keystone",
            })
        self.assertIn("Keystone", str(bad.exception))

    def test_signup_without_gamechanger_and_admin_team(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        ev = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Paper Book Open",
            "slug": "paper-book-open",
        })
        slug = ev["event"]["slug"]
        joined = request(BASE, "POST", f"/api/events/{slug}/signup", None, {
            "team_name": "Clipboards 10U",
            "contact_name": "Coach Lee",
        })
        self.assertFalse(joined["team"]["gc_linked"])
        self.assertTrue(joined["team"]["club"])
        owner = auth(BASE, "owner@local.test", "RegionAdmin1!")
        clubs = request(BASE, "GET", "/api/admin/clubs", owner)
        self.assertTrue(any(c["name"] == "Clipboards 10U" for c in clubs["clubs"]))
        saved = request(BASE, "POST", "/api/admin/clubs", owner, {
            "name": "Riverside 12U",
            "ages": "12U",
            "notes": "No GameChanger. Scorebook only.",
        })
        self.assertFalse(saved["club"]["gc_linked"])
        self.assertEqual(saved["club"]["notes"], "No GameChanger. Scorebook only.")


if __name__ == "__main__":
    unittest.main()
