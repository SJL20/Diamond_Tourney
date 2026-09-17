"""Pool tiebreak: W, L, head-to-head, RA, RS (outline §6 + Diamond Tourney)."""

from __future__ import annotations


def head_to_head(a_id: str, b_id: str, games: list[dict]) -> int:
    a_wins = b_wins = 0
    for g in games:
        home, away = g["home"], g["away"]
        if {home, away} != {a_id, b_id}:
            continue
        hr, ar = g["home_runs"], g["away_runs"]
        a_runs = hr if home == a_id else ar
        b_runs = ar if home == a_id else hr
        if a_runs > b_runs:
            a_wins += 1
        elif b_runs > a_runs:
            b_wins += 1
    if a_wins == b_wins:
        return 0
    return -1 if a_wins > b_wins else 1


def compare_teams(a: dict, b: dict, games: list[dict]) -> int:
    if a["w"] != b["w"]:
        return b["w"] - a["w"]
    if a["l"] != b["l"]:
        return a["l"] - b["l"]
    h2h = head_to_head(a["id"], b["id"], games)
    if h2h:
        return h2h
    if a["ra"] != b["ra"]:
        return a["ra"] - b["ra"]
    if a["rs"] != b["rs"]:
        return b["rs"] - a["rs"]
    return -1 if a["name"] < b["name"] else 1


def sort_pool(teams: list[dict], games: list[dict]) -> list[dict]:
    ranked = list(teams)
    ranked.sort(key=lambda t: 0)  # stable
    from functools import cmp_to_key
    ranked.sort(key=cmp_to_key(lambda a, b: compare_teams(a, b, games)))
    return ranked
