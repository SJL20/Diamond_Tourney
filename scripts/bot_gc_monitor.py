#!/usr/bin/env python3
"""List coach-supplied public GameChanger URLs for Bot A / Bot C.

Bots may open these public pages on a recurring poll (~5 minutes while an
event is live) and POST readable numbers through existing bot APIs:

  season book  → POST /api/bot/ingest          (staging; coach Approve)
  tournament   → POST /api/bot/event-box
                 or POST /api/bot/event-update

This helper does not invent stats. --check only reports HTTP reachability
and the public page title. Queued PDFs stay on GET /api/bot/event-boxes.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.pb_client import auth, request

GC_HOSTS = ("gc.com", "web.gc.com", "gamechanger.io")


class _TitleParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self._in_title = False
        self.title = ""

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and not self.title:
            self.title = data.strip()


def is_public_gc_url(url: str) -> bool:
    m = re.match(r"^https?://([^/?#]+)", url or "", re.I)
    if not m:
        return False
    host = m.group(1).lower()
    if host.startswith("www."):
        host = host[4:]
    return host in GC_HOSTS


def fetch_public_title(url: str, timeout: int = 12) -> dict:
    """HEAD/GET a coach-supplied public URL. No stat extraction."""
    if not is_public_gc_url(url):
        return {"url": url, "ok": False, "error": "not a public GameChanger host"}
    req = Request(
        url,
        method="GET",
        headers={"User-Agent": "DiamondTourney/1.0 (bot monitor; public page)"},
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read(64_000)
            status = resp.status
    except HTTPError as exc:
        return {"url": url, "ok": False, "status": exc.code, "error": str(exc.reason)}
    except URLError as exc:
        return {"url": url, "ok": False, "error": str(exc.reason or exc)}
    title = ""
    try:
        html = raw.decode("utf-8", errors="replace")
        parser = _TitleParser()
        parser.feed(html)
        title = parser.title
    except Exception:
        title = ""
    return {"url": url, "ok": 200 <= status < 400, "status": status, "title": title}


def load_watch(base: str, token: str) -> dict:
    return request(base, "GET", "/api/bot/gc-monitor", token)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://127.0.0.1:8097")
    p.add_argument("--email", default="bot@local.test")
    p.add_argument("--password", default="BotStaging1!")
    p.add_argument("--list", action="store_true", help="print GET /api/bot/gc-monitor")
    p.add_argument(
        "--check",
        action="store_true",
        help="fetch each public GC URL and report reachability only (no stats)",
    )
    args = p.parse_args()
    if not args.list and not args.check:
        args.list = True
    token = auth(args.base, args.email, args.password)
    payload = load_watch(args.base, token)
    if args.list:
        print(json.dumps(payload, indent=2))
    if args.check:
        results = []
        for item in payload.get("watch") or []:
            url = item.get("gc_url") or ""
            if not url:
                continue
            hit = fetch_public_title(url)
            hit["kind"] = item.get("kind")
            hit["write"] = item.get("write")
            results.append(hit)
        print(json.dumps({"policy": payload.get("policy"), "checked": results}, indent=2))


if __name__ == "__main__":
    main()
