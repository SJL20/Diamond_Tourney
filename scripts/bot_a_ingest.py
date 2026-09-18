#!/usr/bin/env python3
"""Bot A — parse a GameChanger-style text box and POST staging_games.

Public GameChanger pages are listed by GET /api/bot/gc-monitor
(scripts/bot_gc_monitor.py). Parsed numbers still land in staging; a coach
must Approve. This script never approves and never invents stats.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.metrics import dedup_key, ip_display_to_outs, normalize_name_key
from scripts.pb_client import auth, request


def parse_box(text: str) -> dict:
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    header: dict = {}
    section = None
    hitting, pitching = [], []
    notes = []

    def take_kv(line: str):
        if ":" in line:
            k, v = line.split(":", 1)
            return k.strip().upper(), v.strip()
        return None, None

    for line in lines:
        up = line.upper()
        if up.startswith("TEAM:"):
            header["team_name"] = line.split(":", 1)[1].strip()
            continue
        if up.startswith("OPPONENT:"):
            header["opponent"] = line.split(":", 1)[1].strip()
            continue
        if up.startswith("DATE:"):
            header["date"] = line.split(":", 1)[1].strip()
            continue
        if up.startswith("SCORE:"):
            score = line.split(":", 1)[1].strip().replace(" ", "")
            us, them = score.split("-", 1)
            header["us_runs"] = int(us)
            header["them_runs"] = int(them)
            continue
        if up == "HITTING":
            section = "hitting"
            continue
        if up == "PITCHING":
            section = "pitching"
            continue
        if up.startswith("NAME"):
            continue
        cols = [c.strip() for c in line.replace("\t", " ").split() if c.strip()]
        # name may be two tokens
        if section == "hitting":
            if len(cols) < 8:
                notes.append(f"short hitting line: {line}")
                hitting.append({"raw": line, "name_key": None, "ab": None, "r": None, "h": None, "rbi": None, "bb": None, "so": None})
                continue
            *name_parts, jersey, ab, r, h, rbi, bb, so = cols
            name = " ".join(name_parts)
            hitting.append({
                "name_key": normalize_name_key(name, jersey),
                "jersey": jersey,
                "ab": int(ab), "r": int(r), "h": int(h), "rbi": int(rbi), "bb": int(bb), "so": int(so),
            })
        elif section == "pitching":
            if len(cols) < 8:
                notes.append(f"short pitching line: {line}")
                pitching.append({"raw": line, "name_key": None})
                continue
            # Name # IP H R ER BB SO [P S]
            jersey = None
            # find IP token (has a dot or is small int)
            ip_idx = None
            for i, tok in enumerate(cols):
                if "." in tok or (tok.isdigit() and i >= 2 and int(tok) <= 7):
                    ip_idx = i
                    break
            if ip_idx is None:
                notes.append(f"could not find IP in: {line}")
                continue
            name_parts = cols[: ip_idx - 1]
            jersey = cols[ip_idx - 1]
            rest = cols[ip_idx:]
            ip = rest[0]
            nums = rest[1:]
            try:
                ip_display_to_outs(ip)
            except ValueError as exc:
                notes.append(str(exc))
            row = {
                "name_key": normalize_name_key(" ".join(name_parts), jersey),
                "jersey": jersey,
                "ip": ip,
                "ip_outs": ip_display_to_outs(ip),
                "h": int(nums[0]),
                "r": int(nums[1]),
                "er": int(nums[2]),
                "bb": int(nums[3]),
                "so": int(nums[4]),
            }
            if len(nums) >= 7:
                row["pitches"] = int(nums[5])
                row["strikes"] = int(nums[6])
            pitching.append(row)

    us, them = header.get("us_runs"), header.get("them_runs")
    result = None
    if us is not None and them is not None:
        result = "W" if us > them else "L" if us < them else "T"
    qc_needs_review = any(r.get("ab") is None for r in hitting) or any("name_key" in r and r.get("name_key") is None for r in pitching)
    return {
        "date": header.get("date"),
        "opponent": header.get("opponent"),
        "us_runs": us,
        "them_runs": them,
        "result": result,
        "source": "gc",
        "hitting": hitting,
        "pitching": pitching,
        "parser_notes": "\n".join(notes),
        "qc_needs_review": qc_needs_review,
        "team_name": header.get("team_name"),
    }


def ingest(base: str, email: str, password: str, team_slug: str, text: str) -> dict:
    token = auth(base, email, password)
    payload = parse_box(text)
    payload["team_slug"] = team_slug
    body = request(base, "POST", "/api/bot/ingest", token, {"team_slug": team_slug, "payload": payload, "parser_notes": payload.get("parser_notes"), "status": "needs_review" if payload.get("qc_needs_review") else "staged"})
    return body


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://127.0.0.1:8097")
    p.add_argument("--email", default="bot@local.test")
    p.add_argument("--password", default="BotStaging1!")
    p.add_argument("--team", required=True)
    p.add_argument("box", help="path to pasted box score text")
    args = p.parse_args()
    text = Path(args.box).read_text()
    result = ingest(args.base, args.email, args.password, args.team, text)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
