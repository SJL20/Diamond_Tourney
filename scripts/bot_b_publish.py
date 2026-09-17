#!/usr/bin/env python3
"""Bot B — rebuild season tables and draft an unpublished recap."""

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
    p.add_argument("--team", required=True)
    args = p.parse_args()
    token = auth(args.base, args.email, args.password)
    out = request(args.base, "POST", "/api/bot/publish", token, {"team_slug": args.team})
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
