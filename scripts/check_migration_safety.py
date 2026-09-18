#!/usr/bin/env python3
"""Fail CI when a new PocketBase migration would wipe live tournament weekends.

Fly mounts pb_data at /data. Migrations run on every deploy. The one-time
Harbor cleanup in 1700000017_harbor_eight.js already applied and must not be
copied. This checker looks at later (and any other) migration files for the
KEEP/wipe pattern and for listing every event then deleting records.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "pb" / "pb_migrations"
ALLOWED_WIPE = {"1700000017_harbor_eight.js"}

WIPE_FN = re.compile(r"function\s+wipeEvent\s*\(")
KEEP_SET = re.compile(r"KEEP\s*=\s*\{")
LIST_EVENTS = re.compile(r'findRecordsByFilter\(\s*["\']events["\']')
DELETE_EVENT = re.compile(r"app\.delete\(\s*event\s*\)")


def scan(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    hits: list[str] = []
    if path.name in ALLOWED_WIPE:
        return hits
    if WIPE_FN.search(text):
        hits.append("defines wipeEvent")
    if KEEP_SET.search(text) and "keystone-clash" in text:
        hits.append("KEEP set keyed on keystone-clash")
    if LIST_EVENTS.search(text) and DELETE_EVENT.search(text):
        hits.append("lists events and deletes them")
    return hits


def main() -> int:
    problems: list[str] = []
    if not MIG.is_dir():
        print("missing pb/pb_migrations", file=sys.stderr)
        return 2
    for path in sorted(MIG.glob("*.js")):
        for hit in scan(path):
            problems.append(f"{path.name}: {hit}")
    if problems:
        print("Migration safety failed — new merges must not wipe live weekends:", file=sys.stderr)
        for row in problems:
            print("  " + row, file=sys.stderr)
        return 1
    print("Migration safety ok (" + str(len(list(MIG.glob('*.js')))) + " files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
