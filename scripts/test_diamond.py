#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.standings import sort_pool
from scripts.pb_client import auth, request, request_multipart

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

    def test_guidelines_and_required_packet(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Packet Classic",
            "slug": "packet-classic",
            "governing_body": "usa_softball",
            "pitch_limit_mode": "ip",
            "pitch_limit_ip": 6,
            "require_insurance": True,
            "require_roster": True,
            "require_birth_certs": False,
            "packet_notes": "Insurance and roster before first pitch.",
        })
        slug = created["event"]["slug"]
        self.assertEqual(created["event"]["governing_body"], "usa_softball")
        self.assertEqual(created["event"]["pitch_limit_mode"], "ip")
        self.assertIn("insurance", created["event"]["required_docs"])
        self.assertIn("roster", created["event"]["required_docs"])
        self.assertNotIn("birth_certs", created["event"]["required_docs"])

        with self.assertRaises(RuntimeError) as missing:
            request(BASE, "POST", f"/api/events/{slug}/signup", None, {
                "team_name": "No Packet 10U",
                "contact_name": "Coach",
            })
        self.assertIn("insurance", str(missing.exception).lower())

        director_later = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Late Paper 10U",
            "as_director": True,
        })
        self.assertEqual(director_later["team"]["signed_up_by"], "director")
        self.assertFalse(director_later["team"]["packet"]["complete"])

        pdf = (ROOT / "testdata" / "packet" / "insurance.pdf").read_bytes()
        joined = request_multipart(BASE, f"/api/events/{slug}/signup", None, {
            "team_name": "Hawks Packet 10U",
            "contact_name": "Coach Kim",
        }, {
            "insurance": ("insurance.pdf", pdf, "application/pdf"),
            "roster": ("roster.pdf", pdf, "application/pdf"),
        })
        self.assertTrue(joined["team"]["packet"]["complete"])
        self.assertEqual(joined["team"]["packet"]["status"], "submitted")
        kinds = {d["kind"] for d in joined["team"]["packet"]["docs"]}
        self.assertEqual(kinds, {"insurance", "roster"})


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
        self.assertEqual(board["event"]["governing_body"], "usa_softball")
        self.assertEqual(board["event"]["pitch_limit_mode"], "ip")
        self.assertIn("insurance", board["event"]["required_docs"])
        self.assertIn("roster", board["event"]["required_docs"])
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

    def test_local_popup_server_pages(self):
        import urllib.request
        for path in (
            "/popup/index.html",
            "/popup/data.json",
            "/popup/stats.html",
            "/popup/stats.json",
            "/popup/full-rules.html",
            "/popup/rain-update.html",
            "/popup/raffle.html",
            "/t/keystone-clash-2026",
            "/t/keystone-clash-2026/stats",
        ):
            with urllib.request.urlopen(BASE + path, timeout=10) as resp:
                self.assertEqual(resp.status, 200, path)
                body = resp.read()
                self.assertGreater(len(body), 200, path)

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


class ScheduleTests(unittest.TestCase):
    def test_create_fields_auto_schedule_and_rain(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "field-classic-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Field Classic",
            "slug": slug,
            "venue": "Harbor Complex",
            "address": "100 Harbor Rd, Pittsburgh, PA",
            "lat": 40.44,
            "lng": -80.0,
            "format": "pool-to-bracket",
            "start": "2026-09-19",
            "end": "2026-09-20",
            "game_length_minutes": 75,
            "fields": [
                {"name": "Harbor 1", "address": "100 Harbor Rd, Pittsburgh, PA", "lat": 40.4401, "lng": -80.0001},
                {"name": "Harbor 2", "address": "100 Harbor Rd, Pittsburgh, PA", "lat": 40.4402, "lng": -80.0002},
            ],
        })
        self.assertEqual(created["event"]["address"], "100 Harbor Rd, Pittsburgh, PA")
        self.assertEqual(created["event"]["format"], "pool-to-bracket")
        self.assertAlmostEqual(float(created["event"]["lat"]), 40.44, places=2)
        names = [f["name"] for f in created["event"]["fields"]]
        self.assertIn("Harbor 1", names)
        self.assertIn("Harbor 2", names)
        self.assertTrue(any(f.get("map_url") for f in created["event"]["fields"]))
        slug = created["event"]["slug"]

        for name, pool in (("Harbor Hawks", "A"), ("Harbor Heat", "A"), ("River Cats", "B"), ("River Fox", "B")):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": pool,
                "as_director": True,
            })

        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-19"],
            "start_time": "08:00",
            "end_time": "18:00",
            "games_per_team": 1,
            "replace": True,
            "format": "pool-to-bracket",
        })
        self.assertGreaterEqual(auto["games"], 2)
        self.assertEqual(set(auto["fields"]), {"Harbor 1", "Harbor 2"})
        seen_slots = set()
        team_slots = set()
        for game in auto["schedule"]:
            if game["status"] in ("postponed", "rained_out"):
                continue
            slot = (game["date"], game["time"], game["field"])
            self.assertNotIn(slot, seen_slots, f"double-booked field {slot}")
            seen_slots.add(slot)
            for team in (game["home"], game["away"]):
                key = (game["date"], game["time"], team)
                self.assertNotIn(key, team_slots, f"team double-booked {key}")
                team_slots.add(key)
            self.assertIn(game["field"], ("Harbor 1", "Harbor 2"))

        rain = request(BASE, "POST", f"/api/events/{slug}/rain", td, {
            "rain_status": "delay",
            "rain_note": "Lightning. First pitch 09:00.",
            "delay_minutes": 60,
            "date": "2026-09-19",
            "after_time": "08:00",
        })
        self.assertEqual(rain["event"]["rain_status"], "delay")
        self.assertGreaterEqual(rain["shifted"], 1)
        delayed = next(g for g in rain["schedule"] if g["delayed_from"])
        self.assertEqual(delayed["delayed_from"], "08:00")
        self.assertEqual(delayed["time"], "09:00")

        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(board["event"]["rain_status"], "delay")
        self.assertIn("Lightning", board["event"]["rain_note"])
        self.assertTrue(any(g.get("field") for g in board["schedule"]))
        self.assertGreaterEqual(len(board["fields"]), 2)
        self.assertTrue(all(g.get("home") and g.get("away") and g.get("field") for g in board["schedule"]))
        built = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "consolation": True,
            "replace": True,
        })
        self.assertGreaterEqual(built["games"], 1)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertTrue(any(g["round"] == "F" for g in board["bracket"]))
        self.assertTrue(all(g.get("home") and g.get("away") for g in board["schedule"]))

        moved = request(BASE, "POST", f"/api/events/{slug}/rain", td, {
            "rain_status": "moved",
            "rain_note": "Sunday at the indoor.",
            "move_from": "2026-09-19",
            "move_to": "2026-09-20",
        })
        self.assertGreaterEqual(moved["moved"], 1)
        self.assertTrue(all(g["date"] == "2026-09-20" for g in moved["schedule"] if g["status"] != "final"))

    def test_director_and_manager_can_score_and_upload_box(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "score-classic-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Score Classic",
            "slug": slug,
            "format": "pool-only",
            "fields": [{"name": "Diamond 1"}, {"name": "Diamond 2"}],
        })
        slug = created["event"]["slug"]
        email = f"mgr.{uuid.uuid4().hex[:8]}@local.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "CoachScore1!",
            "display_name": "Coach Score",
            "intent": "team",
        })
        mgr = auth(BASE, email, "CoachScore1!")
        request(BASE, "POST", f"/api/events/{slug}/signup", mgr, {
            "team_name": "Score Hawks",
            "pool": "A",
            "contact_name": "Coach Score",
            "contact_email": email,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Score Heat",
            "pool": "A",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Score Cats",
            "pool": "B",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Score Fox",
            "pool": "B",
            "as_director": True,
        })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-19"],
            "games_per_team": 1,
            "replace": True,
            "format": "pool-only",
        })
        self.assertGreaterEqual(len(auto["schedule"]), 2)
        self.assertTrue(all(g["home"] and g["away"] for g in auto["schedule"]))
        mine = next(g for g in auto["schedule"] if "Score Hawks" in (g["home"], g["away"]))
        other = next(g for g in auto["schedule"] if "Score Hawks" not in (g["home"], g["away"]))

        posted = request(BASE, "POST", f"/api/events/{slug}/schedule/{mine['id']}/score", mgr, {
            "home_runs": 6,
            "away_runs": 2,
        })
        self.assertEqual(posted["game"]["status"], "submitted")
        self.assertEqual(int(posted["game"]["home_runs"]), 6)

        with self.assertRaises(RuntimeError) as forbidden:
            request(BASE, "POST", f"/api/events/{slug}/schedule/{other['id']}/score", mgr, {
                "home_runs": 1,
                "away_runs": 0,
            })
        self.assertIn("manager", str(forbidden.exception).lower())

        final = request(BASE, "POST", f"/api/events/{slug}/schedule/{mine['id']}/score", td, {
            "home_runs": 7,
            "away_runs": 2,
            "status": "final",
            "confirm": True,
        })
        self.assertEqual(final["game"]["status"], "final")
        self.assertEqual(int(final["game"]["home_runs"]), 7)

        pdf = (ROOT / "testdata" / "packet" / "insurance.pdf").read_bytes()
        boxed = request_multipart(BASE, f"/api/events/{slug}/schedule/{mine['id']}/box", mgr, {
            "note": "Scorebook page 1",
            "hitting": "home,hit,4,Maeve D,4,1,2,1,0,0",
        }, {
            "file": ("box.pdf", pdf, "application/pdf"),
        })
        self.assertTrue(boxed["box"]["url"])
        self.assertEqual(boxed["box"]["status"], "submitted")

        board = request(BASE, "GET", f"/api/event/{slug}/board", td)
        scored = next(g for g in board["schedule"] if g["id"] == mine["id"])
        self.assertTrue(scored["can_score"])
        self.assertTrue(scored["has_box"])
        self.assertEqual(scored["status"], "final")

    def test_four_stats_upload_routes(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "stats-doors-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Stats Doors",
            "slug": slug,
            "format": "pool-only",
            "fields": [{"name": "Main"}],
        })
        slug = created["event"]["slug"]
        email = f"gc.{uuid.uuid4().hex[:8]}@local.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "CoachScore1!",
            "display_name": "GC Coach",
            "intent": "team",
        })
        mgr = auth(BASE, email, "CoachScore1!")
        request(BASE, "POST", f"/api/events/{slug}/signup", mgr, {
            "team_name": "Dukes Stats",
            "pool": "A",
            "contact_email": email,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Heat Stats",
            "pool": "A",
            "as_director": True,
        })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-19"],
            "games_per_team": 1,
            "replace": True,
            "format": "pool-only",
        })
        game_id = auto["schedule"][0]["id"]
        pdf = (ROOT / "testdata" / "packet" / "insurance.pdf").read_bytes()
        gc_box = (
            "https://web.gc.com/teams/Qgojbuf369Eu/"
            "2027-spring-lady-dukes-wpa-2033/schedule/"
            "d1ed080a-d4da-42a2-9dfb-1813c9272d5f/box-score"
        )

        mobile = request_multipart(BASE, f"/api/events/{slug}/schedule/{game_id}/box", mgr, {
            "source": "gc_pdf",
            "note": "GC app export",
        }, {"file": ("gc-mobile.pdf", pdf, "application/pdf")})
        self.assertEqual(mobile["box"]["source"], "gc_pdf")
        self.assertEqual(mobile["box"]["status"], "queued")
        self.assertTrue(mobile["box"]["queued_for_bot"])

        linked = request(BASE, "POST", f"/api/events/{slug}/schedule/{game_id}/box", mgr, {
            "source": "gc_url",
            "gc_url": gc_box,
        })
        self.assertEqual(linked["box"]["source"], "gc_url")
        self.assertEqual(linked["box"]["gc_url"], gc_box)
        self.assertEqual(linked["box"]["status"], "queued")

        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", f"/api/events/{slug}/schedule/{game_id}/box", mgr, {
                "gc_url": "https://example.com/not-gc",
            })
        self.assertIn("GameChanger", str(bad.exception))

        bot = auth(BASE, "bot@local.test", "BotStaging1!")
        inbox = request(BASE, "GET", f"/api/bot/event-boxes?event={slug}", bot)
        self.assertTrue(any(b["schedule_id"] == game_id for b in inbox["boxes"]))
        extracted = request(BASE, "POST", "/api/bot/event-box", bot, {
            "event_slug": slug,
            "schedule_id": game_id,
            "home_runs": 8,
            "away_runs": 3,
            "gc_url": gc_box,
            "hitting": [{"side": "home", "jersey": "4", "name": "Maeve D", "ab": 3, "r": 1, "h": 2, "rbi": 1, "bb": 0, "so": 0}],
            "pitching": [{"side": "home", "jersey": "7", "name": "Sam P", "ip": "4.0", "h": 2, "r": 1, "er": 1, "bb": 0, "so": 4}],
            "parser_notes": "Read from the public box the coach pasted.",
        })
        self.assertEqual(extracted["box"]["source"], "bot")
        self.assertEqual(extracted["box"]["status"], "approved")

        director = request_multipart(BASE, f"/api/events/{slug}/schedule/{game_id}/box", td, {
            "source": "director_pdf",
            "approve_file": "true",
            "note": "TD plate-meeting copy",
        }, {"file": ("td-book.pdf", pdf, "application/pdf")})
        self.assertEqual(director["box"]["source"], "director_pdf")
        self.assertEqual(director["box"]["status"], "approved")

        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        sources = {b["source"] for b in plan.get("pending_boxes", [])}
        self.assertNotIn("director_pdf", sources)

    def test_bracket_field_time_and_overall_schedule(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "bracket-desk-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Bracket Desk",
            "slug": slug,
            "format": "pool-to-bracket",
            "start": "2026-09-19",
            "end": "2026-09-20",
            "fields": [{"name": "Harbor 1"}, {"name": "Harbor 2"}],
        })
        slug = created["event"]["slug"]
        for name, pool in (("Desk Hawks", "A"), ("Desk Heat", "A"), ("Desk Cats", "B"), ("Desk Fox", "B")):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": pool,
                "as_director": True,
            })
        request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-19"],
            "start_time": "08:00",
            "games_per_team": 1,
            "replace": True,
            "format": "pool-to-bracket",
        })
        built = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "consolation": True,
            "replace": True,
        })
        self.assertGreaterEqual(built["games"], 1)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        final = next(g for g in board["bracket"] if g["round"] == "F")
        self.assertIn("field", final)
        self.assertIn("time", final)
        self.assertTrue(any(row["kind"] == "pool" for row in board["overall"]))
        self.assertTrue(any(row["kind"] == "bracket" and row["round"] == "F" for row in board["overall"]))

        saved = request(BASE, "POST", f"/api/events/{slug}/bracket/{final['id']}", td, {
            "field": "Harbor 2",
            "time": "11:30",
            "date": "2026-09-20",
        })
        slot = next(g for g in saved["bracket"] if g["id"] == final["id"])
        self.assertEqual(slot["field"], "Harbor 2")
        self.assertEqual(slot["time"], "11:30")
        self.assertEqual(slot["date"], "2026-09-20")

        qf = next(g for g in board["bracket"] if g["round"] in ("QF", "SF", "F") and g["home"] and g["away"])
        home_before, away_before = qf["home"], qf["away"]
        request(BASE, "POST", f"/api/events/{slug}/bracket/{qf['id']}/score", td, {
            "home_runs": 8,
            "away_runs": 1,
        })
        request(BASE, "POST", f"/api/events/{slug}/bracket/{qf['id']}", td, {
            "field": "Harbor 1",
            "time": "09:15",
        })
        after_time = request(BASE, "GET", f"/api/event/{slug}/board")
        still = next(g for g in after_time["bracket"] if g["id"] == qf["id"])
        self.assertEqual(still["status"], "final")
        self.assertEqual(int(still["home_runs"]), 8)
        self.assertEqual(still["field"], "Harbor 1")
        self.assertEqual(still["time"], "09:15")

        swapped = request(BASE, "POST", f"/api/events/{slug}/bracket/{qf['id']}", td, {
            "swap": True,
            "protest_note": "Seed restored after protest",
        })
        moved = next(g for g in swapped["bracket"] if g["id"] == qf["id"])
        self.assertEqual(moved["home"], away_before)
        self.assertEqual(moved["away"], home_before)
        self.assertEqual(moved["status"], "scheduled")
        self.assertEqual(moved["protest_note"], "Seed restored after protest")

        seats = request(BASE, "POST", f"/api/events/{slug}/bracket/swap", td, {
            "from_id": moved["id"],
            "from_seat": "home",
            "to_id": moved["id"],
            "to_seat": "away",
            "protest_note": "Home/away flipped again",
        })
        self.assertTrue(seats["swapped"])
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        overall_final = next(row for row in board["overall"] if row["id"] == final["id"])
        self.assertEqual(overall_final["field"], "Harbor 2")
        self.assertEqual(overall_final["time"], "11:30")
        self.assertEqual(overall_final["kind"], "bracket")

    def test_field_day_hours_skip_closed_diamond(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "hours-classic-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Hours Classic",
            "slug": slug,
            "format": "pool-only",
            "start": "2026-09-19",
            "end": "2026-09-20",
            "hours_start": "08:00",
            "hours_end": "18:00",
            "game_length_minutes": 90,
            "fields": [
                {"name": "Harbor 1"},
                {"name": "Harbor 2", "availability": [
                    {"date": "2026-09-19", "available": True, "start": "08:00", "end": "12:00"},
                    {"date": "2026-09-20", "available": False, "start": "08:00", "end": "18:00"},
                ]},
            ],
        })
        slug = created["event"]["slug"]
        self.assertEqual(created["event"]["hours_start"], "08:00")
        harbor2 = next(f for f in created["event"]["fields"] if f["name"] == "Harbor 2")
        sat = next(w for w in harbor2["windows"] if w["date"] == "2026-09-19")
        sun = next(w for w in harbor2["windows"] if w["date"] == "2026-09-20")
        self.assertEqual(sat["end"], "12:00")
        self.assertFalse(sun["available"])
        for name, pool in (("Hours Hawks", "A"), ("Hours Heat", "A"), ("Hours Cats", "B"), ("Hours Fox", "B")):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": pool,
                "as_director": True,
            })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-19", "2026-09-20"],
            "games_per_team": 1,
            "replace": True,
            "format": "pool-only",
        })
        self.assertGreaterEqual(auto["games"], 2)
        for game in auto["schedule"]:
            if game["field"] != "Harbor 2":
                continue
            self.assertEqual(game["date"], "2026-09-19")
            hh, mm = game["time"].split(":")
            start = int(hh) * 60 + int(mm)
            self.assertLessEqual(start + 90, 12 * 60)

    def test_keystone_fields_and_rain_note(self):
        board = request(BASE, "GET", "/api/event/keystone-clash-2026/board")
        self.assertEqual(board["event"]["address"], "51 Meadow St, McDonald, PA 15057")
        self.assertEqual(board["event"]["rain_status"], "moved")
        self.assertIn("No Offseason", board["event"]["rain_note"])
        names = [f["name"] for f in board["fields"]]
        self.assertIn("East End 1", names)
        self.assertIn("No Offseason", names)


if __name__ == "__main__":
    unittest.main()
