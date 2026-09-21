#!/usr/bin/env python3
"""Pressure-test Diamond Tourney with two live bot workers.

Bot A (season) and Bot C (tournament) run as separate processes against a
fresh weekend plus the Hawks season book. They post only fixture numbers —
nothing invented. After they finish, a director clears the inbox and the
script checks public boards, privacy, and that bots never self-approved.

  python3 scripts/pressure_test_bots.py
"""

from __future__ import annotations

import json
import os
import sys
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from multiprocessing import Process, Queue
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.bot_a_ingest import ingest
from scripts.pb_client import auth, request

BASE = os.environ.get("PB_URL") or f"http://127.0.0.1:{os.environ.get('PB_PORT', '8097')}"
GC_BOX = (
    "https://web.gc.com/teams/Qgojbuf369Eu/"
    "2027-spring-lady-dukes-wpa-2033/schedule/"
    "d1ed080a-d4da-42a2-9dfb-1813c9272d5f/box-score"
)
GC_TEAM = "https://web.gc.com/team/Qgojbuf369Eu/2027-spring-lady-dukes-wpa-2033"


def _fail(q: Queue, name: str, msg: str) -> None:
    q.put({"worker": name, "ok": False, "error": msg})


def _ok(q: Queue, name: str, extra: dict | None = None) -> None:
    row = {"worker": name, "ok": True}
    if extra:
        row.update(extra)
    q.put(row)


def _denied(base: str, token: str, method: str, path: str, body=None, codes=("403", "401", "404")) -> str:
    try:
        request(base, method, path, token, body)
    except RuntimeError as exc:
        text = str(exc)
        if any(c in text for c in codes):
            return text
        raise RuntimeError(f"expected {codes} for {method} {path}, got {text}") from exc
    raise RuntimeError(f"{method} {path} succeeded but should have been denied")


def _lines(tag: str) -> tuple[list, list]:
    hitting = [{
        "side": "home", "jersey": "4", "name": "Maeve D",
        "ab": 3, "r": 1, "h": 2, "rbi": 1, "bb": 0, "so": 0,
    }]
    pitching = [{
        "side": "home", "jersey": "7", "name": "Sam P",
        "ip": "4.0", "h": 2, "r": 1, "er": 1, "bb": 0, "so": 4,
    }]
    hitting[0]["note"] = tag
    return hitting, pitching


def bot_a_worker(base: str, q: Queue, stamp: str) -> None:
    name = "bot-a"
    try:
        bot = auth(base, "bot@local.test", "BotStaging1!")
        boxes = [
            ROOT / "testdata" / "hawks_game1.txt",
            ROOT / "testdata" / "hawks_game2.txt",
            ROOT / "testdata" / "hawks_game3.txt",
        ]
        staged = []
        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = {
                pool.submit(ingest, base, "bot@local.test", "BotStaging1!", "hawks-10u", p.read_text()): p.name
                for p in boxes
            }
            for fut in as_completed(futs):
                out = fut.result()
                if out.get("status") == "approved":
                    raise RuntimeError(f"Bot A approved its own ingest {futs[fut]}")
                staged.append(out)

        watch = request(base, "GET", "/api/bot/gc-monitor", bot)
        if "watch" not in watch and "policy" not in watch:
            raise RuntimeError("gc-monitor missing watch/policy")

        published = request(base, "POST", "/api/bot/publish", bot, {"team_slug": "hawks-10u"})
        if published.get("recap") and published["recap"].get("public") is True:
            raise RuntimeError("Bot B recap published itself")

        if staged:
            _denied(base, bot, "POST", f"/api/coach/staging/{staged[0]['id']}/decision", {"decision": "approve"})
            try:
                request(base, "PATCH", f"/api/collections/staging_games/records/{staged[0]['id']}", bot, {
                    "status": "approved",
                })
                raise RuntimeError("bot PATCHed staging to approved")
            except RuntimeError as exc:
                if "bot PATCHed" in str(exc):
                    raise
                if "403" not in str(exc) and "404" not in str(exc):
                    raise RuntimeError("staging PATCH should be 403/404: " + str(exc)) from exc

        coach = auth(base, "coach.hawks@local.test", "CoachHawks1!")
        _denied(base, coach, "GET", "/api/bot/gc-monitor")
        _denied(base, None, "GET", "/api/bot/gc-monitor", codes=("401", "403"))

        _ok(q, name, {
            "staged": [s.get("id") for s in staged],
            "gc_watch": len(watch.get("watch") or []),
            "publish_record": published.get("record"),
            "stamp": stamp,
        })
    except Exception as exc:
        _fail(q, name, f"{exc}\n{traceback.format_exc()}")


def bot_c_worker(base: str, q: Queue, slug: str, games: list[str]) -> None:
    name = "bot-c"
    try:
        bot = auth(base, "bot@local.test", "BotStaging1!")
        inbox = request(base, "GET", f"/api/bot/event-boxes?event={slug}", bot)
        if "boxes" not in inbox:
            raise RuntimeError("event-boxes list missing boxes")

        review_target = games[0]
        score_target = games[1] if len(games) > 1 else games[0]
        upsert_target = games[2] if len(games) > 2 else games[0]

        hitting, pitching = _lines("pressure-review")
        reviewed = request(base, "POST", "/api/bot/event-box", bot, {
            "event_slug": slug,
            "schedule_id": review_target,
            "status": "needs_review",
            "gc_url": GC_BOX,
            "home_runs": 7,
            "away_runs": 2,
            "hitting": hitting,
            "pitching": pitching,
            "parser_notes": "Read from the public box the coach pasted.",
        })
        if reviewed["box"]["status"] != "needs_review":
            raise RuntimeError("needs_review post landed as " + str(reviewed["box"]["status"]))

        _denied(base, bot, "POST", f"/api/events/{slug}/boxes/{reviewed['box']['id']}/review", {
            "status": "approved",
        })

        def post_score(i: int):
            return request(base, "POST", "/api/bot/event-update", bot, {
                "event_slug": slug,
                "schedule_id": score_target,
                "home_runs": 5,
                "away_runs": 3,
                "status": "final",
            })

        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(post_score, range(4)))

        def post_box(i: int):
            h, p = _lines(f"upsert-{i}")
            return request(base, "POST", "/api/bot/event-box", bot, {
                "event_slug": slug,
                "schedule_id": upsert_target,
                "status": "approved",
                "hitting": h,
                "pitching": p,
                "home_runs": 4,
                "away_runs": 1,
            })

        with ThreadPoolExecutor(max_workers=6) as pool:
            boxes = list(pool.map(post_box, range(6)))
        if any(b["box"]["status"] != "approved" for b in boxes):
            raise RuntimeError("concurrent event-box did not stay approved")

        update_game = games[3] if len(games) > 3 else score_target
        h, p = _lines("event-update-box")
        for _ in range(2):
            request(base, "POST", "/api/bot/event-update", bot, {
                "event_slug": slug,
                "schedule_id": update_game,
                "home_runs": 8,
                "away_runs": 4,
                "status": "final",
                "box": {
                    "hitting": h,
                    "pitching": p,
                    "source": "gc",
                    "status": "needs_review",
                    "note": "score-only door plus lines",
                },
            })

        for gid in games[4:]:
            h, p = _lines("batch")
            request(base, "POST", "/api/bot/event-box", bot, {
                "event_slug": slug,
                "schedule_id": gid,
                "status": "needs_review",
                "hitting": h,
                "pitching": p,
                "home_runs": 6,
                "away_runs": 5,
            })

        watch = request(base, "GET", "/api/bot/gc-monitor", bot)
        inbox2 = request(base, "GET", f"/api/bot/event-boxes?event={slug}", bot)
        pending = [b for b in inbox2.get("boxes") or [] if b.get("status") == "needs_review"]
        if not any(b.get("id") == reviewed["box"]["id"] for b in pending):
            raise RuntimeError("needs_review box vanished from bot inbox")

        _denied(base, bot, "POST", f"/api/events/{slug}/settings", {"venue": "BOT WAS HERE"})
        _denied(base, bot, "POST", f"/api/events/{slug}/rain", {
            "rain_status": "delay", "rain_note": "bot rain",
        })

        _ok(q, name, {
            "review_box": reviewed["box"]["id"],
            "review_game": review_target,
            "upsert_game": upsert_target,
            "score_game": score_target,
            "update_box_game": update_game,
            "pending": len(pending),
            "gc_watch": len(watch.get("watch") or []),
        })
    except Exception as exc:
        _fail(q, name, f"{exc}\n{traceback.format_exc()}")


def setup_weekend(td: str) -> dict:
    slug = "pressure-" + uuid.uuid4().hex[:8]
    request(BASE, "POST", "/api/events/create", td, {
        "source": "native",
        "name": "Pressure Test",
        "slug": slug,
        "format": "pool-only",
        "venue": "Harbor",
        "ages": "10U",
        "start": "2026-11-07",
        "end": "2026-11-08",
        "hours_start": "08:00",
        "hours_end": "18:00",
        "fields": [{"name": "Main"}, {"name": "Turf"}],
        "pitch_limit_mode": "none",
    })
    names = [
        ("Pressure Oaks FAKE", "oaks@local.test"),
        ("Pressure River FAKE", "river@local.test"),
        ("Pressure Maple FAKE", "maple@local.test"),
        ("Pressure Lake FAKE", "lake@local.test"),
    ]
    teams = []
    for name, email in names:
        teams.append(request(BASE, "POST", f"/api/events/{slug}/signup", td, {
            "team_name": name,
            "pool": "A",
            "contact_email": email,
            "coach_email": email,
            "coach_phone": "412-555-0199",
            "gamechanger_url": GC_TEAM,
            "as_director": True,
        })["team"])
    auto = request(BASE, "POST", f"/api/events/{slug}/schedule/auto", td, {
        "days": ["2026-11-07"],
        "games_per_team": 2,
        "replace": True,
        "format": "pool-only",
    })
    games = [g["id"] for g in auto.get("schedule") or []]
    if len(games) < 3:
        raise RuntimeError(f"expected at least 3 games, got {len(games)}")
    return {"slug": slug, "games": games, "teams": teams}


def director_and_public(td: str, slug: str, bot_c: dict) -> dict:
    notes = []
    plan = request(BASE, "GET", f"/api/events/{slug}/plan", td)
    pending = plan.get("pending_boxes") or []
    review_id = bot_c["review_box"]
    if not any(b.get("id") == review_id for b in pending):
        raise RuntimeError("director plan missing needs_review box")

    approved = request(BASE, "POST", f"/api/events/{slug}/boxes/{review_id}/review", td, {
        "status": "approved",
    })
    if approved["box"]["status"] != "approved":
        raise RuntimeError("director approve failed")

    leftovers = [b for b in (request(BASE, "GET", f"/api/events/{slug}/plan", td).get("pending_boxes") or [])]
    rejected = 0
    for box in leftovers:
        request(BASE, "POST", f"/api/events/{slug}/boxes/{box['id']}/review", td, {"status": "rejected"})
        rejected += 1
    after = request(BASE, "GET", f"/api/events/{slug}/plan", td).get("pending_boxes") or []
    if after:
        raise RuntimeError("inbox still has " + str([(b.get("id"), b.get("status")) for b in after]))

    board = request(BASE, "GET", f"/api/event/{slug}/board")
    if board["event"].get("venue") == "BOT WAS HERE":
        raise RuntimeError("bot changed venue")
    dump = json.dumps(board)
    if "412-555-0199" in dump or "oaks@local.test" in dump:
        raise RuntimeError("public board leaked coach contact")
    leaders = board.get("leaders") or {}
    if leaders.get("has_pitch_ip_cap"):
        raise RuntimeError("no-cap weekend reported an IP cap")
    if any(r.get("over") for r in (leaders.get("pitch_counts") or [])):
        raise RuntimeError("over badge without an IP cap")

    scored = next((g for g in board.get("schedule") or [] if g.get("id") == bot_c["score_game"]), None)
    if not scored or scored.get("home_runs") in (None, ""):
        raise RuntimeError("event-update score missing on public board")

    team = (plan.get("teams") or board.get("teams") or [None])[0]
    team_slug = (team or {}).get("slug")
    if team_slug:
        page = request(BASE, "GET", f"/api/event/{slug}/team/{team_slug}")
        if "412-555-0199" in json.dumps(page) or "oaks@local.test" in json.dumps(page):
            raise RuntimeError("public team page leaked coach contact")

    found = request(BASE, "GET", f"/api/events/search?q={quote(slug)}")
    rows = found.get("events") or found.get("items") or found
    if isinstance(rows, dict):
        rows = rows.get("events") or []
    if not any((e.get("slug") if isinstance(e, dict) else None) == slug for e in (rows or [])):
        notes.append("search did not list the new slug in the first page (may be capped)")

    year = request(BASE, "GET", "/api/year/2026/board")
    if not year:
        raise RuntimeError("year board empty")

    harbor = request(BASE, "GET", "/api/event/harbor-eight/board")
    if harbor["event"]["slug"] != "harbor-eight":
        raise RuntimeError("harbor-eight board missing")

    page_html = urlopen(Request(BASE.rstrip("/") + f"/t/{slug}"), timeout=15).read().decode("utf-8", "replace")
    if "Diamond" not in page_html and "softball" not in page_html.lower() and "<!doctype" not in page_html.lower():
        notes.append("public /t/{slug} did not look like the SPA shell")

    hits = request(
        BASE, "GET",
        f'/api/collections/event_hitting/records?perPage=50&filter=schedule_row="{bot_c["upsert_game"]}"',
        td,
    )
    if hits.get("totalItems", 0) != 1:
        raise RuntimeError(
            f"concurrent event-box upsert should leave 1 hitting row, got {hits.get('totalItems')}"
        )

    boxes = request(BASE, "GET", "/api/collections/event_boxes/records?perPage=200", td)
    update_game = bot_c.get("update_box_game")
    if update_game:
        same_game = [b for b in boxes.get("items") or [] if b.get("schedule_row") == update_game]
        if len(same_game) != 1:
            raise RuntimeError(
                f"event-update+box should upsert to 1 row, got {len(same_game)}"
            )

    for qname in ("fit", "lose_field", "behind"):
        assist = request(BASE, "GET", f"/api/events/{slug}/assist?q={qname}", td)
        if assist.get("write") or assist.get("wrote"):
            raise RuntimeError("assist wrote something")
        if not assist.get("math") and not assist.get("answer"):
            raise RuntimeError(f"assist {qname} returned no math/answer")

    desk = request(BASE, "GET", f"/api/events/{slug}/boxes/desk", td)
    if desk is None:
        raise RuntimeError("boxes desk empty")

    ran = request(BASE, "POST", f"/api/events/{slug}/boxes/run", td, {
        "now": "2026-11-07T20:00:00.000Z",
    })
    if ran.get("wrote_schedule"):
        raise RuntimeError("box mail cron wrote the schedule")

    for path in (f"/t/{slug}/standings", f"/t/{slug}/leaders", f"/t/{slug}/schedule", "/find", "/year/2026"):
        raw = urlopen(Request(BASE.rstrip("/") + path), timeout=15).read().decode("utf-8", "replace")
        if "<!doctype" not in raw.lower() and "<html" not in raw.lower():
            raise RuntimeError(path + " did not return HTML")

    return {
        "approved": 1,
        "rejected": rejected,
        "leaders_min_ab": leaders.get("min_ab"),
        "games_played": leaders.get("games_played"),
        "notes": notes,
    }


def main() -> int:
    print("Pressure test against", BASE)
    td = auth(BASE, "td@local.test", "EventTd1!")
    weekend = setup_weekend(td)
    slug = weekend["slug"]
    print("Weekend", slug, "games", len(weekend["games"]))

    stamp = uuid.uuid4().hex[:8]
    q: Queue = Queue()
    a = Process(target=bot_a_worker, args=(BASE, q, stamp), name="bot-a")
    c = Process(target=bot_c_worker, args=(BASE, q, slug, weekend["games"]), name="bot-c")
    a.start()
    c.start()
    a.join(timeout=60)
    c.join(timeout=60)
    if a.is_alive() or c.is_alive():
        if a.is_alive():
            a.terminate()
        if c.is_alive():
            c.terminate()
        print("FAIL  bot process hung")
        return 1

    reports = []
    while not q.empty():
        reports.append(q.get())
    by_name = {r["worker"]: r for r in reports}
    print(json.dumps(reports, indent=2, default=str))
    if not by_name.get("bot-a", {}).get("ok"):
        print("FAIL  Bot A", by_name.get("bot-a"))
        return 1
    if not by_name.get("bot-c", {}).get("ok"):
        print("FAIL  Bot C", by_name.get("bot-c"))
        return 1
    print("OK   Bot A and Bot C finished in parallel")

    import subprocess
    env = os.environ.copy()
    env["PB_URL"] = BASE
    listed = subprocess.check_output(
        [sys.executable, str(ROOT / "scripts/bot_c_event_box.py"), "--list", "--event", slug, "--base", BASE],
        env=env, text=True,
    )
    if '"boxes"' not in listed:
        print("FAIL  bot_c --list missing boxes")
        return 1
    monitor = subprocess.check_output(
        [sys.executable, str(ROOT / "scripts/bot_gc_monitor.py"), "--list", "--base", BASE],
        env=env, text=True,
    )
    if "watch" not in monitor and "policy" not in monitor:
        print("FAIL  bot_gc_monitor --list missing watch")
        return 1
    print("OK   bot CLI helpers listed inbox and GC watch")

    try:
        verify = director_and_public(td, slug, by_name["bot-c"])
    except Exception as exc:
        print("FAIL  director/public", exc)
        traceback.print_exc()
        return 1
    print("OK   director cleared inbox; public board/privacy hold")
    print(json.dumps({"event": slug, **verify}, indent=2))
    for note in verify.get("notes") or []:
        print("NOTE ", note)
    print("Pressure test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
