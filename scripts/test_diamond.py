#!/usr/bin/env python3
from __future__ import annotations

import os
import struct
import sys
import unittest
import urllib.request
import uuid
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.exif import strip_exif
from lib.standings import sort_pool, parse_order, win_pct
from scripts.bot_gc_monitor import is_public_gc_url, load_watch
from scripts.pb_client import auth, request, request_multipart

BASE = os.environ.get("PB_URL") or f"http://127.0.0.1:{os.environ.get('PB_PORT', '8097')}"


class TiebreakTests(unittest.TestCase):
    def test_h2h_before_run_diff(self):
        a = {"id": "a", "name": "A", "w": 1, "l": 1, "t": 0, "rs": 20, "ra": 3}
        b = {"id": "b", "name": "B", "w": 1, "l": 1, "t": 0, "rs": 8, "ra": 3}
        games = [{"home": "a", "away": "b", "home_runs": 2, "away_runs": 5}]
        ranked = sort_pool([a, b], games)
        self.assertEqual(ranked[0]["id"], "b")
        self.assertIn("head-to-head", ranked[0]["seed_reason"])

    def test_three_team_cycle_skips_h2h(self):
        # Derek's rain-out repro: A beat B 5-3, B beat C 4-2, C beat A 6-5. All 1-1.
        a = {"id": "a", "name": "A", "w": 1, "l": 1, "t": 0, "rs": 10, "ra": 9}
        b = {"id": "b", "name": "B", "w": 1, "l": 1, "t": 0, "rs": 7, "ra": 7}
        c = {"id": "c", "name": "C", "w": 1, "l": 1, "t": 0, "rs": 8, "ra": 9}
        games = [
            {"home": "a", "away": "b", "home_runs": 5, "away_runs": 3},
            {"home": "b", "away": "c", "home_runs": 4, "away_runs": 2},
            {"home": "c", "away": "a", "home_runs": 6, "away_runs": 5},
        ]
        ranked = sort_pool([a, b, c], games)
        self.assertEqual([row["id"] for row in ranked], ["b", "a", "c"])
        self.assertIn("cycle", ranked[0]["seed_reason"])
        self.assertIn("runs allowed", ranked[0]["seed_reason"])
        self.assertIn("differential", ranked[1]["seed_reason"])

    def test_win_pct_counts_tie_as_half(self):
        # Old W-then-L would rank A (3 wins) above B (2 wins). Win% does not.
        a = {"id": "a", "name": "A", "w": 3, "l": 2, "t": 0, "rs": 20, "ra": 10}
        b = {"id": "b", "name": "B", "w": 2, "l": 0, "t": 1, "rs": 8, "ra": 4}
        self.assertGreater(win_pct(b), win_pct(a))
        ranked = sort_pool([a, b], [])
        self.assertEqual(ranked[0]["id"], "b")

    def test_custom_order_can_put_ra_before_h2h(self):
        a = {"id": "a", "name": "A", "w": 1, "l": 1, "t": 0, "rs": 6, "ra": 2}
        b = {"id": "b", "name": "B", "w": 1, "l": 1, "t": 0, "rs": 8, "ra": 7}
        games = [{"home": "a", "away": "b", "home_runs": 2, "away_runs": 5}]
        default = sort_pool([dict(a), dict(b)], games)
        self.assertEqual(default[0]["id"], "b")
        custom = sort_pool([dict(a), dict(b)], games, ["record", "ra", "h2h", "diff", "rs"])
        self.assertEqual(custom[0]["id"], "a")
        self.assertEqual(parse_order("record, ra, h2h"), ["record", "ra", "h2h", "diff", "rs"])
        self.assertEqual(parse_order({"order": ["record", "ra"], "explicit": True}), ["record", "ra"])


class InstallScriptTests(unittest.TestCase):
    def test_release_asset_mapping(self):
        def asset(system, machine):
            env = os.environ.copy()
            env["PB_UNAME_S"] = system
            env["PB_UNAME_M"] = machine
            import subprocess
            return subprocess.check_output(
                ["bash", str(ROOT / "scripts/install-pocketbase.sh"), "--print-asset"],
                env=env,
                text=True,
            ).strip()

        self.assertEqual(asset("Linux", "x86_64"), "linux_amd64")
        self.assertEqual(asset("Darwin", "arm64"), "darwin_arm64")
        self.assertEqual(asset("Darwin", "x86_64"), "darwin_amd64")
        self.assertEqual(asset("Linux", "aarch64"), "linux_arm64")

    def test_devcontainer_forwards_pocketbase(self):
        src = (ROOT / ".devcontainer/devcontainer.json").read_text()
        self.assertIn("8097", src)
        self.assertIn("install-pocketbase.sh", src)
        self.assertIn("ensure-pocketbase.sh", src)


class TournamentUiTests(unittest.TestCase):
    def test_standings_tab_game_numbers_and_save_toast(self):
        chrome = (ROOT / "pb/pb_public/js/chrome.js").read_text()
        event = (ROOT / "pb/pb_public/js/event.js").read_text()
        app = (ROOT / "pb/pb_public/js/app.js").read_text()
        css = (ROOT / "pb/pb_public/css/app.css").read_text()
        self.assertIn("`/t/${slug}/standings`", chrome)
        self.assertIn('"Standings"', chrome)
        self.assertIn("export function flashSaved", chrome)
        self.assertIn("#save-toast", css)
        self.assertIn("eventStandings", app)
        self.assertIn("/standings", app)
        self.assertIn("data-autosave-box", event)
        self.assertIn("flashSaved", event)
        self.assertIn("function gameNo", event)
        self.assertIn('input[type=file]', event)
        self.assertIn("seed-why", event)
        self.assertIn("setupTiebreakFields", event)
        self.assertIn("directorDuplicate", event)
        self.assertIn("directors\\/duplicate", app)
        self.assertIn(".tiebreak-order", css)
        self.assertIn("setupAgeFields", event)
        self.assertIn('pitch_limit_mode || "none"', event)
        self.assertIn("Nudge the map pin", event)
        self.assertIn("tb-remove", event)
        self.assertIn("Head to head first", event)
        self.assertIn("Fields and facilities only", event)
        self.assertIn("/verify", app)
        self.assertIn("verifyPage", app)
        self.assertIn("Forgot my password", (ROOT / "pb/pb_public/js/flow.js").read_text())
        self.assertIn("/forgot", app)
        self.assertIn("/admin/events", app)
        self.assertIn("loginWithPassword", chrome)
        self.assertIn("_superusers", chrome)
        self.assertIn("canAdminEvent", chrome)
        self.assertIn("This is not your tournament", event)
        self.assertIn("Remove this tournament", event)
        self.assertIn("btn danger", (ROOT / "pb/pb_public/css/app.css").read_text())

    def test_match_card_starts_collapsed(self):
        src = (ROOT / "pb/pb_public/js/event.js").read_text()
        css = (ROOT / "pb/pb_public/css/app.css").read_text()
        self.assertIn('<details class="bk-desk-box">', src)
        self.assertNotIn('${set ? "" : "open"}', src)
        desk = src.split("function matchCard", 1)[1].split("function renderBracketTree", 1)[0]
        self.assertIn("bk-score", desk)
        self.assertLess(desk.find("class=\"bk-score\""), desk.find("</details>"))
        self.assertGreater(desk.find("</details>"), desk.find("data-bk-id"))
        self.assertIn(".bk-desk-box:not([open]) > *:not(summary)", css)


class BoardTests(unittest.TestCase):
    def test_harbor_eight_game_numbers(self):
        board = request(BASE, "GET", "/api/event/harbor-eight/board")
        pool = [g for g in board["schedule"] if g.get("home") and g.get("away")]
        bracket = board["bracket"]
        self.assertTrue(pool)
        self.assertTrue(bracket)
        nums = [int(g.get("game_number") or 0) for g in pool + bracket]
        self.assertTrue(all(n > 0 for n in nums), nums)
        self.assertEqual(len(nums), len(set(nums)))
        overall = [int(g.get("game_number") or 0) for g in board["overall"]]
        self.assertTrue(all(n > 0 for n in overall), overall)

    def test_new_event_assigns_game_numbers(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "game-numbers-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Game Numbers Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "start": "2026-10-10",
            "end": "2026-10-11",
            "format": "pool-to-bracket",
            "hours_start": "08:00",
            "hours_end": "18:00",
            "fields": [{"name": "Harbor 1"}, {"name": "Harbor 2"}],
        })
        for name, pool in (("Num Hawks", "A"), ("Num Heat", "A"), ("Num Cats", "B"), ("Num Fox", "B")):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": pool,
                "as_director": True,
            })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-10-10"],
            "games_per_team": 1,
            "replace": True,
            "draw_bracket": True,
            "format": "pool-to-bracket",
        })
        self.assertGreaterEqual(auto["games"], 2)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        pool_nums = [int(g.get("game_number") or 0) for g in board["schedule"]]
        bracket_nums = [int(g.get("game_number") or 0) for g in board["bracket"]]
        self.assertTrue(all(n > 0 for n in pool_nums), pool_nums)
        self.assertTrue(all(n > 0 for n in bracket_nums), bracket_nums)
        self.assertEqual(len(pool_nums + bracket_nums), len(set(pool_nums + bracket_nums)))
        added = request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Num Hawks",
            "away": "Num Heat",
            "date": "2026-10-11",
            "time": "09:00",
            "field": "Harbor 1",
            "pool": "A",
        })
        self.assertGreater(int(added["game"]["game_number"] or 0), max(pool_nums))

    def test_harbor_eight_board(self):
        board = request(BASE, "GET", "/api/event/harbor-eight/board")
        self.assertEqual(board["event"]["slug"], "harbor-eight")
        self.assertIn("FAKE", board["event"]["name"])
        names = [t["name"] for t in board["roster"]]
        self.assertEqual(len(names), 8)
        self.assertTrue(all("FAKE" in n for n in names))
        pools = {p["name"]: p["teams"] for p in board["standings"]}
        self.assertEqual(len(pools["A"]), 4)
        self.assertEqual(len(pools["B"]), 4)
        self.assertTrue(all(t["w"] == 0 and t["l"] == 0 for t in pools["A"] + pools["B"]))
        pool_games = [g for g in board["schedule"] if g.get("pool") in ("A", "B")]
        self.assertEqual(len(pool_games), 12)
        self.assertTrue(all(g["status"] == "scheduled" for g in pool_games))
        qf = [g for g in board["bracket"] if g["round"] == "QF"]
        self.assertEqual(len(qf), 4)
        self.assertTrue(all((g.get("side") or "championship") == "championship" for g in qf))
        fifth = next(g for g in board["bracket"] if g["round"] == "5TH")
        self.assertEqual(fifth["side"], "consolation")
        # No invented boxes — leaders stay empty until someone types lines.
        self.assertFalse(board["leaders"].get("hitting"))

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


class DerekFixesLiveTests(unittest.TestCase):
    def test_board_ranks_three_team_cycle_by_ra_then_diff(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "cycle-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Cycle Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "format": "pool-only",
            "tiebreak_order": "record,h2h,ra,diff,rs",
        })
        self.assertEqual(created["event"]["tiebreak"]["order"][0], "record")
        slug = created["event"]["slug"]
        for name in ("Cycle A", "Cycle B", "Cycle C"):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": "A",
                "as_director": True,
            })
        scores = (
            ("Cycle A", "Cycle B", 5, 3),
            ("Cycle B", "Cycle C", 4, 2),
            ("Cycle C", "Cycle A", 6, 5),
        )
        for home, away, hr, ar in scores:
            game = request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
                "home": home,
                "away": away,
                "date": "2026-10-18",
                "time": "09:00",
                "pool": "A",
            })
            request(BASE, "POST", f"/api/events/{slug}/schedule/{game['game']['id']}/score", td, {
                "home_runs": hr,
                "away_runs": ar,
                "status": "final",
                "confirm": True,
            })
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        pool = next(row for row in board["standings"] if row["name"] == "A")
        self.assertEqual([t["name"] for t in pool["teams"]], ["Cycle B", "Cycle A", "Cycle C"])
        self.assertIn("cycle", pool["teams"][0]["seed_reason"])
        self.assertIn("head-to-head", pool.get("tiebreak_label") or "")

    def test_duplicate_skips_scores_and_family_email(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        src = "dup-src-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Original Weekend",
            "slug": src,
            "venue": "East End Park",
            "ages": "10U",
            "format": "pool-only",
            "tiebreak_order": "record,ra,h2h,diff,rs",
            "fields": [{"name": "East 1"}],
        })
        self.assertEqual(created["event"]["tiebreak"]["order"][:2], ["record", "ra"])
        family = f"parent.{uuid.uuid4().hex[:8]}@family.test"
        request(BASE, "POST", f"/api/events/{src}/signup", td, {
            "team_name": "Oaks FAKE",
            "pool": "A",
            "contact_name": "Coach Parent",
            "contact_email": family,
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{src}/signup", td, {
            "team_name": "River FAKE",
            "pool": "A",
            "as_director": True,
        })
        game = request(BASE, "POST", f"/api/events/{src}/schedule/game", td, {
            "home": "Oaks FAKE",
            "away": "River FAKE",
            "date": "2026-09-12",
            "time": "10:00",
            "field": "East 1",
            "pool": "A",
        })
        request(BASE, "POST", f"/api/events/{src}/schedule/{game['game']['id']}/score", td, {
            "home_runs": 8,
            "away_runs": 1,
            "status": "final",
            "confirm": True,
        })
        dest = "dup-dest-" + uuid.uuid4().hex[:8]
        copied = request(BASE, "POST", f"/api/events/{src}/duplicate", td, {
            "name": "Copied Weekend",
            "slug": dest,
            "start": "2027-09-11",
            "end": "2027-09-12",
        })
        self.assertEqual(copied["event"]["slug"], dest)
        self.assertEqual(copied["event"]["tiebreak"]["order"][:2], ["record", "ra"])
        self.assertEqual(copied["event"]["venue"], "East End Park")
        board = request(BASE, "GET", f"/api/event/{dest}/board")
        names = [t["name"] for t in board["roster"]]
        self.assertEqual(sorted(names), ["Oaks FAKE", "River FAKE"])
        self.assertTrue(all(g["status"] == "scheduled" for g in board["schedule"]))
        self.assertTrue(all(g.get("home_runs") in (None, "", 0) or g["status"] != "final" for g in board["schedule"]))
        self.assertTrue(all(t["w"] == 0 and t["l"] == 0 for p in board["standings"] for t in p["teams"]))
        from urllib.parse import quote
        admin = auth(BASE, "owner@local.test", "RegionAdmin1!")
        filt = quote(f"event='{copied['event']['id']}'")
        teams = request(BASE, "GET", f"/api/collections/event_teams/records?filter={filt}&perPage=50", admin)
        copied_teams = teams.get("items", [])
        self.assertEqual(len(copied_teams), 2)
        self.assertTrue(all(not row.get("contact_email") for row in copied_teams))
        self.assertTrue(all(not row.get("contact_name") for row in copied_teams))


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

    def test_pocketbase_admin_is_site_admin(self):
        token = auth(BASE, "admin@local.test", "SoftballAdmin1!", "_superusers")
        home = request(BASE, "GET", "/api/account/home", token)
        self.assertTrue(home["user"]["site_admin"])
        self.assertEqual(home["user"]["email"], "admin@local.test")
        events = request(BASE, "GET", "/api/admin/events", token)
        slugs = [e["slug"] for e in events["events"]]
        self.assertIn("keystone-clash-2026", slugs)
        clubs = request(BASE, "GET", "/api/admin/clubs", token)
        self.assertIn("clubs", clubs)

    def test_forgot_and_reset_password(self):
        email = f"reset.{uuid.uuid4().hex[:8]}@local.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "OldPass12!",
            "display_name": "Reset User",
            "intent": "director",
        })
        out = request(BASE, "POST", "/api/account/forgot", None, {"email": email})
        self.assertTrue(out.get("ok"))
        self.assertTrue(request(BASE, "POST", "/api/account/forgot", None, {"email": "nobody@nowhere.test"}).get("ok"))
        admin = auth(BASE, "owner@local.test", "RegionAdmin1!")
        from urllib.parse import quote
        users = request(BASE, "GET", f"/api/collections/users/records?filter={quote(f'email=\"{email}\"')}", admin)
        token = users["items"][0]["reset_token"]
        self.assertTrue(token)
        request(BASE, "POST", "/api/account/reset", None, {"token": token, "password": "NewPass12!"})
        auth(BASE, email, "NewPass12!")
        with self.assertRaises(RuntimeError):
            auth(BASE, email, "OldPass12!")

    def test_site_admin_removes_tournament_director_cannot(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "gone-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Temp Weekend",
            "slug": slug,
            "venue": "Temp Park",
            "ages": "10U",
        })
        with self.assertRaises(RuntimeError):
            request(BASE, "POST", f"/api/admin/events/{slug}/archive", td)
        owner = auth(BASE, "owner@local.test", "RegionAdmin1!")
        archived = request(BASE, "POST", f"/api/admin/events/{slug}/archive", owner)
        self.assertEqual(archived["event"]["status"], "archived")
        self.assertFalse(archived["event"]["public"])
        found = request(BASE, "GET", f"/api/events/search?q={slug}")
        self.assertNotIn(slug, [e["slug"] for e in found["events"]])
        slug2 = "wipe-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Wipe Weekend",
            "slug": slug2,
            "venue": "Wipe Park",
            "ages": "10U",
        })
        with self.assertRaises(RuntimeError):
            request(BASE, "POST", f"/api/admin/events/{slug2}/delete", td, {"confirm": True, "slug": slug2})
        admin = auth(BASE, "admin@local.test", "SoftballAdmin1!", "_superusers")
        deleted = request(BASE, "POST", f"/api/admin/events/{slug2}/delete", admin, {
            "confirm": True,
            "slug": slug2,
        })
        self.assertTrue(deleted["deleted"])
        with self.assertRaises(RuntimeError):
            request(BASE, "GET", f"/api/event/{slug2}/board")

    def test_stranger_event_td_cannot_run_someone_elses_weekend(self):
        from urllib.parse import quote

        email = f"stranger.{uuid.uuid4().hex[:8]}@nowhere.test"
        registered = request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "Stranger99!",
            "display_name": "Stranger",
            "intent": "director",
        })
        self.assertEqual(registered["role"], "event_td")
        token = auth(BASE, email, "Stranger99!")
        home = request(BASE, "GET", "/api/account/home", token)
        self.assertFalse(home["user"].get("site_admin"))
        self.assertNotIn("keystone-clash-2026", [e["slug"] for e in home["created"]])

        def denied(method, path, body=None, codes=("403",)):
            with self.assertRaises(RuntimeError) as caught:
                request(BASE, method, path, token, body)
            self.assertTrue(any(code in str(caught.exception) for code in codes), caught.exception)

        denied("POST", "/api/events/keystone-clash-2026/settings", {"venue": "STRANGER WAS HERE"})
        denied("POST", "/api/events/keystone-clash-2026/rain", {
            "rain_status": "cancelled",
            "rain_note": "STRANGER POSTED THIS",
        })
        denied("GET", "/api/events/keystone-clash-2026/boxes")
        denied("GET", "/api/bot/gc-monitor")
        denied("GET", "/api/bot/event-boxes")
        denied("POST", "/api/events/import-popup", {})
        denied("GET", "/api/admin/events")

        listed = request(
            BASE, "GET",
            f"/api/collections/events/records?filter={quote('slug=\"keystone-clash-2026\"')}&perPage=1",
            token,
        )
        kid = listed["items"][0]["id"]
        denied("PATCH", f"/api/collections/events/records/{kid}", {"venue": "STRANGER WAS HERE"}, codes=("403", "404"))
        board = request(BASE, "GET", "/api/event/keystone-clash-2026/board")
        self.assertNotEqual(board["event"]["venue"], "STRANGER WAS HERE")
        self.assertNotIn("STRANGER POSTED THIS", board["event"].get("rain_note") or "")
        game_id = next(g["id"] for g in board["schedule"] if g.get("id"))
        denied("POST", "/api/collections/event_boxes/records", {
            "schedule_row": game_id,
            "source": "hack",
            "note": "stolen box",
        }, codes=("403", "400", "404"))

        slug = "mine-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", token, {
            "source": "native",
            "name": "Stranger Open",
            "slug": slug,
            "venue": "Own Park",
            "ages": "10U",
        })
        self.assertEqual(created["event"]["created_by"], home["user"]["id"])
        saved = request(BASE, "POST", f"/api/events/{slug}/settings", token, {"venue": "Own Park 2"})
        self.assertEqual(saved["event"]["venue"], "Own Park 2")

        td = auth(BASE, "td@local.test", "EventTd1!")
        rain = request(BASE, "POST", "/api/events/keystone-clash-2026/rain", td, {
            "rain_status": "moved",
            "rain_note": "Sunday bracket moved to No Offseason, 306 Chase Drive, Tarentum, PA 15084 after Saturday rain.",
        })
        self.assertEqual(rain["event"]["rain_status"], "moved")
        owner = auth(BASE, "owner@local.test", "RegionAdmin1!")
        inbox = request(BASE, "GET", "/api/events/keystone-clash-2026/boxes", owner)
        self.assertIn("boxes", inbox)

    def test_find_harbor_eight_and_not_central_saturday(self):
        found = request(BASE, "GET", "/api/events/search?q=harbor")
        slugs = [e["slug"] for e in found["events"]]
        self.assertIn("harbor-eight", slugs)
        gone = request(BASE, "GET", "/api/events/search?q=central-saturday")
        self.assertNotIn("central-saturday", [e["slug"] for e in gone["events"]])

    def test_year_2026_includes_keystone_clubs(self):
        board = request(BASE, "GET", "/api/year/2026/board")
        self.assertEqual(board["year"], "2026")
        names = [t["name"] for t in board["teams"]]
        self.assertIn("Pittsburgh Passion", names)
        slugs = [e["slug"] for e in board["events"]]
        self.assertIn("keystone-clash-2026", slugs)
        self.assertIn("harbor-eight", slugs)
        self.assertNotIn("central-saturday", slugs)
        self.assertTrue(board["hitting"])
        hit_names = [r["name_key"] for r in board["hitting"]]
        self.assertIn("Lily M #15", hit_names)

    def test_harbor_eight_coach_logins(self):
        coaches = [
            ("coach.oaks@local.test", "CoachOaks1!", "Harbor Oaks"),
            ("coach.river@local.test", "CoachRiver1!", "River City"),
            ("coach.maple@local.test", "CoachMaple1!", "Maple Ridge"),
            ("coach.lake@local.test", "CoachLake1!", "Lakeview"),
            ("coach.iron@local.test", "CoachIron1!", "Iron Bridge"),
            ("coach.pine@local.test", "CoachPine1!", "Pine Hollow"),
            ("coach.cedar@local.test", "CoachCedar1!", "Cedar Falls"),
            ("coach.west@local.test", "CoachWest1!", "Westfield"),
        ]
        for email, password, club in coaches:
            token = auth(BASE, email, password)
            home = request(BASE, "GET", "/api/account/home", token)
            self.assertEqual(home["user"]["role"], "team_coach")
            joined = home.get("joined") or []
            slugs = [e["slug"] for e in joined]
            self.assertIn("harbor-eight", slugs, f"{email} is not attached to Harbor Eight")
            self.assertTrue(any(club in (e.get("team_name") or "") for e in joined), club)

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
        self.assertIn("11U", board["event"]["ages"])
        self.assertIn("12U", board["event"]["ages"])
        self.assertFalse(board["event"]["age_split"])
        self.assertEqual(board["event"]["age_class"], "C")
        self.assertIn("11U", board["event"]["age_groups"]["ages"])
        self.assertIn("12U", board["event"]["age_groups"]["ages"])
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

    def test_auto_schedule_saves_scheduler_settings(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "scheduler-prefs-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Scheduler Prefs",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "start": "2026-10-03",
            "end": "2026-10-04",
            "format": "pool-to-bracket",
            "hours_start": "08:00",
            "hours_end": "18:00",
            "fields": [{"name": "Harbor 1"}, {"name": "Harbor 2"}],
        })
        for name, pool in (("Prefs Hawks", "A"), ("Prefs Heat", "A"), ("Prefs Cats", "B"), ("Prefs Fox", "B")):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": pool,
                "as_director": True,
            })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": "2026-10-03\n2026-10-04",
            "games_per_team": 1,
            "start_time": "09:15",
            "end_time": "16:30",
            "consolation": False,
            "replace": False,
            "draw_bracket": True,
            "format": "pool-to-bracket",
        })
        self.assertGreaterEqual(auto["games"], 2)
        self.assertEqual(auto["scheduler"]["games_per_team"], 1)
        self.assertFalse(auto["scheduler"]["consolation"])
        self.assertFalse(auto["scheduler"]["replace"])
        self.assertTrue(auto["scheduler"]["draw_bracket"])
        self.assertEqual(auto["scheduler"]["days"], ["2026-10-03", "2026-10-04"])

        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        ev = plan["event"]
        self.assertEqual(ev["hours_start"], "09:15")
        self.assertEqual(ev["hours_end"], "16:30")
        self.assertEqual(ev["scheduler"]["games_per_team"], 1)
        self.assertFalse(ev["scheduler"]["consolation"])
        self.assertFalse(ev["scheduler"]["replace"])
        self.assertTrue(ev["scheduler"]["draw_bracket"])
        self.assertEqual(ev["scheduler"]["days"], ["2026-10-03", "2026-10-04"])
        # Unchecked consolation must stick on a later draw, not snap back to default.
        request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "consolation": ev["scheduler"]["consolation"],
            "replace": True,
            "format": "pool-to-bracket",
        })
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        sides = {g["side"] for g in board["bracket"]}
        self.assertNotIn("consolation", sides)

    def test_keystone_fields_and_rain_note(self):
        board = request(BASE, "GET", "/api/event/keystone-clash-2026/board")
        self.assertEqual(board["event"]["address"], "51 Meadow St, McDonald, PA 15057")
        self.assertEqual(board["event"]["rain_status"], "moved")
        self.assertIn("No Offseason", board["event"]["rain_note"])
        names = [f["name"] for f in board["fields"]]
        self.assertIn("East End 1", names)
        self.assertIn("No Offseason", names)


def read_or_denied(path, token=None):
    """GET a raw collection endpoint. Returns rows, or None when PocketBase denies."""
    try:
        return request(BASE, "GET", path, token).get("items", [])
    except RuntimeError as exc:
        if "403" in str(exc) or "401" in str(exc):
            return None
        raise


class PacketPrivacyTests(unittest.TestCase):
    """Outline §1: never publish family emails, addresses, or birthdates.

    A birth certificate carries all three, so a packet file link is the one
    thing that must never reach an anonymous caller or an unrelated account.
    """

    @classmethod
    def setUpClass(cls):
        cls.td = auth(BASE, "td@local.test", "EventTd1!")
        cls.slug = "privacy-" + uuid.uuid4().hex[:8]
        cls.family_email = f"parent.{uuid.uuid4().hex[:8]}@family.test"
        request(BASE, "POST", "/api/events/create", cls.td, {
            "source": "native",
            "name": "Privacy Classic",
            "slug": cls.slug,
            "venue": "Test Park",
            "ages": "10U",
            "require_birth_certs": True,
        })
        pdf = (ROOT / "testdata" / "packet" / "insurance.pdf").read_bytes()
        request_multipart(BASE, f"/api/events/{cls.slug}/signup", None, {
            "team_name": "Privacy 10U",
            "contact_name": "Coach Parent",
            "contact_email": cls.family_email,
        }, {"birth_certs": ("birth_certs.pdf", pdf, "application/pdf")})

    def packet_for(self, path, token=None):
        out = request(BASE, "GET", path, token)
        teams = out.get("teams") or []
        self.assertTrue(teams, f"{path} returned no teams")
        return teams[0]["packet"]

    def test_anonymous_roster_hides_packet_file_links(self):
        packet = self.packet_for(f"/api/events/{self.slug}/roster")
        kinds = {d["kind"] for d in packet["docs"]}
        self.assertEqual(kinds, {"birth_certs"}, "public caller should still see packet progress")
        for doc in packet["docs"]:
            self.assertNotIn("url", doc, "anonymous caller must not get a birth-certificate link")
            self.assertNotIn("original_name", doc)

    def test_anonymous_plan_and_board_hide_packet_file_links(self):
        for path in (f"/api/events/{self.slug}/plan", f"/api/event/{self.slug}/board"):
            out = request(BASE, "GET", path)
            teams = out.get("teams") or out.get("roster") or []
            for team in teams:
                for doc in (team.get("packet") or {}).get("docs", []):
                    self.assertNotIn("url", doc, f"{path} leaked a packet file link")

    def test_director_still_sees_packet_file_links(self):
        packet = self.packet_for(f"/api/events/{self.slug}/plan", self.td)
        self.assertTrue(packet["docs"], "director desk needs the packet rows")
        for doc in packet["docs"]:
            self.assertTrue(doc.get("url"), "the owning director must keep the file link")

    def test_packet_documents_are_not_listable(self):
        """An empty `uploaded_by` must not match an empty `@request.auth.id`.

        A team that signs itself up has no account, so a rule of plain
        `uploaded_by = @request.auth.id` compares "" = "" and matches. Both the
        anonymous and the self-registered caller have to come back empty.
        """
        path = "/api/collections/team_docs/records?perPage=200&filter=(kind='birth_certs')"
        self.assertFalse(read_or_denied(path), "anonymous REST listed birth certificates")
        self.assertFalse(read_or_denied(path, self.stranger()),
                         "a self-registered account listed other events' birth certificates")

    def test_contact_emails_are_not_readable(self):
        for token in (None, self.stranger()):
            for path in ("/api/collections/event_teams/records?perPage=500",
                         "/api/collections/club_teams/records?perPage=500"):
                for row in (read_or_denied(path, token) or []):
                    self.assertFalse(row.get("contact_email"), f"{path} leaked a contact email")

    def test_packet_file_needs_a_token(self):
        packet = self.packet_for(f"/api/events/{self.slug}/plan", self.td)
        url = packet["docs"][0]["url"]
        with self.assertRaises(RuntimeError) as denied:
            request(BASE, "GET", url)
        self.assertRegex(str(denied.exception), r"40[0-9]")

        token = request(BASE, "POST", "/api/files/token", self.td, {})["token"]
        opened = urllib.request.urlopen(f"{BASE}{url}?token={token}", timeout=20)
        self.assertEqual(opened.status, 200)
        self.assertTrue(opened.read(), "the director's tokenized link must still download")

    @staticmethod
    def stranger():
        email = f"stranger.{uuid.uuid4().hex[:8]}@nowhere.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "Stranger99!",
            "display_name": "Random Stranger",
            "intent": "director",
        })
        return auth(BASE, email, "Stranger99!")


def _jpeg_with_exif() -> bytes:
    tiny = (
        b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
        b"\xff\xdb\x00C\x00" + bytes([16] * 64)
        + b"\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00"
        + b"\xff\xc4\x00\x14\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
        + b"\xff\xda\x00\x08\x01\x01\x00\x00?\x00\x7f\xff\xd9"
    )
    payload = b"Exif\x00\x00GPS\x00" + b"\x00" * 8
    app1 = b"\xff\xe1" + (len(payload) + 2).to_bytes(2, "big") + payload
    return tiny[:2] + app1 + tiny[2:]


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def _png_with_exif() -> bytes:
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = zlib.compress(b"\x00\xff\x00\x00")
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"eXIf", b"GPS-EXIF")
        + _png_chunk(b"IDAT", raw)
        + _png_chunk(b"IEND", b"")
    )


class ExifTests(unittest.TestCase):
    def test_strips_jpeg_app1(self):
        raw = _jpeg_with_exif()
        self.assertIn(b"Exif", raw)
        self.assertIn(b"GPS", raw)
        out = strip_exif(raw)
        self.assertTrue(out.startswith(b"\xff\xd8"))
        self.assertNotIn(b"Exif", out)
        self.assertNotIn(b"GPS", out)

    def test_strips_png_exif_chunk(self):
        raw = _png_with_exif()
        self.assertIn(b"eXIf", raw)
        out = strip_exif(raw)
        self.assertTrue(out.startswith(b"\x89PNG"))
        self.assertNotIn(b"eXIf", out)
        self.assertNotIn(b"GPS-EXIF", out)


class LiveReviewTests(unittest.TestCase):
    def test_new_event_defaults_pitching_none_and_keeps_pin(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "live-review-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Live Review Classic",
            "slug": slug,
            "venue": "East End Park",
            "address": "51 Meadow St, McDonald, PA 15057",
            "pin_set": True,
            "lat": 40.3668,
            "lng": -80.2345,
            "age_groups": ["11U", "12U"],
            "age_class": "C",
            "age_split": False,
            "tiebreak_order": "record,ra",
            "tiebreak_explicit": True,
        })
        ev = created["event"]
        self.assertEqual(ev["pitch_limit_mode"], "none")
        self.assertEqual(ev["lat"], 40.3668)
        self.assertEqual(ev["lng"], -80.2345)
        self.assertEqual(ev["tiebreak"]["order"], ["record", "ra"])
        self.assertIn("11U", ev["ages"])
        self.assertIn("12U", ev["ages"])
        self.assertEqual(ev["age_class"], "C")
        self.assertFalse(ev["age_split"])

    def test_pool_tiebreak_and_mail_best_effort(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "pool-tb-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Pool Tiebreak Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "format": "pool-only",
            "tiebreak_order": "record,h2h,ra,diff,rs",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Pool Hawks",
            "pool": "A",
            "contact_email": f"coach.{uuid.uuid4().hex[:6]}@local.test",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Pool Heat",
            "pool": "B",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "tiebreak_order": "record,h2h,ra,diff,rs",
            "tiebreak_explicit": True,
            "pool_tiebreak_A": "record,ra",
        })
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        by_name = {row["name"]: row for row in board["standings"]}
        self.assertIn("fewest runs allowed", by_name["A"]["tiebreak_label"])
        self.assertNotIn("head-to-head", by_name["A"]["tiebreak_label"])
        self.assertIn("head-to-head", by_name["B"]["tiebreak_label"])
        rain = request(BASE, "POST", f"/api/events/{slug}/rain", td, {
            "rain_status": "watch",
            "rain_note": "Lightning in the area.",
        })
        self.assertEqual(rain.get("mail_sent"), 0)

    def test_venue_photo_stays_unpublished_and_strips_exif(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "photos-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Photo Classic",
            "slug": slug,
            "venue": "East End Park",
            "ages": "10U",
        })
        raw = _png_with_exif()
        uploaded = request_multipart(BASE, f"/api/events/{slug}/photos", td, {
            "caption": "East lot",
            "kind": "parking",
        }, {
            "image": ("lot.png", raw, "image/png"),
        })
        photo = uploaded["photo"]
        self.assertFalse(photo["public"])
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertFalse(board.get("header_photo"))
        self.assertTrue(all(not p.get("url") or p.get("public") for p in board.get("photos") or []))
        published = request(BASE, "POST", f"/api/events/{slug}/photos/{photo['id']}/publish", td, {"public": True})
        self.assertTrue(published["photo"]["public"])
        self.assertTrue(published["photo"]["url"])
        board2 = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertTrue(board2.get("header_photo"))
        file_url = BASE + published["photo"]["url"]
        with urllib.request.urlopen(file_url, timeout=20) as resp:
            stored = resp.read()
        self.assertNotIn(b"eXIf", stored)
        self.assertNotIn(b"GPS-EXIF", stored)

    def test_register_stays_verified_without_smtp(self):
        email = f"mailcheck.{uuid.uuid4().hex[:8]}@local.test"
        out = request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "DirectorPass1!",
            "display_name": "Mail Check",
            "intent": "director",
        })
        self.assertTrue(out.get("verified"))
        self.assertFalse(out.get("verify_sent"))


class GcMonitorTests(unittest.TestCase):
    def test_public_gc_url_hosts_only(self):
        self.assertTrue(is_public_gc_url("https://web.gc.com/teams/abc/schedule/xyz/box-score"))
        self.assertTrue(is_public_gc_url("https://gc.com/team/hawks-10u"))
        self.assertTrue(is_public_gc_url("https://www.gamechanger.io/team/x"))
        self.assertFalse(is_public_gc_url("https://example.com/not-gc"))
        self.assertFalse(is_public_gc_url(""))

    def test_bot_lists_stored_public_urls_and_coach_cannot(self):
        bot = auth(BASE, "bot@local.test", "BotStaging1!")
        watch = load_watch(BASE, bot)
        policy = watch["policy"]
        self.assertTrue(policy["allowed"])
        self.assertTrue(policy["public_urls_only"])
        self.assertFalse(policy["gc_login"])
        self.assertFalse(policy["unofficial_api"])
        self.assertTrue(policy["pdf_ocr_still_supported"])
        self.assertIn("/api/bot/ingest", policy["season_write"])
        self.assertIn("Approve", policy["season_write"])
        self.assertIn("/api/bot/event-box", policy["event_write"])
        self.assertTrue(any("Invent" in item or "invent" in item for item in policy["forbidden"]))
        slugs = [e.get("slug") for e in watch["live_events"]]
        self.assertIn("keystone-clash-2026", slugs)
        self.assertIn("harbor-eight", slugs)
        self.assertNotIn("central-saturday", slugs)
        self.assertEqual(policy["interval_seconds"], 300)
        hawks = next(
            item for item in watch["watch"]
            if item.get("gc_url") == "https://web.gc.com/team/hawks-10u"
        )
        # Central Saturday is wiped; the leftover year-club URL stays for season ingest.
        self.assertEqual(hawks["kind"], "club")
        self.assertEqual(hawks["write"], "POST /api/bot/ingest")

        coach = auth(BASE, "coach.demo@local.test", "CoachDemo1!")
        with self.assertRaises(RuntimeError) as forbidden:
            request(BASE, "GET", "/api/bot/gc-monitor", coach)
        self.assertIn("403", str(forbidden.exception))

        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "gc-monitor-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "GC Monitor Weekend",
            "slug": slug,
            "format": "pool-only",
            "fields": [{"name": "Main"}],
        })
        slug = created["event"]["slug"]
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Monitor Hawks",
            "pool": "A",
            "gamechanger_url": "https://web.gc.com/team/monitor-hawks",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Monitor Heat",
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
        gc_box = "https://web.gc.com/teams/MonitorHawks/schedule/game-1/box-score"
        linked = request(BASE, "POST", f"/api/events/{slug}/schedule/{game_id}/box", td, {
            "source": "gc_url",
            "gc_url": gc_box,
        })
        self.assertEqual(linked["box"]["gc_url"], gc_box)
        self.assertEqual(linked["box"]["status"], "queued")

        again = request(BASE, "GET", "/api/bot/gc-monitor", bot)
        team_row = next(
            item for item in again["watch"]
            if item.get("gc_url") == "https://web.gc.com/team/monitor-hawks"
            and item.get("event_slug") == slug
        )
        self.assertEqual(team_row["kind"], "event_team")
        box_row = next(
            item for item in again["watch"]
            if item.get("gc_url") == gc_box and item.get("event_slug") == slug
        )
        self.assertEqual(box_row["kind"], "event_box")
        self.assertEqual(box_row["schedule_id"], game_id)
        self.assertEqual(box_row["write"], "POST /api/bot/event-box")
        inbox = request(BASE, "GET", f"/api/bot/event-boxes?event={slug}", bot)
        self.assertTrue(any(b.get("gc_url") == gc_box for b in inbox["boxes"]))


if __name__ == "__main__":
    unittest.main()
