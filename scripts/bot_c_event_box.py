#!/usr/bin/env python3
"""Bot C — list queued tournament boxes and POST extracted lines.

This host does not scrape GameChanger. A coach or director stores a public
box URL or PDF. A Grok bot (or a person) reads that source and uploads JSON.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.pb_client import auth, request


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://127.0.0.1:8097")
    p.add_argument("--email", default="bot@local.test")
    p.add_argument("--password", default="BotStaging1!")
    p.add_argument("--list", action="store_true", help="print queued PDFs and GC box URLs")
    p.add_argument("--event", help="event slug")
    p.add_argument("--game", help="event_schedule id")
    p.add_argument("--url", help="public GameChanger box-score URL to attach")
    p.add_argument("--home-runs", type=int, dest="home_runs")
    p.add_argument("--away-runs", type=int, dest="away_runs")
    p.add_argument("--json", dest="json_path", help="file with hitting/pitching arrays")
    p.add_argument("--note", default="Bot C extracted lines. Not scraped by the host.")
    p.add_argument("--review", action="store_true", help="leave status needs_review instead of approved")
    args = p.parse_args()
    token = auth(args.base, args.email, args.password)
    if args.list:
        path = "/api/bot/event-boxes"
        if args.event:
            path += "?event=" + args.event
        print(json.dumps(request(args.base, "GET", path, token), indent=2))
        return
    if not args.event or not args.game:
        p.error("--event and --game are required unless --list")
    payload = {
        "event_slug": args.event,
        "schedule_id": args.game,
        "note": args.note,
        "apply": not args.review,
        "status": "needs_review" if args.review else "approved",
        "source": "bot",
    }
    if args.url:
        payload["gc_url"] = args.url
    if args.home_runs is not None:
        payload["home_runs"] = args.home_runs
    if args.away_runs is not None:
        payload["away_runs"] = args.away_runs
    if args.json_path:
        extra = json.loads(Path(args.json_path).read_text())
        payload.update(extra)
    print(json.dumps(request(args.base, "POST", "/api/bot/event-box", token, payload), indent=2))


if __name__ == "__main__":
    main()
