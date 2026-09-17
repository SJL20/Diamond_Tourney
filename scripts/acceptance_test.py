#!/usr/bin/env python3
"""Outline §15 acceptance tests plus metric formulas."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from lib.metrics import batting_average, era, ip_display_to_outs, outs_to_ip_display
from scripts.bot_a_ingest import ingest, parse_box
from scripts.pb_client import auth, request

BASE = "http://127.0.0.1:8097"


def fail(msg):
    print("FAIL:", msg)
    raise SystemExit(1)


def ok(msg):
    print("OK  ", msg)


def decide(token, staging_id, decision):
    return request(BASE, "POST", f"/api/coach/staging/{staging_id}/decision", token, {"decision": decision})


def hitting_for(token, team_id):
    return request(
        BASE,
        "GET",
        f'/api/collections/hitting_game/records?perPage=200&filter=game.team="{team_id}"%20%26%26%20game.status="approved"&expand=player,game',
        token,
    )["items"]


def games_for(token, team_id):
    return request(
        BASE,
        "GET",
        f'/api/collections/team_games/records?perPage=200&filter=team="{team_id}"%20%26%26%20status="approved"',
        token,
    )["items"]


def pitching_for(token, team_id):
    return request(
        BASE,
        "GET",
        f'/api/collections/pitching_game/records?perPage=200&filter=game.team="{team_id}"%20%26%26%20game.status="approved"&expand=player',
        token,
    )["items"]


def team(token, slug):
    return request(BASE, "GET", f'/api/collections/teams/records?filter=slug="{slug}"', token)["items"][0]


def main():
    if ip_display_to_outs("2.1") + ip_display_to_outs("1.2") != ip_display_to_outs("4.0"):
        fail("IP 2.1 + 1.2 must be 4.0")
    if outs_to_ip_display(12) != "4.0":
        fail("12 outs must display as 4.0")
    if batting_average(5, 16) != ".312":
        fail("BA 5/16 must be .312")
    if era(2, 12) != "3.50":
        fail("ERA (2 ER in 4.0 IP) must be 3.50")
    ok("metric formulas")

    health = request(BASE, "GET", "/api/health")
    if not health.get("ok"):
        fail("health check")
    ok("health")

    bot = auth(BASE, "bot@local.test", "BotStaging1!")
    hawks_coach = auth(BASE, "coach.hawks@local.test", "CoachHawks1!")
    rivals_coach = auth(BASE, "coach.rivals@local.test", "CoachRivals1!")
    hawks = team(hawks_coach, "hawks-10u")

    boxes = [
        ROOT / "testdata" / "hawks_game1.txt",
        ROOT / "testdata" / "hawks_game2.txt",
        ROOT / "testdata" / "hawks_game3.txt",
    ]
    staged = []
    for path in boxes:
        out = ingest(BASE, "bot@local.test", "BotStaging1!", "hawks-10u", path.read_text())
        staged.append(out)
        if out.get("status") == "approved":
            fail("Bot A approved its own work")
    ok("Bot A staged 3 games and did not approve")

    # Approve game 1 and 2
    decide(hawks_coach, staged[0]["id"], "approve")
    decide(hawks_coach, staged[1]["id"], "approve")
    ok("coach approved two games")

    # Same player (Evelynn M #17) appears in different lineup slots
    hits = hitting_for(hawks_coach, hawks["id"])
    evelynn = [h for h in hits if h.get("expand", {}).get("player", {}).get("name_key") == "Evelynn M #17"]
    if len({h["expand"]["game"]["id"] for h in evelynn}) < 2:
        fail("Evelynn should have hitting lines in two games")
    ab = sum(h["ab"] for h in evelynn)
    h = sum(h["h"] for h in evelynn)
    if ab != 6 or h != 3:
        fail(f"Evelynn season should be 3-for-6, got {h}/{ab}")
    ok("same player different lineup slots rolls to one season row")

    pits = pitching_for(hawks_coach, hawks["id"])
    ava = [p for p in pits if p.get("expand", {}).get("player", {}).get("name_key") == "Ava B #8"]
    outs = sum(p["ip_outs"] for p in ava)
    if outs != 12 or outs_to_ip_display(outs) != "4.0":
        fail(f"Ava IP should be 4.0 from 2.1 + 1.2, got {outs_to_ip_display(outs)} ({outs} outs)")
    ok("IP 2.1 + 1.2 = 4.0")

    games_before = games_for(hawks_coach, hawks["id"])
    ba_before = batting_average(h, ab)
    wl_before = (hawks := team(hawks_coach, "hawks-10u"), hawks["public_record_wins"], hawks["public_record_losses"])[1:]

    decide(hawks_coach, staged[2]["id"], "reject")
    hawks = team(hawks_coach, "hawks-10u")
    hits_after = hitting_for(hawks_coach, hawks["id"])
    evelynn_after = [x for x in hits_after if x.get("expand", {}).get("player", {}).get("name_key") == "Evelynn M #17"]
    ba_after = batting_average(sum(x["h"] for x in evelynn_after), sum(x["ab"] for x in evelynn_after))
    if ba_after != ba_before:
        fail("rejected game changed BA")
    if (hawks["public_record_wins"], hawks["public_record_losses"]) != wl_before:
        fail("rejected game changed W-L")
    if len(games_for(hawks_coach, hawks["id"])) != len(games_before):
        fail("rejected game created a live team_games row")
    ok("rejected game does not change BA or W-L")

    # Approve game 1 a second time — should not double-count
    again = decide(hawks_coach, staged[0]["id"], "approve")
    if not again.get("already") and not again.get("dedup"):
        # still must not create a second live row
        pass
    games_now = games_for(hawks_coach, hawks["id"])
    if len(games_now) != len(games_before):
        fail("approving twice double-counted the game")
    hits_now = hitting_for(hawks_coach, hawks["id"])
    e2 = [x for x in hits_now if x.get("expand", {}).get("player", {}).get("name_key") == "Evelynn M #17"]
    if sum(x["ab"] for x in e2) != 6:
        fail("double approve changed season AB")
    ok("approving twice does not double-count")

    # Public visitor cannot open hitting
    try:
        request(BASE, "GET", f'/api/collections/hitting_game/records?filter=game.team="{hawks["id"]}"')
        fail("public visitor listed hitting")
    except RuntimeError as exc:
        if "403" not in str(exc) and "401" not in str(exc):
            fail("public hitting should be 401/403, got " + str(exc))
    ok("public visitor cannot open hitting")

    # Team B coach cannot see team A book
    try:
        request(
            BASE,
            "GET",
            f'/api/collections/hitting_game/records?filter=game.team="{hawks["id"]}"',
            rivals_coach,
        )
        fail("rivals coach listed hawks hitting")
    except RuntimeError as exc:
        if "403" not in str(exc):
            fail("rivals hitting access should be 403, got " + str(exc))
    ok("team_coach A cannot see team B book")

    # Bot cannot approve via collection update
    try:
        request(
            BASE,
            "PATCH",
            f"/api/collections/staging_games/records/{staged[2]['id']}",
            bot,
            {"status": "approved"},
        )
        fail("bot updated staging status")
    except RuntimeError as exc:
        if "403" not in str(exc):
            fail("bot staging update should be 403")
    ok("bot cannot approve its own work")

    published = request(BASE, "POST", "/api/bot/publish", bot, {"team_slug": "hawks-10u"})
    if published["record"]["wins"] != 2 or published["record"]["losses"] != 0:
        fail(f"expected 2-0 after two wins, got {published['record']}")
    if not published.get("recap") or published["recap"].get("public"):
        fail("recap must exist and stay unpublished")
    ok("Bot B rebuilt 2-0 and drafted unpublished recap")

    print("\nAll acceptance tests passed.")


if __name__ == "__main__":
    main()
