#!/usr/bin/env python3
from __future__ import annotations

import json
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


class MobileDisplayTests(unittest.TestCase):
    def test_display_formatters(self):
        import subprocess
        out = subprocess.check_output(
            ["node", str(ROOT / "scripts/test_display.mjs")],
            text=True,
        )
        self.assertIn("display.js ok", out)

    def test_phone_chrome_markers(self):
        event = (ROOT / "pb/pb_public/js/event.js").read_text()
        css = (ROOT / "pb/pb_public/css/app.css").read_text()
        self.assertIn("id=\"admin-desk-select\"", event)
        self.assertIn("function gameCard", event)
        self.assertIn("function boxMark", event)
        self.assertIn("No box", event)
        self.assertIn("function scheduleCards", event)
        self.assertIn('className: "desktop-table"', event)
        self.assertIn('groupBy: "date"', event)
        self.assertIn("homePhaseBlock", event)
        self.assertIn("teamChips", event)
        self.assertIn('data-phase="', event)
        self.assertIn(".desktop-table", css)
        self.assertIn(".table-wrap.desktop-table", css)
        self.assertIn(".phone-schedule", css)
        self.assertIn(".card-table td::before", css)
        self.assertIn(".game-list", css)
        self.assertIn(".box-mark", css)
        self.assertIn(".admin-rail nav.admin-rail-nav", css)
        self.assertIn(".tourney-tabbar", css)
        self.assertIn(".phone-stat-list", css)
        self.assertIn(".flight-plan [data-add-flight]", css)
        self.assertIn(".flight-card input", css)
        self.assertIn(".flight-card-title", css)
        self.assertIn(".flight-more > summary", css)
        self.assertIn(".box-review-card", css)
        self.assertIn("table.desktop-table", css)
        self.assertGreater(css.find(".table-wrap.desktop-table"), css.find(".card-table tbody { display: block"))
        chrome = (ROOT / "pb/pb_public/js/chrome.js").read_text()
        self.assertIn("tourney-tabbar", chrome)
        self.assertIn("tourney-more-sheet", chrome)
        self.assertIn("event-nav-desk", chrome)
        self.assertIn("export function bindEventChrome", chrome)
        self.assertIn("export function eventDestinations", chrome)
        self.assertIn("No converted hitting lines yet", event)
        self.assertIn("function boxReviewCard", event)
        self.assertIn("function deskTable", event)
        self.assertIn("phone-stat-list", event)


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
        self.assertNotIn("Nudge the map pin", event)
        self.assertNotIn("Nudge this diamond", event)
        self.assertNotIn('name="field_lat_', event)
        self.assertNotIn('name="lat"', event)
        self.assertIn("Import schedule", event)
        self.assertIn("Clear bracket", event)
        self.assertIn("Save weekend settings", event)
        self.assertIn("Check back closer to the weekend", event)
        self.assertIn("No pool results yet", event)
        self.assertIn("function formatWeekendDates", event)
        self.assertIn("from \"./display.js\"", event)
        self.assertIn("formatTimeDisplay", event)
        self.assertIn("formatDateDisplay", event)
        self.assertIn("admin-desk-select", event)
        self.assertIn("class=\"game-card", event)
        self.assertIn("Park hours", event)
        self.assertNotIn("Global hours", event)
        self.assertIn("overflow-x: clip", css)
        self.assertIn(".admin-desk-pick", css)
        self.assertIn("export function measureChrome", chrome)
        self.assertIn("measureChrome", app)
        self.assertIn("function tabEmpty", event)
        self.assertIn("function compareGames", event)
        self.assertIn("Import a bracket CSV", event)
        self.assertIn("/import-bracket", event)
        self.assertIn("Publish blank bracket", event)
        self.assertIn("publish-blank-bracket", event)
        self.assertIn("function bracketPageActions", event)
        self.assertIn("function isDirector(ev)", event)
        self.assertIn("function rememberEvent", event)
        self.assertNotIn("September 11–13, 2026", event)
        self.assertNotIn("a.date + a.time + a.field + a.home", event)
        self.assertIn("tb-remove", event)
        self.assertIn("Head to head first", event)
        self.assertIn("Fields and facilities only", event)
        self.assertIn("/verify", app)
        self.assertIn("verifyPage", app)
        self.assertIn("Forgot my password", (ROOT / "pb/pb_public/js/flow.js").read_text())
        self.assertIn("/forgot", app)
        self.assertIn("adminEvents", app)
        self.assertIn("loginWithPassword", chrome)
        self.assertIn("_superusers", chrome)
        self.assertIn("canAdminEvent", chrome)
        self.assertIn("This is not your tournament", event)
        self.assertIn("Remove this tournament", event)
        self.assertIn("Co-owners", event)
        self.assertIn("Add co-owner", event)
        self.assertIn("/co-owners", event)
        self.assertIn("Public pages never show these addresses", event)
        self.assertIn("data-remove-field", event)
        self.assertIn("data-remove-team", event)
        self.assertIn("data-team-form", event)
        self.assertIn("Custom bracket builder", event)
        self.assertIn("pool-double-elim", event)
        self.assertIn("round-robin", event)
        self.assertIn("One bracket by default", event)
        self.assertIn("Add another bracket", event)
        self.assertIn("data-add-flight", event)
        self.assertIn("data-remove-flight", event)
        self.assertIn("function flightPlanDesk", event)
        self.assertIn("function readFlightPlan", event)
        self.assertIn("function defaultFlightRows", event)
        self.assertIn("function flightMoreOpen", event)
        self.assertIn("flight-more", event)
        self.assertIn("flight-card-title", event)
        self.assertNotIn("<legend class=\"flight-card-head\">", event)
        self.assertIn("More settings for this bracket", event)
        self.assertIn("bracket_plan", event)
        self.assertIn("flight_pool_from", event)
        self.assertIn("flight_seed_mode", event)
        self.assertIn("flight_bye_mode", event)
        self.assertIn("no automatic even split", event)
        self.assertNotIn("split by overall ranking", event)
        self.assertIn("fields.length ? fields : [{}]", event)
        self.assertIn("Start with one diamond", event)
        self.assertIn("function teamSelect", event)
        self.assertIn("Select a registered team", event)
        self.assertIn('teamSelect(teams, "home_id"', event)
        self.assertIn('teamSelect(teams, "away_id"', event)
        self.assertIn('name="home_id"', event)
        self.assertIn('name="away_id"', event)
        self.assertIn("function flightSelect", event)
        self.assertIn("function roundSelect", event)
        self.assertIn("/directors/import?into=", event)
        self.assertIn("/schedule/import", event)
        self.assertIn("does not create a new weekend", event)
        self.assertIn("Name the weekend first", event)
        self.assertIn("a CSV alone does not create a tournament", event)
        self.assertIn('name="into"', event)
        self.assertIn('name="create"', event)
        self.assertIn("Import onto this tournament", event)
        self.assertNotIn('value="clipboard-open"', event)
        self.assertNotIn('value="Clipboard Open"', event)
        self.assertNotIn('value="Hawks Classic"', event)
        self.assertIn("function rewriteFieldInputName", event)
        self.assertIn("function renumberFieldRows", event)
        self.assertIn("does not change imported pool games", event)
        self.assertIn("does not rewrite an imported pool grid", event)
        self.assertIn("delete body.replace", event)
        add_game = event.split('id="add-game-form"', 1)[1].split("customBracketDesk", 1)[0]
        self.assertNotIn('<input name="home"', add_game)
        self.assertNotIn('<input name="away"', add_game)
        self.assertNotIn('<input name="pool"', add_game)
        self.assertIn("poolSelect", add_game)
        custom = event.split("function customBracketDesk", 1)[1].split("function bindCustomBracket", 1)[0]
        self.assertIn("flightSelect", custom)
        self.assertIn("roundSelect", custom)
        self.assertIn("seatSelect", custom)
        self.assertIn("seed:", custom)
        self.assertIn("winner:", custom)
        self.assertIn("loser:", custom)
        self.assertNotIn('placeholder="gold"', custom)
        self.assertNotIn("<input name=\"flight\"", custom)
        self.assertNotIn("<input name=\"round\"", custom)
        hooks = (ROOT / "pb/pb_hooks/schedule.js").read_text()
        add_fn = hooks.split("function addGame", 1)[1].split("function updateGame", 1)[0]
        self.assertIn("requireRegisteredTeam", add_fn)
        self.assertNotIn("upsertEventTeam", add_fn)
        self.assertIn(".btn.danger", (ROOT / "pb/pb_public/css/app.css").read_text())
        self.assertIn("function teamLink", event)
        self.assertIn("eventTeamPage", event)
        self.assertIn("boxUploadPage", event)
        self.assertIn("boxHelpPage", event)
        self.assertIn("/help/box-score", event)
        self.assertIn("This page does not guess", event)
        self.assertIn("data-assist", event)
        self.assertIn("/boxes/desk", event)
        self.assertIn("next-game", event)
        self.assertIn("eteam", app)
        self.assertIn("eventTeamPage", app)
        self.assertIn("boxupload", app)
        self.assertIn("boxHelpPage", app)
        self.assertIn("box-score-ask", (ROOT / "pb/pb_hooks/main.pb.js").read_text())
        self.assertIn("box_submissions", (ROOT / "pb/pb_migrations/1700000029_box_submissions.js").read_text())
        self.assertIn("function hasPitchIpCap", event)
        self.assertIn("No posted weekend inning cap", event)
        self.assertIn("function dynamicLeaderMins", (ROOT / "pb/pb_hooks/diamond.js").read_text())
        self.assertIn("WEEKEND_MIN_AB", (ROOT / "pb/pb_hooks/diamond.js").read_text())
        self.assertNotIn("r.ip_outs > board.event.pitch_limit_ip * 3", event)
        self.assertNotIn("Qualifying minimums are 8 at-bats and 5 innings", event)
        inbox = event.split('data-admin-pane="stats"', 1)[1].split('data-admin-pane="boxes"', 1)[0]
        self.assertIn("<h2>Approve stats</h2>", inbox)
        self.assertIn("boxReviewList(pending", inbox)
        self.assertIn("data-box-review", event)
        self.assertIn(">Approve stats<", event)
        self.assertIn(">Reject<", event)
        self.assertIn("function directorApproveBanner", event)
        self.assertIn("function approveStatsButtons", event)
        self.assertIn("function bindBoxReview", event)
        self.assertIn('["stats", "Approve stats"', event)
        self.assertIn("Approve stats (${pending.length} waiting)", event)
        self.assertIn("detail.director && boxWaiting(box)", event)
        self.assertIn("/boxes/", event)
        self.assertIn("Box approved", event)
        self.assertIn("function reviewBox", (ROOT / "pb/pb_hooks/score.js").read_text())
        self.assertIn("/boxes/{id}/review", (ROOT / "pb/pb_hooks/main.pb.js").read_text())
        self.assertIn("/api/coach/staging/${id}/decision", app)
        # Chrome rejects an extra backtick between these two paragraphs ("Missing } in template expression").
        self.assertNotRegex(
            event,
            r"</p>`\n\s*<p class=\"muted\">\$\{eventPb\.authStore",
        )
        self.assertIn(
            "</form>` : `<p>${scoreCell(g)} · ${escapeHtml(g.status)}</p>\n"
            "        <p class=\"muted\">${eventPb.authStore.record",
            event,
        )

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

    def test_field_rows_renumber_from_dom(self):
        src = (ROOT / "pb/pb_public/js/event.js").read_text()
        bind = src.split("function bindFieldRows", 1)[1].split("function setupFormatFields", 1)[0]
        self.assertIn("renumberFieldRows(root)", bind)
        self.assertIn("querySelectorAll(\".field-row\").length", bind)
        self.assertNotIn("n += 1", bind)
        self.assertNotIn("Math.max(n,", bind)
        rewrite = src.split("function rewriteFieldInputName", 1)[1].split("function renumberFieldRows", 1)[0]
        self.assertIn("field_day_", rewrite)
        js = (
            "function rewriteFieldInputName" + rewrite
            + "const eq=(a,b)=>{if(a!==b) throw new Error(a+' != '+b)};"
            + "eq(rewriteFieldInputName('field_name_3',0),'field_name_0');"
            + "eq(rewriteFieldInputName('field_id_3',1),'field_id_1');"
            + "eq(rewriteFieldInputName('field_pin_set_12',1),'field_pin_set_1');"
            + "eq(rewriteFieldInputName('field_day_3_2_start',0),'field_day_0_2_start');"
            + "eq(rewriteFieldInputName('field_day_3_2_on',1),'field_day_1_2_on');"
            + "eq(rewriteFieldInputName('venue',0),'venue');"
        )
        import subprocess
        subprocess.check_call(["node", "-e", js])


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
        slug = "door-three-" + uuid.uuid4().hex[:8]
        out = request(BASE, "POST", "/api/event/import-schedule", admin, {
            "event_slug": slug,
            "event_name": "Door Three Grid",
            "csv": csv,
            "replace": True,
            "create": True,
        })
        self.assertTrue(out["created"])
        self.assertEqual(out["event"], slug)
        self.assertGreaterEqual(out["imported"], 3)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
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
        admin = auth(BASE, "admin@local.test", "SoftballAdmin1!", "_superusers")
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
        denied("POST", "/api/events/keystone-clash-2026/co-owners", {"email": email})

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
        harbor = request(BASE, "GET", "/api/event/harbor-eight/board")
        game_id = next(g["id"] for g in harbor["schedule"] if g.get("id"))
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

    def test_owner_adds_co_owner_by_email(self):
        owner_email = f"own.{uuid.uuid4().hex[:8]}@local.test"
        helper_email = f"help.{uuid.uuid4().hex[:8]}@local.test"
        extra_email = f"extra.{uuid.uuid4().hex[:8]}@local.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": owner_email,
            "password": "OwnerPass1!",
            "display_name": "Event Owner",
            "intent": "director",
        })
        request(BASE, "POST", "/api/account/register", None, {
            "email": helper_email,
            "password": "HelperPass1!",
            "display_name": "Helper Director",
            "intent": "director",
        })
        request(BASE, "POST", "/api/account/register", None, {
            "email": extra_email,
            "password": "ExtraPass1!",
            "display_name": "Extra Director",
            "intent": "director",
        })
        owner = auth(BASE, owner_email, "OwnerPass1!")
        helper = auth(BASE, helper_email, "HelperPass1!")
        extra = auth(BASE, extra_email, "ExtraPass1!")
        slug = "co-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", owner, {
            "source": "native",
            "name": "Co Owner Weekend",
            "slug": slug,
            "venue": "Co Park",
            "ages": "10U",
        })
        self.assertTrue(created["event"]["can_admin"])
        self.assertNotIn("co_owners", created["event"])

        added = request(BASE, "POST", f"/api/events/{slug}/co-owners", owner, {
            "email": helper_email.upper(),
        })
        emails = [row["email"] for row in added["event"]["co_owners"]]
        self.assertEqual(emails, [helper_email])
        self.assertTrue(added["event"]["can_manage_owners"])
        self.assertTrue(added["co_owner"]["has_account"])

        plan = request(BASE, "GET", f"/api/events/{slug}/plan", owner)
        self.assertEqual([row["email"] for row in plan["event"]["co_owners"]], [helper_email])
        self.assertTrue(plan["event"]["can_admin"])

        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertNotIn("co_owners", board["event"])
        self.assertNotIn("can_manage_owners", board["event"])
        self.assertNotIn(helper_email, str(board))
        found = request(BASE, "GET", f"/api/events/search?q={slug}")
        self.assertTrue(found.get("events"), f"public search missed {slug}: {found}")
        self.assertNotIn("co_owners", found["events"][0])
        self.assertNotIn(helper_email, str(found))

        rest = read_or_denied("/api/collections/event_co_owners/records?perPage=200")
        self.assertFalse(rest, "anonymous REST listed co-owner emails")
        rest_stranger = read_or_denied(
            "/api/collections/event_co_owners/records?perPage=200", extra,
        )
        self.assertFalse(rest_stranger, "a stranger listed co-owner emails")

        helper_home = request(BASE, "GET", "/api/account/home", helper)
        self.assertIn(slug, [e["slug"] for e in helper_home["created"]])
        helper_plan = request(BASE, "GET", f"/api/events/{slug}/plan", helper)
        self.assertTrue(helper_plan["event"]["can_admin"])
        self.assertFalse(helper_plan["event"]["can_manage_owners"])
        saved = request(BASE, "POST", f"/api/events/{slug}/settings", helper, {
            "venue": "Co Park Shared",
        })
        self.assertEqual(saved["event"]["venue"], "Co Park Shared")
        self.assertTrue(saved["event"]["can_admin"])

        with self.assertRaises(RuntimeError) as caught:
            request(BASE, "POST", f"/api/events/{slug}/co-owners", helper, {
                "email": extra_email,
            })
        self.assertIn("403", str(caught.exception))

        with self.assertRaises(RuntimeError):
            request(BASE, "POST", f"/api/events/{slug}/co-owners", extra, {
                "email": extra_email,
            })

        owner_board = request(BASE, "GET", f"/api/event/{slug}/board", owner)
        self.assertTrue(owner_board["event"]["can_admin"])
        self.assertNotIn("co_owners", owner_board["event"])

        pending_email = f"later.{uuid.uuid4().hex[:8]}@local.test"
        pending = request(BASE, "POST", f"/api/events/{slug}/co-owners", owner, {
            "email": pending_email,
        })
        pending_row = next(row for row in pending["event"]["co_owners"] if row["email"] == pending_email)
        self.assertFalse(pending_row["has_account"])
        request(BASE, "POST", "/api/account/register", None, {
            "email": pending_email,
            "password": "LaterPass1!",
            "display_name": "Later Director",
            "intent": "director",
        })
        later = auth(BASE, pending_email, "LaterPass1!")
        later_home = request(BASE, "GET", "/api/account/home", later)
        self.assertIn(slug, [e["slug"] for e in later_home["created"]])
        later_saved = request(BASE, "POST", f"/api/events/{slug}/settings", later, {
            "venue": "Co Park Later",
        })
        self.assertEqual(later_saved["event"]["venue"], "Co Park Later")

        removed = request(BASE, "POST", f"/api/events/{slug}/co-owners/remove", owner, {
            "email": helper_email,
        })
        self.assertEqual(removed["removed"], helper_email)
        leftover = [row["email"] for row in removed["event"]["co_owners"]]
        self.assertNotIn(helper_email, leftover)
        self.assertEqual(leftover, [pending_email])
        with self.assertRaises(RuntimeError):
            request(BASE, "POST", f"/api/events/{slug}/settings", helper, {"venue": "Should Fail"})
        still = request(BASE, "POST", f"/api/events/{slug}/settings", later, {
            "venue": "Co Park Still",
        })
        self.assertEqual(still["event"]["venue"], "Co Park Still")

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
            "lat": 1.2345,
            "lng": 9.8765,
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
        self.assertNotAlmostEqual(float(created["event"].get("lat") or 0), 1.2345, places=3)
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
            "empty": True,
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
        self.assertEqual(scored["box_status"], "submitted")
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
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-19"],
            "start_time": "08:00",
            "games_per_team": 1,
            "replace": True,
            "format": "pool-to-bracket",
        })
        for game in auto["schedule"]:
            request(BASE, "POST", f"/api/events/{slug}/schedule/{game['id']}/score", td, {
                "home_runs": 4, "away_runs": 1, "status": "final", "confirm": True,
            })
        built = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "consolation": True,
            "replace": True,
            "confirm": True,
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

        qf = next(g for g in board["bracket"] if g.get("home_id") and g.get("away_id"))
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
            "empty": True,
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
                    self.assertFalse(row.get("coach_email"), f"{path} leaked a coach email")
                    self.assertFalse(row.get("coach_phone"), f"{path} leaked a coach phone")
            leaked = read_or_denied("/api/collections/team_contacts/records?perPage=500", token)
            self.assertFalse(leaked, "team_contacts must not list to anonymous or a stranger")
            self.assertFalse(
                read_or_denied("/api/collections/import_maps/records?perPage=200", token),
                "import_maps must not list to anonymous or a stranger",
            )

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
        self.assertNotEqual((ev.get("lat"), ev.get("lng")), (40.3668, -80.2345))
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


class IssuesBacklogTests(unittest.TestCase):
    """Remaining GitHub issues + Derek BACKLOG items that were still open."""

    def test_season_age_includes_6u_8u_and_contacts_stay_private(self):
        owner = auth(BASE, "owner@local.test", "RegionAdmin1!")
        slug = "minis-8u-" + uuid.uuid4().hex[:6]
        created = request(BASE, "POST", "/api/collections/teams/records", owner, {
            "name": "Minis 8U (FAKE)",
            "slug": slug,
            "age_group": "8U",
            "coach_name": "Coach Mini",
        })
        self.assertEqual(created.get("age_group"), "8U")
        public = request(BASE, "GET", f"/api/collections/teams/records?filter=(slug='{slug}')")
        self.assertEqual(public["items"][0]["age_group"], "8U")
        self.assertNotIn("coach_email", public["items"][0])
        self.assertNotIn("coach_phone", public["items"][0])
        saved = request(BASE, "POST", f"/api/admin/season-teams/{slug}/contact", owner, {
            "coach_email": "mini.coach@local.test",
            "coach_phone": "0412-555-0108",
            "alt_name": "Team manager",
            "alt_email": "mini.manager@local.test",
            "alt_phone": "412-555-0199",
            "role": "head_coach",
            "age_group": "6U",
        })
        self.assertEqual(saved["contact"]["coach_phone"], "0412-555-0108")
        self.assertEqual(saved["age_group"], "6U")
        self.assertFalse(read_or_denied("/api/collections/team_contacts/records?perPage=200"))
        with self.assertRaises(RuntimeError):
            request(BASE, "GET", f"/api/admin/season-teams/{slug}/contact")
        coach_view = request(BASE, "GET", f"/api/admin/season-teams/{slug}/contact", owner)
        self.assertEqual(coach_view["contact"]["coach_email"], "mini.coach@local.test")

    def test_signup_stores_phone_and_logs_missing_smtp(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "contacts-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Contact Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        email = f"dugout.{uuid.uuid4().hex[:6]}@local.test"
        out = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Dugout Heat",
            "contact_name": "Pat Coach",
            "contact_email": email,
            "coach_phone": "0412-555-0110",
            "alt_name": "Billing parent",
            "alt_email": f"bills.{uuid.uuid4().hex[:6]}@local.test",
            "as_director": True,
        })
        team = out["team"]
        self.assertEqual(team["contact"]["coach_phone"], "0412-555-0110")
        self.assertFalse(team["mail"]["sent"])
        self.assertEqual(team["mail"]["reason"], "smtp_not_configured")
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        public_names = [row.get("name") for row in board.get("roster") or board.get("teams") or []]
        blob = json.dumps(board)
        self.assertNotIn(email, blob)
        self.assertNotIn("0412-555-0110", blob)
        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        desk = next(t for t in plan["teams"] if t["name"] == "Dugout Heat")
        self.assertEqual(desk["contact"]["coach_email"], email)
        self.assertEqual(desk["contact"]["coach_phone"], "0412-555-0110")
        owner = auth(BASE, "owner@local.test", "RegionAdmin1!")
        logs = request(BASE, "GET", "/api/collections/sync_log/records?perPage=200", owner)
        kinds = [row.get("kind") for row in logs.get("items") or []]
        self.assertIn("signup_mail", kinds)
        mail_rows = [row for row in logs["items"] if row.get("kind") == "signup_mail"]
        self.assertTrue(any("smtp_not_configured" in (row.get("detail") or "") for row in mail_rows))
        self.assertTrue(any(row.get("ok") is False for row in mail_rows))

    def test_google_forms_csv_preview_and_reimport(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "csv-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "CSV Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        csv = (ROOT / "testdata" / "google_forms_teams.csv").read_text(encoding="utf-8-sig")
        preview = request(BASE, "POST", f"/api/events/{slug}/import-teams/preview", td, {"csv": csv})
        self.assertIn("Name of Team", preview["headers"])
        self.assertEqual(preview["mapping"].get("Name of Team"), "name")
        self.assertEqual(preview["mapping"].get("Email Address"), "coach_email")
        self.assertEqual(preview["mapping"].get("Phone Number"), "coach_phone")
        self.assertEqual(preview["mapping"].get("Timestamp"), "timestamp")
        names = {row["name"]: row for row in preview["rows"]}
        self.assertEqual(names["O'Brien's Bandits"]["status"], "new")
        self.assertEqual(names["Smash 12U, Gold"]["status"], "new")
        self.assertEqual(names["Smash 12U, Gold"]["coach_phone"], "(412) 555-0199")
        missing = next(row for row in preview["rows"] if "missing team name" in row["problems"])
        self.assertEqual(missing["status"], "problem")
        first = request(BASE, "POST", f"/api/events/{slug}/import-teams", td, {
            "csv": csv,
            "mapping": preview["mapping"],
            "on_match": "skip",
        })
        self.assertEqual(first["counts"]["new"], 3)
        self.assertEqual(first["counts"]["skipped"], 0)
        self.assertEqual(first["counts"]["problems"], 1)
        again = request(BASE, "POST", f"/api/events/{slug}/import-teams", td, {
            "csv": csv,
            "on_match": "skip",
        })
        self.assertEqual(again["counts"]["new"], 0)
        self.assertEqual(again["counts"]["skipped"], 3)
        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        by_name = {t["name"]: t for t in plan["teams"]}
        self.assertEqual(by_name["O'Brien's Bandits"]["contact"]["coach_phone"], "0412-555-0101")
        self.assertTrue(by_name["O'Brien's Bandits"]["registered_at"])
        self.assertTrue(by_name["O'Brien's Bandits"]["paid"])
        self.assertEqual(by_name["Harbor Heat"]["gamechanger_url"], "https://gc.com/team/harbor-heat")
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertNotIn("obrien@local.test", json.dumps(board))
        self.assertNotIn("0412-555-0101", json.dumps(board))


class AdminTeamsBracketsTests(unittest.TestCase):
    """Director team edit/remove, fields min 1, flights, custom bracket, RR, DE."""

    def test_create_defaults_one_field_and_can_add_remove(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "one-field-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "One Field Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        names = [f["name"] for f in created["event"]["fields"]]
        self.assertEqual(names, ["Field 1"])
        saved = request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "fields": [
                {"id": created["event"]["fields"][0]["id"], "name": "East 1"},
                {"name": "East 2"},
                {"name": "East 3"},
            ],
        })
        self.assertEqual(sorted(f["name"] for f in saved["event"]["fields"]), ["East 1", "East 2", "East 3"])
        down = request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "fields": [{"name": "East 1"}],
        })
        self.assertEqual([f["name"] for f in down["event"]["fields"]], ["East 1"])
        kept = request(BASE, "POST", f"/api/events/{slug}/settings", td, {"fields": []})
        self.assertEqual([f["name"] for f in kept["event"]["fields"]], ["East 1"])
        guide = request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "format": "round-robin",
            "bracket_flights": "gold-silver",
        })
        self.assertEqual(guide["event"]["format"], "round-robin")
        self.assertEqual(guide["event"]["bracket_flights"], "gold-silver")
        self.assertEqual([f["name"] for f in guide["event"]["fields"]], ["East 1"])

    def test_director_edits_and_removes_team_contacts_stay_private(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "edit-teams-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Edit Teams Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        email = f"dugout.{uuid.uuid4().hex[:6]}@local.test"
        phone = "412-555-0144"
        joined = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Dugout Heat",
            "pool": "A",
            "contact_email": email,
            "coach_phone": phone,
            "as_director": True,
        })
        team_id = joined["team"]["id"]
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Stay Put",
            "pool": "B",
            "as_director": True,
        })
        saved = request(BASE, "POST", f"/api/events/{slug}/teams/{team_id}", td, {
            "name": "Dugout Heat Renamed",
            "pool": "C",
            "gamechanger_url": "https://web.gc.com/team/dugout-heat",
            "coach_email": email,
            "coach_phone": phone,
            "alt_name": "Manager Pat",
            "alt_email": f"mgr.{uuid.uuid4().hex[:6]}@local.test",
        })
        self.assertEqual(saved["team"]["name"], "Dugout Heat Renamed")
        self.assertEqual(saved["team"]["slug"], "dugout-heat-renamed")
        self.assertEqual(saved["team"]["pool"], "C")
        self.assertEqual(saved["team"]["gamechanger_url"], "https://web.gc.com/team/dugout-heat")
        self.assertEqual(saved["team"]["contact"]["coach_phone"], phone)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        blob = json.dumps(board)
        self.assertNotIn(email, blob)
        self.assertNotIn(phone, blob)
        self.assertTrue(any(t.get("name") == "Dugout Heat Renamed" for t in board.get("roster") or []))
        gone = request(BASE, "POST", f"/api/events/{slug}/teams/{team_id}/remove", td, {})
        self.assertEqual(gone["deleted"], team_id)
        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        self.assertFalse(any(t["name"] == "Dugout Heat Renamed" for t in plan["teams"]))
        self.assertTrue(any(t["name"] == "Stay Put" for t in plan["teams"]))

    def test_stranger_cannot_remove_team(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "keep-team-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Keep Team Classic",
            "slug": slug,
        })
        joined = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Keepers",
            "as_director": True,
        })
        email = f"stranger.{uuid.uuid4().hex[:6]}@local.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "StrangerTeam1!",
            "display_name": "Stranger",
            "intent": "td",
        })
        other = auth(BASE, email, "StrangerTeam1!")
        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", f"/api/events/{slug}/teams/{joined['team']['id']}/remove", other, {})
        self.assertIn("403", str(bad.exception))

    def test_round_robin_schedules_complete_pool(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "rr-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Round Robin Classic",
            "slug": slug,
            "format": "round-robin",
            "start": "2026-10-03",
            "end": "2026-10-04",
            "fields": [{"name": "RR 1"}, {"name": "RR 2"}],
        })
        for name in ("RR Hawks", "RR Heat", "RR Cats", "RR Fox"):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": "A",
                "as_director": True,
            })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-10-03", "2026-10-04"],
            "replace": True,
            "format": "round-robin",
        })
        self.assertEqual(auto["games"], 6)
        self.assertEqual(auto["leftover"], 0)

    def test_gold_silver_splits_by_overall_rank(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "flights-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Flight Classic",
            "slug": slug,
            "format": "pool-to-bracket",
            "start": "2026-10-03",
            "end": "2026-10-04",
            "fields": [{"name": "Flight 1"}],
        })
        names = [f"Flight {n}" for n in ("Ace", "Bay", "Cove", "Dale", "Echo", "Fern", "Gale", "Hill")]
        for i, name in enumerate(names):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": "A" if i < 4 else "B",
                "as_director": True,
            })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-10-03"],
            "games_per_team": 1,
            "replace": True,
            "format": "pool-to-bracket",
        })
        for game in auto["schedule"]:
            home_win = game["home"] in ("Flight Ace", "Flight Bay")
            request(BASE, "POST", f"/api/events/{slug}/schedule/{game['id']}/score", td, {
                "home_runs": 8 if home_win else 1,
                "away_runs": 1 if home_win else 8,
                "status": "final",
                "confirm": True,
            })
        refuse = None
        try:
            request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
                "replace": True,
                "format": "pool-to-bracket",
                "bracket_flights": "gold-silver",
                "consolation": False,
                "confirm": True,
            })
        except RuntimeError as err:
            refuse = str(err)
        self.assertIsNotNone(refuse)
        self.assertIn("no automatic even split", refuse.lower())
        drawn = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "replace": True,
            "format": "pool-to-bracket",
            "consolation": False,
            "confirm": True,
            "bracket_plan": {
                "flights": [
                    {"id": "gold", "name": "Gold", "size": 4, "format": "single-elim"},
                    {"id": "silver", "name": "Silver", "size": 4, "format": "single-elim"},
                ],
            },
        })
        self.assertGreaterEqual(drawn["games"], 2)
        flights = {row["flight"]: row["seeds"] for row in drawn.get("flights") or []}
        self.assertEqual(flights.get("gold"), 4)
        self.assertEqual(flights.get("silver"), 4)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        labels = {g.get("flight") for g in board["bracket"] if g.get("status") != "bye"}
        self.assertEqual(labels, {"gold", "silver"})

    def test_custom_bracket_builder(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "custom-bk-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Custom Bracket Classic",
            "slug": slug,
            "format": "single-elim",
        })
        a = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Custom Hawks", "as_director": True,
        })
        b = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Custom Heat", "as_director": True,
        })
        out = request(BASE, "POST", f"/api/events/{slug}/bracket/custom", td, {
            "games": [{
                "round": "F",
                "slot": 1,
                "side": "championship",
                "home_id": a["team"]["id"],
                "away_id": b["team"]["id"],
            }],
        })
        self.assertEqual(out["mode"], "custom")
        self.assertEqual(len(out["bracket"]), 1)
        self.assertEqual(out["bracket"][0]["home"], "Custom Hawks")
        extra = request(BASE, "POST", f"/api/events/{slug}/bracket/custom", td, {
            "games": [{
                "round": "3RD",
                "slot": 1,
                "side": "consolation",
            }],
            "delete_ids": [out["bracket"][0]["id"]],
        })
        rounds = {g["round"] for g in extra["bracket"]}
        self.assertIn("3RD", rounds)
        self.assertNotIn("F", rounds)

    def test_pool_double_elim_draws_losers(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "de-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Double Elim Classic",
            "slug": slug,
            "format": "pool-double-elim",
        })
        for name in ("DE Hawks", "DE Heat", "DE Cats", "DE Fox"):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": "A",
                "as_director": True,
            })
        drawn = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "replace": True,
            "format": "pool-double-elim",
            "empty": True,
        })
        self.assertGreaterEqual(drawn["games"], 5)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        rounds = {g["round"] for g in board["bracket"]}
        self.assertIn("SF", rounds)
        self.assertIn("F", rounds)
        self.assertIn("L1", rounds)
        self.assertIn("LF", rounds)
        self.assertTrue(any(g.get("side") == "losers" or g.get("bracket_kind") == "losers" for g in board["bracket"]))

    def test_migration_safety_script_blocks_wipe(self):
        from scripts.check_migration_safety import scan
        harbor = ROOT / "pb" / "pb_migrations" / "1700000017_harbor_eight.js"
        self.assertEqual(scan(harbor), [])
        newest = ROOT / "pb" / "pb_migrations" / "1700000026_admin_teams_brackets.js"
        self.assertEqual(scan(newest), [])
        fake = Path("/tmp/1700000099_wipe_all.js")
        fake.write_text(
            'const KEEP = { "keystone-clash-2026": true };\n'
            'function wipeEvent(event) { app.delete(event); }\n'
            'const events = app.findRecordsByFilter("events", "", "", 200, 0);\n',
            encoding="utf-8",
        )
        hits = scan(fake)
        self.assertTrue(any("wipeEvent" in h for h in hits))
        self.assertTrue(any("KEEP" in h for h in hits))
        self.assertTrue(any("deletes" in h for h in hits))


class SchedulerTeamDropdownTests(unittest.TestCase):
    """Scheduler and custom bracket only accept registered event teams."""

    def _weekend(self, td, prefix="dd"):
        slug = prefix + "-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Dropdown Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "format": "pool-only",
            "fields": [{"name": "Drop 1"}],
        })
        hawks = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Drop Hawks",
            "pool": "A",
            "as_director": True,
        })
        heat = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Drop Heat",
            "pool": "A",
            "as_director": True,
        })
        return slug, hawks["team"], heat["team"]

    def test_add_game_rejects_unregistered_name(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug, hawks, heat = self._weekend(td, "ghost")
        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
                "home": "Ghost Club",
                "away": heat["name"],
                "date": "2026-10-24",
                "time": "09:00",
                "pool": "A",
            })
        self.assertIn("400", str(bad.exception))
        self.assertIn("registered team", str(bad.exception).lower())
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        names = [t["name"] for t in board["roster"]]
        self.assertEqual(sorted(names), ["Drop Hawks", "Drop Heat"])
        self.assertFalse(board["schedule"])

    def test_add_and_update_game_use_registered_ids(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug, hawks, heat = self._weekend(td, "ids")
        cats = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Drop Cats",
            "pool": "A",
            "as_director": True,
        })
        added = request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home_id": hawks["id"],
            "away_id": heat["id"],
            "date": "2026-10-24",
            "time": "09:00",
            "field": "Drop 1",
            "pool": "A",
        })
        self.assertEqual(added["game"]["home"], "Drop Hawks")
        self.assertEqual(added["game"]["away"], "Drop Heat")
        self.assertEqual(added["game"]["home_id"], hawks["id"])
        updated = request(BASE, "POST", f"/api/events/{slug}/schedule/{added['game']['id']}", td, {
            "home_id": cats["team"]["id"],
            "away_id": hawks["id"],
        })
        self.assertEqual(updated["game"]["home"], "Drop Cats")
        self.assertEqual(updated["game"]["away"], "Drop Hawks")
        with self.assertRaises(RuntimeError) as same:
            request(BASE, "POST", f"/api/events/{slug}/schedule/{added['game']['id']}", td, {
                "home_id": hawks["id"],
                "away_id": hawks["id"],
            })
        self.assertIn("400", str(same.exception))

    def test_custom_bracket_rejects_unknown_team(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug, hawks, heat = self._weekend(td, "bk")
        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", f"/api/events/{slug}/bracket/custom", td, {
                "games": [{
                    "round": "F",
                    "slot": 1,
                    "side": "championship",
                    "home_id": hawks["id"],
                    "away_id": "not-a-registered-team",
                }],
            })
        self.assertIn("400", str(bad.exception))
        self.assertIn("registered team", str(bad.exception).lower())
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertFalse(board["bracket"])
        ok = request(BASE, "POST", f"/api/events/{slug}/bracket/custom", td, {
            "games": [{
                "round": "F",
                "slot": 1,
                "side": "championship",
                "home_id": hawks["id"],
                "away_id": heat["id"],
            }],
        })
        self.assertEqual(ok["bracket"][0]["home"], "Drop Hawks")
        self.assertEqual(ok["bracket"][0]["away"], "Drop Heat")


class ScheduleCsvImportTests(unittest.TestCase):
    """A schedule CSV without a real weekend name must not open Clipboard Open."""

    def _csv(self):
        return (ROOT / "testdata" / "clipboard_open.csv").read_text()

    def _public_slugs(self):
        page = request(BASE, "GET", "/api/collections/events/records?perPage=200")
        return {row["slug"] for row in page.get("items") or []}

    def test_mashless_clipboard_defaults_do_not_create_a_weekend(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        before = self._public_slugs()
        ghost = "ghost-grid-" + uuid.uuid4().hex[:8]
        with self.assertRaises(RuntimeError) as blank:
            request(BASE, "POST", "/api/event/import-schedule", td, {
                "csv": self._csv(),
                "replace": True,
            })
        self.assertIn("400", str(blank.exception))
        with self.assertRaises(RuntimeError) as unused:
            request(BASE, "POST", "/api/event/import-schedule", td, {
                "event_slug": ghost,
                "event_name": "Ghost Grid",
                "csv": self._csv(),
                "replace": True,
            })
        self.assertIn("400", str(unused.exception))
        self.assertIn("does not exist", str(unused.exception).lower())
        after = self._public_slugs()
        self.assertEqual(after, before)
        self.assertNotIn(ghost, after)
        self.assertNotIn("clipboard-open", after - before)

    def test_placeholder_name_refused_even_with_create(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        with self.assertRaises(RuntimeError) as bad:
            request(BASE, "POST", "/api/event/import-schedule", td, {
                "event_slug": "clipboard-open",
                "event_name": "Clipboard Open",
                "csv": self._csv(),
                "create": True,
            })
        self.assertIn("400", str(bad.exception))
        self.assertIn("clipboard open", str(bad.exception).lower())
        slugs = self._public_slugs()
        self.assertNotIn("clipboard-open", slugs)

    def test_import_into_existing_stays_on_that_slug(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "keep-csv-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Keep CSV Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "format": "imported",
        })
        before = self._public_slugs()
        out = request(BASE, "POST", f"/api/events/{slug}/schedule/import", td, {
            "csv": self._csv(),
            "replace": False,
        })
        self.assertEqual(out["event"], slug)
        self.assertFalse(out["created"])
        self.assertGreaterEqual(out["imported"], 3)
        again = request(BASE, "POST", "/api/event/import-schedule", td, {
            "event_slug": slug,
            "event_name": "Clipboard Open",
            "csv": self._csv(),
            "replace": True,
        })
        self.assertEqual(again["event"], slug)
        self.assertFalse(again["created"])
        self.assertGreaterEqual(again["imported"], 3)
        self.assertEqual(self._public_slugs(), before)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(board["event"]["slug"], slug)
        self.assertEqual(board["event"]["name"], "Keep CSV Classic")
        pool_a = next(p for p in board["standings"] if p["name"] == "A")
        self.assertEqual(pool_a["teams"][0]["name"], "Northside")
        self.assertEqual(pool_a["teams"][0]["w"], 2)
        self.assertNotIn("clipboard-open", self._public_slugs())

    def test_create_true_with_real_name_opens_one_weekend(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "named-grid-" + uuid.uuid4().hex[:8]
        out = request(BASE, "POST", "/api/event/import-schedule", td, {
            "event_slug": slug,
            "event_name": "Named Grid Classic",
            "csv": self._csv(),
            "create": True,
        })
        self.assertTrue(out["created"])
        self.assertEqual(out["event"], slug)
        self.assertGreaterEqual(out["imported"], 3)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(board["event"]["name"], "Named Grid Classic")
        self.assertEqual((board["event"].get("pitch_limit_mode") or "none"), "none")


class FieldRowNumberTests(unittest.TestCase):
    """Form field indexes stay dense so Add another field never skips a number."""

    def test_dense_and_gapped_field_names_persist(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "field-n-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Field Numbers Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        first_id = created["event"]["fields"][0]["id"]
        after_remove_middle = request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "field_id_0": first_id,
            "field_name_0": "Harbor 1",
            "field_name_1": "Harbor 3",
        })
        names = [f["name"] for f in after_remove_middle["event"]["fields"]]
        self.assertEqual(names, ["Harbor 1", "Harbor 3"])
        keys = {k: f"Diamond {i + 1}" for i, k in enumerate([f"field_name_{i}" for i in range(20)])}
        keys["field_id_0"] = after_remove_middle["event"]["fields"][0]["id"]
        saved = request(BASE, "POST", f"/api/events/{slug}/settings", td, keys)
        got = [f["name"] for f in saved["event"]["fields"]]
        self.assertEqual(len(got), 20)
        self.assertEqual(set(got), {f"Diamond {i}" for i in range(1, 21)})
        again = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        self.assertEqual({f["name"] for f in again["fields"]}, set(got))


class ImportedScheduleBracketTests(unittest.TestCase):
    """Selecting or drawing a bracket must not rewrite an imported pool grid."""

    CSV = (
        "date,time,home,away,pool,field,home_runs,away_runs,status\n"
        "2026-09-20,09:00,Northside,West End,A,Harbor 1,5,3,final\n"
        "2026-09-20,10:30,West End,Northside,A,Harbor 1,1,4,final\n"
        "2026-09-20,09:00,Eastside,South Ridge,B,Harbor 2,,,scheduled\n"
        "2026-09-21,11:00,Northside,Eastside,A,Harbor 1,,,scheduled\n"
    )

    def _import(self, td, prefix="imp-bk"):
        slug = prefix + "-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/event/import-schedule", td, {
            "event_slug": slug,
            "event_name": "Imported Bracket Weekend",
            "csv": self.CSV,
            "replace": True,
            "create": True,
        })
        return slug

    def _snap(self, slug):
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        rows = [(g["id"], g["date"], g["time"], g["home"], g["away"], g["status"], g.get("field") or "")
                for g in board["schedule"]]
        return board, sorted(rows)

    def test_draw_bracket_keeps_imported_pool_games(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._import(td, "draw")
        _, before = self._snap(slug)
        self.assertEqual(len(before), 4)
        request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "format": "pool-to-bracket",
            "replace": True,
            "draw_bracket": True,
        })
        drawn = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "replace": True,
            "format": "pool-to-bracket",
            "consolation": True,
            "confirm": True,
        })
        self.assertGreaterEqual(drawn["games"], 2)
        board, after = self._snap(slug)
        self.assertEqual(after, before)
        self.assertTrue(board["bracket"])

    def test_selecting_bracket_then_auto_keeps_imported_pool(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._import(td, "auto")
        _, before = self._snap(slug)
        request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "format": "pool-to-bracket",
            "bracket_flights": "none",
        })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-20", "2026-09-21"],
            "replace": True,
            "draw_bracket": True,
            "format": "pool-to-bracket",
            "games_per_team": 2,
        })
        self.assertEqual(auto["games"], 0)
        self.assertIn("imported", (auto.get("note") or "").lower())
        board, after = self._snap(slug)
        self.assertEqual(after, before)
        self.assertTrue(board["bracket"])
        names = {(g["home"], g["away"], g["time"]) for g in board["schedule"]}
        self.assertIn(("Eastside", "South Ridge", "09:00"), names)
        self.assertIn(("Northside", "Eastside", "11:00"), names)

    def test_auto_with_imported_format_does_not_drop_unplayed(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._import(td, "keep")
        _, before = self._snap(slug)
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-20"],
            "replace": True,
            "draw_bracket": False,
            "format": "imported",
        })
        self.assertEqual(auto["games"], 0)
        _, after = self._snap(slug)
        self.assertEqual(after, before)


class BacklogOpenTests(unittest.TestCase):
    """Items 10–20 and GitHub #19: pins, provenance, info dates, empty seeds, clear, format save."""

    def test_director_form_ignores_typed_coordinates(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "no-pin-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "No Pin Classic",
            "slug": slug,
            "venue": "Harbor",
            "lat": 1.23,
            "lng": 4.56,
            "ages": "10U",
        })
        ev = created["event"]
        self.assertNotEqual(ev.get("lat"), 1.23)
        self.assertNotEqual(ev.get("lng"), 4.56)
        self.assertEqual(ev.get("format") or "pool-to-bracket", "pool-to-bracket")

    def test_search_finds_new_event_by_slug(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "find-me-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Find Me Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        found = request(BASE, "GET", f"/api/events/search?q={slug}")
        slugs = [e["slug"] for e in found.get("events") or []]
        self.assertIn(slug, slugs)
        self.assertNotIn("co_owners", found["events"][0])

    def test_info_dates_come_from_event_not_keystone_literal(self):
        src = (ROOT / "pb/pb_public/js/event.js").read_text()
        self.assertIn("function formatWeekendDates", src)
        self.assertNotIn("Global hours", src)
        self.assertIn("Park hours", src)
        self.assertNotIn('packet?.dates || "September 11', src)
        self.assertIn("function parkingMapView", src)
        self.assertIn("isKeystoneParkingAsset", src)
        self.assertIn('src="${escapeHtml(mapHref)}"', src)
        self.assertNotIn('<img src="/popup/parking-map.png"', src)
        self.assertIn("Check back closer to the weekend", src)
        self.assertNotIn("Build pool play on Admin, then draw the bracket.", src)

    def test_standings_have_no_seeds_before_a_final(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "no-seed-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "No Seed Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "format": "pool-to-bracket",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Zebra Hawks",
            "pool": "A",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Alpha Heat",
            "pool": "A",
            "as_director": True,
        })
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        teams = [t for p in board["standings"] for t in p["teams"]]
        self.assertEqual(len(teams), 2)
        self.assertTrue(all(t.get("seed") in (None, 0, "") for t in teams))
        self.assertTrue(all(not t.get("seed_reason") for t in teams))
        blob = json.dumps(board)
        self.assertNotIn("name order", blob)
        self.assertNotIn("better record", blob)

    def test_draw_from_standings_refuses_before_finals(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "early-draw-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Early Draw Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Draw Hawks", "pool": "A", "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Draw Heat", "pool": "A", "as_director": True,
        })
        with self.assertRaises(RuntimeError) as err:
            request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
                "format": "pool-to-bracket",
                "replace": True,
            })
        self.assertIn("400", str(err.exception))
        self.assertIn("No pool results yet", str(err.exception))
        empty = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "empty": True,
            "format": "pool-to-bracket",
            "replace": True,
        })
        self.assertGreaterEqual(empty["games"], 1)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertTrue(board["bracket"])
        seeded = [g for g in board["bracket"] if g.get("home_id") and g.get("away_id")]
        self.assertEqual(seeded, [])
        cleared = request(BASE, "POST", f"/api/events/{slug}/bracket/clear", td, {})
        self.assertGreaterEqual(cleared["deleted"], 1)
        after = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertFalse(after["bracket"])
        with self.assertRaises(RuntimeError) as anon:
            request(BASE, "POST", f"/api/events/{slug}/bracket/clear", None, {})
        self.assertTrue("401" in str(anon.exception) or "403" in str(anon.exception))

    def test_scheduler_settings_save_format_without_building(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "fmt-save-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Format Save Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "format": "pool-to-bracket",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Fmt Hawks", "pool": "A", "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Fmt Heat", "pool": "A", "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "format": "pool-double-elim",
            "bracket_flights": "gold-silver",
        })
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(board["event"]["format"], "pool-double-elim")
        self.assertEqual(board["event"].get("bracket_flights"), "gold-silver")
        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        self.assertEqual(plan["event"].get("bracket_flights"), "gold-silver")
        flights_only = "flights-only-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Flights Only Classic",
            "slug": flights_only,
            "venue": "Ambridge Middle School",
            "ages": "10U",
            "format": "pool-to-bracket",
        })
        saved = request(BASE, "POST", f"/api/events/{flights_only}/settings", td, {
            "bracket_flights": "gold-silver",
        })
        self.assertEqual(saved["event"].get("bracket_flights"), "gold-silver")
        self.assertEqual(saved["event"]["format"], "pool-to-bracket")
        again = request(BASE, "GET", f"/api/events/{flights_only}/plan", td)
        self.assertEqual(again["event"].get("bracket_flights"), "gold-silver")
        board2 = request(BASE, "GET", f"/api/event/{flights_only}/board")
        self.assertEqual(board2["event"].get("bracket_flights"), "gold-silver")
        sched = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertFalse(sched["schedule"])

    def test_csv_create_uses_pool_to_bracket_not_imported_format(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "prov-" + uuid.uuid4().hex[:8]
        csv = (
            "date,time,home,away,pool,field,home_runs,away_runs,status\n"
            "2026-09-20,09:00,Northside,West End,A,Harbor 1,5,3,final\n"
        )
        out = request(BASE, "POST", "/api/event/import-schedule", td, {
            "event_slug": slug,
            "event_name": "Provenance Classic",
            "csv": csv,
            "create": True,
        })
        self.assertTrue(out["created"])
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(board["event"]["format"], "pool-to-bracket")
        drawn = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "format": "pool-to-bracket",
            "replace": True,
        })
        self.assertGreaterEqual(drawn["games"], 1)

    def test_clear_schedule_keeps_finals(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "clr-sked-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Clear Schedule Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Clear Hawks", "pool": "A", "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Clear Heat", "pool": "A", "as_director": True,
        })
        added = request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Clear Hawks",
            "away": "Clear Heat",
            "date": "2026-10-11",
            "time": "09:00",
            "field": "Field 1",
            "pool": "A",
        })
        gid = added["game"]["id"]
        request(BASE, "POST", f"/api/events/{slug}/schedule/{gid}/score", td, {
            "home_runs": 4, "away_runs": 1, "status": "final", "confirm": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Clear Hawks",
            "away": "Clear Heat",
            "date": "2026-10-11",
            "time": "11:00",
            "field": "Field 1",
            "pool": "A",
        })
        out = request(BASE, "POST", f"/api/events/{slug}/schedule/clear", td, {})
        self.assertEqual(out["kept"], 1)
        self.assertGreaterEqual(out["deleted"], 1)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(len(board["schedule"]), 1)
        self.assertEqual(board["schedule"][0]["status"], "final")
        self.assertEqual(board["standings"][0]["teams"][0]["seed"], 1)

    def test_schedule_orders_by_game_number_then_field(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "sort-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Sort Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Sort Hawks", "pool": "A", "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Sort Heat", "pool": "A", "as_director": True,
        })
        for num, field in ((2, "Field 6"), (3, "Field 1"), (4, "Field 2"), (1, "Field 4")):
            request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
                "home": "Sort Hawks",
                "away": "Sort Heat",
                "date": "2026-09-20",
                "time": "08:00",
                "field": field,
                "pool": "A",
                "game_number": num,
            })
        request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Sort Hawks",
            "away": "Sort Heat",
            "date": "2026-09-20",
            "time": "11:00",
            "field": "Field 10",
            "pool": "A",
            "game_number": 50,
        })
        request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Sort Hawks",
            "away": "Sort Heat",
            "date": "2026-09-20",
            "time": "11:00",
            "field": "Field 2",
            "pool": "A",
            "game_number": 50,
        })
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        morning = [g for g in board["overall"] if g.get("time") == "08:00"]
        self.assertEqual([g.get("game_number") for g in morning], [1, 2, 3, 4])
        later = [g for g in board["overall"] if g.get("time") == "11:00"]
        self.assertEqual([g.get("field") for g in later], ["Field 2", "Field 10"])

    def test_bracket_csv_preview_and_import(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "bk-imp-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Bracket Import Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        for name in (
            "Oaks", "River", "Maple", "Lake", "Iron", "Pine", "Cedar", "West",
        ):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": f"{name} 10U (FAKE)", "pool": "A", "as_director": True,
            })
        csv = (ROOT / "pb/pb_public/templates/diamond-tourney-bracket.csv").read_text()
        preview = request(BASE, "POST", f"/api/events/{slug}/import-bracket/preview", td, {"csv": csv})
        self.assertEqual(preview["counts"]["total"], 14)
        self.assertEqual(preview["counts"]["problems"], 0)
        labels = [r["game"] for r in preview["rows"]]
        self.assertIn("B1", labels)
        self.assertIn("IF", labels)
        self.assertTrue(any(r.get("winner_to") == "B5" for r in preview["rows"]))
        committed = request(BASE, "POST", f"/api/events/{slug}/import-bracket", td, {"csv": csv})
        self.assertEqual(committed["counts"]["new"], 14)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(len(board["bracket"]), 14)
        self.assertEqual(board["event"].get("bracket_mode"), "imported")
        by_id = {g.get("game_id"): g for g in board["bracket"]}
        self.assertEqual(by_id["B1"]["winner_to"], "B5")
        self.assertEqual(by_id["B1"]["loser_to"], "L1")
        self.assertTrue("1st" in (by_id["B1"]["home"] or "") or "Seed" in (by_id["B1"]["home"] or ""))
        self.assertTrue(
            (by_id["B5"]["home"] or "").startswith("W")
            or "Winner" in (by_id["B5"]["home"] or "")
        )
        bad = request(BASE, "POST", f"/api/events/{slug}/import-bracket/preview", td, {
            "csv": (
                "game,round,home,away,winner_to\n"
                "B1,QF,Ghost Club,Oaks 10U (FAKE),B9\n"
            ),
        })
        self.assertGreaterEqual(bad["counts"]["problems"], 1)
        self.assertTrue(any("unmatched" in " ".join(r.get("problems") or []) for r in bad["rows"]))
        cycle = request(BASE, "POST", f"/api/events/{slug}/import-bracket/preview", td, {
            "csv": (
                "game,round,home,away,winner_to\n"
                "B1,QF,seed:1,seed:2,B2\n"
                "B2,F,winner:B1,seed:3,B1\n"
            ),
        })
        self.assertTrue(any("cycle" in " ".join(r.get("problems") or []).lower() for r in cycle["rows"]))
        with self.assertRaises(RuntimeError) as anon:
            request(BASE, "POST", f"/api/events/{slug}/import-bracket", None, {"csv": csv})
        self.assertTrue("401" in str(anon.exception) or "403" in str(anon.exception))

    def test_bracket_reimport_keeps_finals(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "bk-keep-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Bracket Keep Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Keep Hawks", "pool": "A", "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Keep Heat", "pool": "A", "as_director": True,
        })
        csv = (
            "game,round,side,home,away,winner_to,status,home_runs,away_runs\n"
            "B1,SF,championship,Keep Hawks,Keep Heat,B2,final,4,1\n"
            "B2,F,championship,winner:B1,Keep Heat,,scheduled,,\n"
        )
        request(BASE, "POST", f"/api/events/{slug}/import-bracket", td, {"csv": csv})
        again = (
            "game,round,side,home,away,winner_to\n"
            "B1,SF,championship,Keep Heat,Keep Hawks,B2\n"
            "B2,F,championship,winner:B1,Keep Hawks,\n"
        )
        out = request(BASE, "POST", f"/api/events/{slug}/import-bracket", td, {"csv": again})
        self.assertEqual(out["counts"]["kept"], 1)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        b1 = next(g for g in board["bracket"] if g.get("game_id") == "B1")
        self.assertEqual(b1["status"], "final")
        self.assertEqual(b1["home"], "Keep Hawks")
        self.assertEqual(b1["home_runs"], 4)

    def test_blank_bracket_fills_when_pool_is_final(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "blank-bk-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Blank Bracket Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "end": "2026-09-21",
            "hours_start": "09:00",
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Blank Hawks", "pool": "A", "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Blank Heat", "pool": "A", "as_director": True,
        })
        empty = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "empty": True,
            "replace": True,
            "format": "pool-to-bracket",
        })
        self.assertGreaterEqual(empty["games"], 1)
        before = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertTrue(before["bracket"])
        self.assertTrue(all(not g.get("home_id") for g in before["bracket"]))
        self.assertTrue(any(g.get("date") for g in before["bracket"]))
        added = request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Blank Hawks",
            "away": "Blank Heat",
            "date": "2026-09-20",
            "time": "09:00",
            "field": "Field 1",
            "pool": "A",
        })
        request(BASE, "POST", f"/api/events/{slug}/schedule/{added['game']['id']}/score", td, {
            "home_runs": 5, "away_runs": 1, "status": "final", "confirm": True,
        })
        after = request(BASE, "GET", f"/api/event/{slug}/board")
        filled = [g for g in after["bracket"] if g.get("home") and g.get("away")]
        self.assertTrue(filled)
        self.assertEqual(after["event"].get("bracket_mode"), "standings")


class BoxScoreTeamPageTests(unittest.TestCase):
    """BACKLOG 21–24: token box mail, two-book reconcile, read-only assist, team pages."""

    MIN_PDF = b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"

    def _weekend(self, td, name):
        slug = name + "-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": name.replace("-", " ").title(),
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
            "start": "2026-09-18",
            "end": "2026-09-19",
            "hours_start": "08:00",
            "hours_end": "18:00",
            "game_length_minutes": 90,
            "format": "pool-to-bracket",
        })
        return slug

    def _team(self, td, slug, name, email):
        out = request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": name,
            "contact_name": "Coach " + name,
            "contact_email": email,
            "coach_email": email,
            "coach_phone": "412-555-0100",
            "pool": "A",
            "as_director": True,
        })
        return out["team"]

    def test_box_mail_tokens_reconcile_and_privacy(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._weekend(td, "box-mail")
        home_email = f"home.{uuid.uuid4().hex[:6]}@local.test"
        away_email = f"away.{uuid.uuid4().hex[:6]}@local.test"
        home = self._team(td, slug, "Dukes Book", home_email)
        away = self._team(td, slug, "Roadrunners Book", away_email)
        played = request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Dukes Book",
            "away": "Roadrunners Book",
            "date": "2026-09-18",
            "time": "09:00",
            "field": "Field 1",
            "pool": "A",
            "game_number": 4,
        })["game"]
        cancelled = request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Dukes Book",
            "away": "Roadrunners Book",
            "date": "2026-09-18",
            "time": "11:00",
            "field": "Field 1",
            "pool": "A",
            "status": "cancelled",
        })["game"]
        first = request(BASE, "POST", f"/api/events/{slug}/boxes/run", td, {
            "now": "2026-09-18T12:00:00.000Z",
        })
        self.assertEqual(first["invited"], 2)
        self.assertEqual(len(first["invites"]), 2)
        self.assertEqual(first.get("reason"), "smtp_not_configured")
        tokens = {row["team_id"]: row["token"] for row in first["invites"]}
        self.assertEqual(set(tokens), {home["id"], away["id"]})
        again = request(BASE, "POST", f"/api/events/{slug}/boxes/run", td, {
            "now": "2026-09-18T12:30:00.000Z",
        })
        self.assertEqual(again["invited"], 0)
        self.assertEqual(again["reminded"], 0)
        reminder = request(BASE, "POST", f"/api/events/{slug}/boxes/run", td, {
            "now": "2026-09-19T12:00:00.000Z",
        })
        self.assertEqual(reminder["reminded"], 2)
        third = request(BASE, "POST", f"/api/events/{slug}/boxes/run", td, {
            "now": "2026-09-20T12:00:00.000Z",
        })
        self.assertEqual(third["reminded"], 0)
        self.assertEqual(third["invited"], 0)
        desk = request(BASE, "GET", f"/api/events/{slug}/boxes/desk", td)
        self.assertFalse(any(g["id"] == cancelled["id"] and g.get("books") for g in desk["games"]
                             if g["id"] == cancelled["id"] and g["books"]))
        cancelled_row = next(g for g in desk["games"] if g["id"] == cancelled["id"])
        self.assertEqual(cancelled_row["books"], [])
        home_tok = tokens[home["id"]]
        away_tok = tokens[away["id"]]
        public = request(BASE, "GET", f"/api/box/{home_tok}")
        self.assertEqual(public["team"]["name"], "Dukes Book")
        self.assertEqual(public["game"]["game_number"], 4)
        blob = json.dumps(public)
        self.assertNotIn(home_email, blob)
        self.assertNotIn(away_email, blob)
        self.assertNotIn(away_tok, blob)
        other = request(BASE, "GET", f"/api/box/{away_tok}")
        self.assertEqual(other["team"]["name"], "Roadrunners Book")
        first_book = request(BASE, "POST", f"/api/box/{home_tok}", None, {
            "home_runs": 5,
            "away_runs": 3,
            "method": "manual",
            "submitted_by": "Dukes coach",
        })
        self.assertEqual(first_book["state"], "one_book")
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        row = next(g for g in board["schedule"] if g["id"] == played["id"])
        self.assertEqual(row["home_runs"], 5)
        self.assertEqual(row["away_runs"], 3)
        self.assertEqual(row["score_source"], "one_book")
        self.assertIn("home_slug", row)
        gc = request(BASE, "POST", f"/api/box/{away_tok}", None, {
            "home_runs": 6,
            "away_runs": 3,
            "gc_url": "https://web.gc.com/teams/roadrunners/schedule/game-4/box-score",
            "method": "gc_link",
            "submitted_by": "Roadrunners coach",
        })
        self.assertEqual(gc["state"], "conflict")
        held = request(BASE, "GET", f"/api/event/{slug}/board")
        held_row = next(g for g in held["schedule"] if g["id"] == played["id"])
        self.assertIsNone(held_row["home_runs"])
        self.assertIsNone(held_row["away_runs"])
        self.assertEqual(held_row["score_source"], "conflict")
        desk2 = request(BASE, "GET", f"/api/events/{slug}/boxes/desk", td)
        self.assertEqual(desk2["games"][0]["book_state"], "conflict")
        resolved = request(BASE, "POST", f"/api/events/{slug}/boxes/resolve", td, {
            "game_id": played["id"],
            "kind": "schedule",
            "pick": "home",
        })
        self.assertEqual(resolved["score_source"], "verified")
        self.assertEqual(resolved["home_runs"], 5)
        final = request(BASE, "GET", f"/api/event/{slug}/board")
        done = next(g for g in final["schedule"] if g["id"] == played["id"])
        self.assertEqual(done["home_runs"], 5)
        self.assertEqual(done["score_source"], "verified")
        stop = request(BASE, "POST", f"/api/box/{home_tok}/unsubscribe")
        self.assertTrue(stop["stopped"])
        self.assertFalse(read_or_denied("/api/collections/box_submissions/records?perPage=1"))
        self.assertFalse(read_or_denied(f"/api/collections/team_contacts/records?perPage=1"))
        page = request(BASE, "GET", f"/api/event/{slug}/team/{home['slug']}")
        page_blob = json.dumps(page)
        self.assertNotIn(home_email, page_blob)
        self.assertNotIn(away_email, page_blob)
        self.assertNotIn("412-555-0100", page_blob)
        self.assertNotIn("coach_email", page_blob)
        self.assertNotIn("coach_phone", page_blob)
        self.assertEqual(page["team"]["name"], "Dukes Book")
        self.assertTrue(page["schedule"])
        self.assertIsNone(page.get("paid"))
        director_page = request(BASE, "GET", f"/api/event/{slug}/team/{home['slug']}", td)
        self.assertIn("paid", director_page)
        self.assertIn("box_scores", director_page)
        pdf_slug = self._weekend(td, "box-file")
        pdf_home = self._team(td, pdf_slug, "File Hawks", f"fileh.{uuid.uuid4().hex[:6]}@local.test")
        pdf_away = self._team(td, pdf_slug, "File Heat", f"filea.{uuid.uuid4().hex[:6]}@local.test")
        request(BASE, "POST", f"/api/events/{pdf_slug}/schedule/game", td, {
            "home": "File Hawks",
            "away": "File Heat",
            "date": "2026-09-18",
            "time": "08:00",
            "field": "Field 1",
            "pool": "A",
        })
        ran = request(BASE, "POST", f"/api/events/{pdf_slug}/boxes/run", td, {
            "now": "2026-09-18T12:00:00.000Z",
        })
        file_tok = next(row["token"] for row in ran["invites"] if row["team_id"] == pdf_home["id"])
        uploaded = request_multipart(BASE, f"/api/box/{file_tok}", None, {
            "home_runs": "2",
            "away_runs": "1",
            "method": "gc_pdf",
            "original_name": "book.pdf",
            "submitted_by": "File coach",
        }, {"file": ("book.pdf", self.MIN_PDF, "application/pdf")})
        self.assertEqual(uploaded["state"], "one_book")
        owner = auth(BASE, "owner@local.test", "RegionAdmin1!")
        logs = request(BASE, "GET", "/api/collections/sync_log/records?perPage=200", owner)
        self.assertTrue(any(row.get("kind") == "box_mail" for row in logs.get("items") or []))

    def test_assist_is_read_only_and_shows_math(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._weekend(td, "assist-fit")
        request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "fields": [{"name": "Field 1"}, {"name": "Field 2"}],
            "hours_start": "08:00",
            "hours_end": "18:00",
            "game_length_minutes": 90,
            "start": "2026-09-12",
            "end": "2026-09-13",
            "format": "pool-to-bracket",
        })
        for i in range(8):
            self._team(td, slug, f"Assist {i+1}", f"assist{i}.{uuid.uuid4().hex[:4]}@local.test")
        fit = request(BASE, "GET", f"/api/events/{slug}/assist?q=fit", td)
        self.assertEqual(fit["label"], "assistant-generated")
        self.assertEqual(fit["numbers"]["teams"], 8)
        self.assertEqual(fit["numbers"]["fields"], 2)
        self.assertTrue(fit["math"])
        self.assertIn("fields", fit["math"][0])
        lose = request(BASE, "GET", f"/api/events/{slug}/assist?q=lose_field&field=Field%202&time=12:00", td)
        self.assertEqual(lose["question"], "lose_field")
        self.assertTrue(lose["math"])
        behind = request(BASE, "GET", f"/api/events/{slug}/assist?q=behind", td)
        self.assertEqual(behind["question"], "behind")
        unknown = request(BASE, "GET", f"/api/events/{slug}/assist?q=mercy-rule", td)
        self.assertIn("I don't know", unknown["answer"])
        with self.assertRaises(RuntimeError) as anon:
            request(BASE, "GET", f"/api/events/{slug}/assist?q=fit")
        self.assertTrue("401" in str(anon.exception) or "403" in str(anon.exception))
        with self.assertRaises(RuntimeError) as wrote:
            request(BASE, "POST", f"/api/events/{slug}/assist", td, {"q": "fit"})
        self.assertTrue("404" in str(wrote.exception) or "405" in str(wrote.exception))
        try:
            request(BASE, "GET", "/api/event/keystone-clash-2026/board")
            admin = auth(BASE, "admin@local.test", "SoftballAdmin1!", "_superusers")
            ks = request(BASE, "GET", "/api/events/keystone-clash-2026/assist?q=fit", admin)
            self.assertEqual(ks["label"], "assistant-generated")
            self.assertGreaterEqual(ks["numbers"]["teams"], 8)
        except RuntimeError:
            pass

    def test_team_names_link_and_public_json_omits_contacts(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._weekend(td, "team-page")
        email = f"hidden.{uuid.uuid4().hex[:6]}@local.test"
        team = self._team(td, slug, "Forward Hawks", email)
        self._team(td, slug, "Forward Heat", f"other.{uuid.uuid4().hex[:6]}@local.test")
        request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Forward Hawks",
            "away": "Forward Heat",
            "date": "2026-10-11",
            "time": "12:30",
            "field": "Field 4",
            "pool": "A",
        })
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertTrue(any(t.get("slug") == team["slug"] for p in board["standings"] for t in p["teams"]))
        self.assertTrue(any(g.get("home_slug") == team["slug"] for g in board["schedule"]))
        page = request(BASE, "GET", f"/api/event/{slug}/team/{team['slug']}")
        self.assertEqual(page["event"]["slug"], slug)
        self.assertTrue(page["next"])
        self.assertEqual(page["next"]["field"], "Field 4")
        self.assertNotIn(email, json.dumps(page))
        src = (ROOT / "pb/pb_public/js/event.js").read_text()
        self.assertIn("function teamLink", src)
        self.assertIn("/t/${eventSlug}/team/${teamSlug}", src)



class LeaderQualifyTests(unittest.TestCase):
    """Live leader gates scale with games played; no 'over' without an IP cap."""

    def _weekend(self, td, name):
        slug = name + "-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": name.replace("-", " ").title(),
            "slug": slug,
            "venue": "La Roche College",
            "ages": "11U",
            "start": "2026-09-19",
            "end": "2026-09-20",
            "format": "pool-only",
            "fields": [{"name": "Main"}],
        })
        return created["event"]["slug"]

    def _teams(self, td, slug):
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Gate Hawks",
            "pool": "A",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Gate Heat",
            "pool": "A",
            "as_director": True,
        })

    def _game(self, td, slug, number, time):
        return request(BASE, "POST", f"/api/events/{slug}/schedule/game", td, {
            "home": "Gate Hawks",
            "away": "Gate Heat",
            "date": "2026-09-19",
            "time": time,
            "field": "Main",
            "pool": "A",
            "game_number": number,
        })["game"]

    def _final_box(self, td, slug, game_id, ab=3, ip="2.0"):
        request(BASE, "POST", f"/api/events/{slug}/schedule/{game_id}/score", td, {
            "home_runs": 5,
            "away_runs": 2,
            "status": "final",
            "confirm": True,
        })
        bot = auth(BASE, "bot@local.test", "BotStaging1!")
        return request(BASE, "POST", "/api/bot/event-box", bot, {
            "event_slug": slug,
            "schedule_id": game_id,
            "home_runs": 5,
            "away_runs": 2,
            "hitting": [{
                "side": "home", "jersey": "4", "name": "Maeve D",
                "ab": ab, "r": 1, "h": 1, "rbi": 1, "bb": 0, "so": 0,
            }],
            "pitching": [{
                "side": "home", "jersey": "7", "name": "Sam P",
                "ip": ip, "h": 2, "r": 1, "er": 1, "bb": 0, "so": 2,
            }],
        })

    def test_no_cap_does_not_mark_over_and_early_lines_qualify(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._weekend(td, "gate-early")
        self.assertEqual((request(BASE, "GET", f"/api/event/{slug}/board")["event"].get("pitch_limit_mode") or "none"), "none")
        self._teams(td, slug)
        game = self._game(td, slug, 1, "09:00")
        self._final_box(td, slug, game["id"], ab=3, ip="2.0")
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        leaders = board["leaders"]
        self.assertEqual(leaders["min_ab"], 2)
        self.assertEqual(leaders["min_ip"], 1)
        self.assertEqual(leaders["games_played"], 1)
        self.assertEqual(leaders["qualify_source"], "dynamic")
        self.assertFalse(leaders["has_pitch_ip_cap"])
        hit_names = [r.get("name_key") or r.get("player") for r in leaders["hitting"]]
        pit_names = [r.get("name_key") or r.get("player") for r in leaders["pitching"]]
        self.assertIn("Maeve D #4", hit_names)
        self.assertIn("Sam P #7", pit_names)
        self.assertFalse(leaders["all_tournament"]["hitters"])
        counts = leaders["pitch_counts"]
        self.assertTrue(counts)
        self.assertFalse(any(r.get("over") for r in counts))
        self.assertTrue(all(r.get("limit_ip") is None for r in counts))

    def test_mins_rise_to_weekend_awards_line(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._weekend(td, "gate-rise")
        self._teams(td, slug)
        first = self._game(td, slug, 1, "09:00")
        later = [self._game(td, slug, n, f"{8 + n}:00") for n in (2, 3, 4)]
        self._final_box(td, slug, first["id"], ab=3, ip="2.0")
        early = request(BASE, "GET", f"/api/event/{slug}/board")["leaders"]
        self.assertEqual(early["min_ab"], 2)
        self.assertIn("Maeve D #4", [r.get("name_key") for r in early["hitting"]])
        for game in later:
            request(BASE, "POST", f"/api/events/{slug}/schedule/{game['id']}/score", td, {
                "home_runs": 4,
                "away_runs": 1,
                "status": "final",
                "confirm": True,
            })
        late = request(BASE, "GET", f"/api/event/{slug}/board")["leaders"]
        self.assertEqual(late["games_played"], 4)
        self.assertEqual(late["min_ab"], 8)
        self.assertEqual(late["min_ip"], 3)
        self.assertNotIn("Maeve D #4", [r.get("name_key") for r in late["hitting"]])
        full = [r for r in late["full_hitting"] if (r.get("player") or r.get("name_key")) == "Maeve D #4"]
        self.assertTrue(full)
        self.assertFalse(full[0].get("q"))
        self.assertFalse(late["all_tournament"]["hitters"])

    def test_posted_ip_cap_marks_over(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = self._weekend(td, "gate-cap")
        request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "pitch_limit_mode": "ip",
            "pitch_limit_ip": 6,
        })
        self._teams(td, slug)
        game = self._game(td, slug, 1, "10:00")
        self._final_box(td, slug, game["id"], ab=3, ip="7.0")
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(board["event"]["pitch_limit_mode"], "ip")
        leaders = board["leaders"]
        self.assertTrue(leaders["has_pitch_ip_cap"])
        sam = next(r for r in leaders["pitch_counts"] if r.get("name_key") == "Sam P #7")
        self.assertTrue(sam["over"])
        self.assertEqual(sam["limit_ip"], 6)

    def test_keystone_keeps_packet_mins(self):
        board = request(BASE, "GET", "/api/event/keystone-clash-2026/board")
        self.assertEqual(board["leaders"]["min_ab"], 8)
        self.assertEqual(board["leaders"]["qualify_source"], "packet")
        self.assertEqual(board["event"]["pitch_limit_mode"], "ip")
        self.assertTrue(board["leaders"]["has_pitch_ip_cap"])


class EventBoxReviewTests(unittest.TestCase):
    """Director Approve/Reject for pending event_boxes. Bot cannot call review."""

    def _weekend_with_game(self, td):
        slug = "box-review-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Box Review",
            "slug": slug,
            "format": "pool-only",
            "fields": [{"name": "Main"}],
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Review Hawks",
            "pool": "A",
            "as_director": True,
        })
        request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": "Review Heat",
            "pool": "A",
            "as_director": True,
        })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-09-19"],
            "games_per_team": 1,
            "replace": True,
            "format": "pool-only",
        })
        return slug, auto["schedule"][0]["id"]

    def _bot_review_box(self, bot, slug, game_id, note="needs a look"):
        return request(BASE, "POST", "/api/bot/event-box", bot, {
            "event_slug": slug,
            "schedule_id": game_id,
            "status": "needs_review",
            "hitting": [{"side": "home", "jersey": "4", "name": "Maeve D", "ab": 3, "r": 1, "h": 2, "rbi": 1, "bb": 0, "so": 0}],
            "pitching": [{"side": "home", "jersey": "7", "name": "Sam P", "ip": "4.0", "h": 2, "r": 1, "er": 1, "bb": 0, "so": 4}],
            "parser_notes": note,
        })

    def _hitting_count(self, token, game_id):
        return request(
            BASE,
            "GET",
            f'/api/collections/event_hitting/records?perPage=50&filter=schedule_row="{game_id}"',
            token,
        )["totalItems"]

    def test_director_approves_and_rejects_pending_event_box(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        bot = auth(BASE, "bot@local.test", "BotStaging1!")
        slug, game_id = self._weekend_with_game(td)
        posted = self._bot_review_box(bot, slug, game_id)
        self.assertEqual(posted["box"]["status"], "needs_review")
        box_id = posted["box"]["id"]
        public = request(BASE, "GET", f"/api/event/{slug}/board")
        waiting = next(g for g in public["schedule"] if g["id"] == game_id)
        self.assertEqual(waiting["box_status"], "needs_review")
        self.assertTrue(waiting["has_box"])
        overall_wait = next(g for g in public["overall"] if g["id"] == game_id)
        self.assertEqual(overall_wait["box_status"], "needs_review")
        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        pending = next(b for b in plan.get("pending_boxes", []) if b["id"] == box_id)
        self.assertEqual(pending["hitting"][0]["name"], "Maeve D")
        self.assertEqual(pending["pitching"][0]["name"], "Sam P")
        self.assertEqual(int(pending["hitting"][0]["h"]), 2)
        hits_before = self._hitting_count(td, game_id)
        self.assertGreaterEqual(hits_before, 1)

        approved = request(BASE, "POST", f"/api/events/{slug}/boxes/{box_id}/review", td, {
            "status": "approved",
        })
        self.assertEqual(approved["box"]["status"], "approved")
        self.assertEqual(self._hitting_count(td, game_id), hits_before)
        after = request(BASE, "GET", f"/api/event/{slug}/board")
        done = next(g for g in after["schedule"] if g["id"] == game_id)
        self.assertEqual(done["box_status"], "approved")
        self.assertTrue(done["has_box"])
        plan2 = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        self.assertFalse(any(b["id"] == box_id for b in plan2.get("pending_boxes", [])))

        again = request(BASE, "POST", f"/api/events/{slug}/boxes/{box_id}/review", td, {
            "status": "approved",
        })
        self.assertTrue(again.get("already"))

        slug2, game2 = self._weekend_with_game(td)
        empty = request(BASE, "GET", f"/api/event/{slug2}/board")
        none = next(g for g in empty["schedule"] if g["id"] == game2)
        self.assertEqual(none.get("box_status") or "", "")
        self.assertFalse(none["has_box"])
        posted2 = self._bot_review_box(bot, slug2, game2, "alignment messy")
        reject_id = posted2["box"]["id"]
        hits2 = self._hitting_count(td, game2)
        rejected = request(BASE, "POST", f"/api/events/{slug2}/boxes/{reject_id}/review", td, {
            "status": "rejected",
        })
        self.assertEqual(rejected["box"]["status"], "rejected")
        self.assertEqual(self._hitting_count(td, game2), hits2)
        plan3 = request(BASE, "GET", f"/api/events/{slug2}/plan", td)
        self.assertFalse(any(b["id"] == reject_id for b in plan3.get("pending_boxes", [])))

        slug3, game3 = self._weekend_with_game(td)
        queued = request(BASE, "POST", f"/api/events/{slug3}/schedule/{game3}/box", td, {
            "source": "gc_url",
            "gc_url": (
                "https://web.gc.com/teams/Qgojbuf369Eu/"
                "2027-spring-lady-dukes-wpa-2033/schedule/"
                "d1ed080a-d4da-42a2-9dfb-1813c9272d5f/box-score"
            ),
            "status": "queued",
        })
        self.assertEqual(queued["box"]["status"], "queued")
        qok = request(BASE, "POST", f"/api/events/{slug3}/boxes/{queued['box']['id']}/review", td, {
            "status": "approved",
        })
        self.assertEqual(qok["box"]["status"], "approved")

        owner = auth(BASE, "owner@local.test", "RegionAdmin1!")
        slug4, game4 = self._weekend_with_game(td)
        posted4 = self._bot_review_box(bot, slug4, game4)
        site = request(BASE, "POST", f"/api/events/{slug4}/boxes/{posted4['box']['id']}/review", owner, {
            "status": "approved",
        })
        self.assertEqual(site["box"]["status"], "approved")

    def test_bot_and_stranger_cannot_review_event_box(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        bot = auth(BASE, "bot@local.test", "BotStaging1!")
        slug, game_id = self._weekend_with_game(td)
        posted = self._bot_review_box(bot, slug, game_id)
        box_id = posted["box"]["id"]
        path = f"/api/events/{slug}/boxes/{box_id}/review"
        with self.assertRaises(RuntimeError) as caught:
            request(BASE, "POST", path, bot, {"status": "approved"})
        self.assertIn("403", str(caught.exception))
        self.assertIn("bot cannot", str(caught.exception).lower())

        email = f"stranger.{uuid.uuid4().hex[:8]}@nowhere.test"
        request(BASE, "POST", "/api/account/register", None, {
            "email": email,
            "password": "Stranger99!",
            "display_name": "Stranger",
            "intent": "director",
        })
        stranger = auth(BASE, email, "Stranger99!")
        with self.assertRaises(RuntimeError) as caught2:
            request(BASE, "POST", path, stranger, {"status": "rejected"})
        self.assertIn("403", str(caught2.exception))

        still = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        self.assertTrue(any(
            b["id"] == box_id and b["status"] == "needs_review"
            for b in still.get("pending_boxes", [])
        ))

        main = (ROOT / "pb/pb_hooks/main.pb.js").read_text()
        self.assertIn('routerAdd("POST", "/api/coach/staging/{id}/decision"', main)


class PressureBotTests(unittest.TestCase):
    """Two live bot processes hit season + tournament doors together."""

    def test_pressure_script_exists_and_event_update_upserts(self):
        src = (ROOT / "scripts/pressure_test_bots.py").read_text()
        self.assertIn("bot_a_worker", src)
        self.assertIn("bot_c_worker", src)
        self.assertIn("/api/bot/event-update", src)
        hooks = (ROOT / "pb/pb_hooks/score.js").read_text()
        self.assertIn("function attachUpdateBox", hooks)
        main = (ROOT / "pb/pb_hooks/main.pb.js").read_text()
        self.assertIn("score.attachUpdateBox", main)
        self.assertNotIn("new Record(e.app.findCollectionByNameOrId(\"event_boxes\"))", main)

    def test_two_bots_pressure_weekend(self):
        from scripts.pressure_test_bots import main as pressure_main
        self.assertEqual(pressure_main(), 0)


class FlexibleBracketTests(unittest.TestCase):
    """Director-authored flights, byes that are not games, seed/winner seats."""

    def test_brackets_js_pairings_and_no_even_split(self):
        import subprocess
        out = subprocess.check_output(
            ["node", str(ROOT / "scripts/test_brackets.mjs")],
            text=True,
        )
        self.assertIn("brackets.js ok", out)

    def test_eventjson_returns_bracket_plan(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "plan-audit-" + uuid.uuid4().hex[:8]
        created = request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Plan Audit Classic",
            "slug": slug,
            "venue": "Harbor",
            "ages": "10U",
        })
        self.assertEqual(created["event"]["bracket_flights"], "none")
        created_flights = (created["event"].get("bracket_plan") or {}).get("flights") or []
        self.assertEqual(len(created_flights), 1)
        saved = request(BASE, "POST", f"/api/events/{slug}/settings", td, {
            "bracket_plan": {
                "flights": [
                    {"name": "Championship", "size": 8, "fields": ["Field 1"]},
                    {"name": "Consolation", "size": 6, "fields": ["Field 2"]},
                ],
            },
        })
        self.assertEqual(saved["event"]["bracket_flights"], "custom")
        names = [f["name"] for f in saved["event"]["bracket_plan"]["flights"]]
        self.assertEqual(names, ["Championship", "Consolation"])
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual([f["name"] for f in board["event"]["bracket_plan"]["flights"]], names)
        plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        self.assertEqual(plan["event"]["bracket_plan"]["flights"][0]["size"], 8)

    def test_custom_builder_accepts_seed_and_winner_refs(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "refs-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Ref Bracket Classic",
            "slug": slug,
            "format": "single-elim",
        })
        out = request(BASE, "POST", f"/api/events/{slug}/bracket/custom", td, {
            "games": [
                {
                    "flight": "gold",
                    "game_id": "G1",
                    "round": "QF",
                    "slot": 1,
                    "side": "championship",
                    "home_ref": "seed:2",
                    "away_ref": "seed:7",
                },
                {
                    "flight": "gold",
                    "game_id": "G5",
                    "round": "SF",
                    "slot": 1,
                    "side": "championship",
                    "home_ref": "winner:G1",
                    "away_ref": "loser:G1",
                },
            ],
        })
        self.assertEqual(out["mode"], "custom")
        self.assertEqual(len(out["bracket"]), 2)
        qf = next(g for g in out["bracket"] if g.get("game_id") == "G1")
        sf = next(g for g in out["bracket"] if g.get("game_id") == "G5")
        self.assertIn(qf["home"], ("2nd", "2nd (gold)", "Seed 2"))
        self.assertIn("7", qf["away"])
        self.assertTrue(sf["home"].startswith("W") or "winner" in sf["home"].lower() or sf["home"] == "WG1")
        self.assertFalse(qf.get("home_id"))
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        self.assertEqual(len(board["bracket"]), 2)

    def test_scarecrow_shape_without_hardcoding_and_byes_are_not_games(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "flex-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Flexible Classic",
            "slug": slug,
            "format": "single-elim",
            "start": "2026-10-11",
            "end": "2026-10-11",
            "hours_start": "09:30",
            "fields": [
                {"name": "Field 6"},
                {"name": "Field 1"},
                {"name": "Field 2"},
                {"name": "Field 4"},
            ],
        })
        for i in range(14):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": f"Flex {i + 1:02d}",
                "pool": "A",
                "as_director": True,
            })
        plan = {
            "flights": [
                {
                    "id": "gold",
                    "name": "Gold",
                    "size": 8,
                    "format": "single-elim",
                    "pairing": "high-low",
                    "fields": ["Field 6", "Field 1"],
                    "start_time": "09:30",
                    "slot_minutes": 90,
                    "later_slot_for_top_seeds": True,
                },
                {
                    "id": "silver",
                    "name": "Silver",
                    "size": 6,
                    "format": "single-elim",
                    "pairing": "high-low",
                    "fields": ["Field 2", "Field 4"],
                    "start_time": "09:30",
                    "slot_minutes": 90,
                    "later_slot_for_top_seeds": True,
                },
            ],
        }
        preview = request(BASE, "POST", f"/api/events/{slug}/bracket/preview", td, {
            "empty": True,
            "format": "single-elim",
            "bracket_plan": plan,
            "consolation": False,
        })
        self.assertTrue(preview.get("preview"))
        self.assertGreaterEqual(preview["games"], 10)
        self.assertEqual(len(preview.get("byes") or []), 2)
        drawn = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "empty": True,
            "replace": True,
            "format": "single-elim",
            "bracket_plan": plan,
            "consolation": False,
        })
        self.assertFalse(drawn.get("preview"))
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        playable = [g for g in board["bracket"] if g.get("status") != "bye"]
        byes = [g for g in board["bracket"] if g.get("status") == "bye"]
        self.assertEqual(len(byes), 2)
        for bye in byes:
            self.assertFalse(bye.get("field"))
            self.assertFalse(bye.get("time"))
            self.assertFalse(bye.get("game_number"))
            self.assertEqual(bye.get("away"), "Bye")
        overall = board.get("overall") or []
        self.assertFalse(any(g.get("status") == "bye" for g in overall))
        gold = [g for g in playable if g.get("flight") == "gold"]
        silver = [g for g in playable if g.get("flight") == "silver"]
        self.assertTrue(gold)
        self.assertTrue(silver)
        gold_ids = {g.get("game_id") for g in gold if g.get("game_id")}
        silver_ids = {g.get("game_id") for g in silver if g.get("game_id")}
        self.assertIn("G1", gold_ids)
        self.assertIn("G1", silver_ids)
        gold_qf = [g for g in gold if g.get("round") == "QF"]
        times = {g.get("time") for g in gold_qf}
        self.assertIn("09:30", times)
        self.assertIn("11:00", times)
        gold_fields = {g.get("field") for g in gold_qf}
        self.assertTrue(gold_fields <= {"Field 6", "Field 1"})
        silver_fields = {g.get("field") for g in silver if g.get("field")}
        self.assertTrue(silver_fields <= {"Field 2", "Field 4"})

    def test_keystone_shape_one_flight_double_elim(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "one-de-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "One Flight DE",
            "slug": slug,
            "format": "double-elim",
            "fields": [{"name": "Diamond 1"}, {"name": "Diamond 2"}],
        })
        for name in ("Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name, "as_director": True,
            })
        drawn = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "empty": True,
            "replace": True,
            "format": "double-elim",
            "bracket_plan": {
                "flights": [{
                    "name": "Main",
                    "size": 8,
                    "format": "double-elim",
                    "if_necessary": True,
                }],
            },
        })
        self.assertEqual(drawn["games"], 14)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        rounds = {g["round"] for g in board["bracket"] if g.get("status") != "bye"}
        self.assertIn("QF", rounds)
        self.assertIn("LF", rounds)
        self.assertIn("IFN", rounds)

    def test_pool_finish_split_and_director_byes(self):
        td = auth(BASE, "td@local.test", "EventTd1!")
        slug = "pool-split-" + uuid.uuid4().hex[:8]
        request(BASE, "POST", "/api/events/create", td, {
            "source": "native",
            "name": "Pool Finish Classic",
            "slug": slug,
            "format": "pool-to-bracket",
            "start": "2026-10-17",
            "end": "2026-10-18",
            "fields": [{"name": "North"}, {"name": "South"}],
        })
        names = [f"Place {n}" for n in ("Ace", "Bay", "Cove", "Dale", "Echo", "Fern", "Gale", "Hill")]
        for i, name in enumerate(names):
            request(BASE, "POST", f"/api/events/{slug}/signup", td, {
                "team_name": name,
                "pool": "A" if i < 4 else "B",
                "as_director": True,
            })
        auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
            "days": ["2026-10-17"],
            "games_per_team": 1,
            "replace": True,
            "format": "pool-to-bracket",
        })
        for game in auto["schedule"]:
            home_win = game["home"] in ("Place Ace", "Place Bay", "Place Echo", "Place Fern")
            request(BASE, "POST", f"/api/events/{slug}/schedule/{game['id']}/score", td, {
                "home_runs": 8 if home_win else 1,
                "away_runs": 1 if home_win else 8,
                "status": "final",
                "confirm": True,
            })
        drawn = request(BASE, "POST", f"/api/events/{slug}/bracket/build", td, {
            "replace": True,
            "format": "pool-to-bracket",
            "consolation": False,
            "confirm": True,
            "bracket_plan": {
                "flights": [
                    {
                        "name": "Upper",
                        "pool_place_from": 1,
                        "pool_place_to": 2,
                        "format": "single-elim",
                    },
                    {
                        "name": "Lower",
                        "pool_place_from": 3,
                        "pool_place_to": 4,
                        "format": "single-elim",
                    },
                ],
            },
        })
        flights = {row["name"]: row for row in drawn.get("flights") or []}
        self.assertEqual(flights["Upper"]["seeds"], 4)
        self.assertEqual(flights["Lower"]["seeds"], 4)
        board = request(BASE, "GET", f"/api/event/{slug}/board")
        labels = {g.get("flight") for g in board["bracket"] if g.get("status") != "bye"}
        self.assertEqual(labels, {"upper", "lower"})
        saved = request(BASE, "GET", f"/api/events/{slug}/plan", td)
        plan = saved["event"]["bracket_plan"]["flights"]
        self.assertEqual(plan[0]["pool_place_from"], 1)
        self.assertEqual(plan[1]["pool_place_to"], 4)


if __name__ == "__main__":
    unittest.main()
