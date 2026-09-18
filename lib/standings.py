"""Pool tiebreak: record (win% with a tie as half), group-aware H2H, RA, diff, RS.

Default product order (Tourney Machine style, Derek 2026-09-18):
  record → head-to-head → fewest RA → run differential → most RS

Head-to-head applies only when the current tied group is exactly two teams
that have played, or every pair in a larger group has a decided game.
A complete round-robin that leaves everyone with the same intra-group
record (a cycle) skips H2H and continues down the list.

Keep this file in lockstep with ``pb/pb_hooks/diamond.js``.
Do not change season-book metric formulas (ERA / BA / Contact% / Strike% / IP).
"""

from __future__ import annotations

DEFAULT_ORDER = ("record", "h2h", "ra", "diff", "rs")

CRITERION_LABELS = {
    "record": "better record (tie counts as half a win)",
    "h2h": "won head-to-head",
    "ra": "fewest runs allowed",
    "diff": "better run differential",
    "rs": "more runs scored",
}

_ALIASES = {
    "winpct": "record",
    "win%": "record",
    "pct": "record",
    "wl": "record",
    "w-l": "record",
    "w_l": "record",
    "wins": "record",
    "head-to-head": "h2h",
    "headtohead": "h2h",
    "head_to_head": "h2h",
    "runs_allowed": "ra",
    "runs-allowed": "ra",
    "run_diff": "diff",
    "run-diff": "diff",
    "rundiff": "diff",
    "rd": "diff",
    "runs_scored": "rs",
    "runs-scored": "rs",
}


def parse_order(raw) -> list[str]:
    allowed = set(DEFAULT_ORDER)
    if raw is None or raw == "":
        return list(DEFAULT_ORDER)
    if isinstance(raw, dict):
        raw = raw.get("order") or raw.get("tiebreak") or raw.get("criteria")
    if isinstance(raw, str):
        raw = [part.strip() for part in raw.replace("|", ",").split(",") if part.strip()]
    out: list[str] = []
    seen: set[str] = set()
    for item in raw or []:
        key = _ALIASES.get(str(item).strip().lower(), str(item).strip().lower())
        if key in allowed and key not in seen:
            out.append(key)
            seen.add(key)
    for key in DEFAULT_ORDER:
        if key not in seen:
            out.append(key)
    return out


def tiebreak_label(order=None) -> str:
    names = {
        "record": "record (tie = half)",
        "h2h": "head-to-head",
        "ra": "fewest runs allowed",
        "diff": "run differential",
        "rs": "most runs scored",
    }
    return ", then ".join(names[k] for k in parse_order(order))


def win_pct(team: dict) -> float:
    wins = int(team.get("w") or 0)
    losses = int(team.get("l") or 0)
    ties = int(team.get("t") or 0)
    games = wins + losses + ties
    if games <= 0:
        return 0.0
    return (wins + 0.5 * ties) / games


def _runs(game: dict, key: str):
    value = game.get(key)
    if value is None or value == "":
        return None
    return int(value)


def decided_games(games: list[dict]) -> list[dict]:
    out = []
    for game in games or []:
        if _runs(game, "home_runs") is None or _runs(game, "away_runs") is None:
            continue
        out.append(game)
    return out


def pair_games(a_id: str, b_id: str, games: list[dict]) -> list[dict]:
    out = []
    for game in decided_games(games):
        if {game.get("home"), game.get("away")} == {a_id, b_id}:
            out.append(game)
    return out


def pairwise_h2h(a_id: str, b_id: str, games: list[dict]) -> int:
    a_wins = b_wins = 0
    for game in pair_games(a_id, b_id, games):
        home, away = game["home"], game["away"]
        home_runs, away_runs = int(game["home_runs"]), int(game["away_runs"])
        a_runs = home_runs if home == a_id else away_runs
        b_runs = away_runs if home == a_id else home_runs
        if a_runs > b_runs:
            a_wins += 1
        elif b_runs > a_runs:
            b_wins += 1
    if a_wins == b_wins:
        return 0
    return -1 if a_wins > b_wins else 1


def complete_round_robin(ids: list[str], games: list[dict]) -> bool:
    if len(ids) < 2:
        return False
    for i, a_id in enumerate(ids):
        for b_id in ids[i + 1 :]:
            if not pair_games(a_id, b_id, games):
                return False
    return True


def intra_wins(team_id: str, group_ids: set[str], games: list[dict]) -> int:
    wins = 0
    for game in decided_games(games):
        home, away = game.get("home"), game.get("away")
        if home not in group_ids or away not in group_ids:
            continue
        if team_id not in (home, away):
            continue
        home_runs, away_runs = int(game["home_runs"]), int(game["away_runs"])
        if home == team_id and home_runs > away_runs:
            wins += 1
        elif away == team_id and away_runs > home_runs:
            wins += 1
    return wins


def h2h_mode(group: list[dict], games: list[dict]) -> str:
    if len(group) == 2:
        return "pair" if pair_games(group[0]["id"], group[1]["id"], games) else ""
    if len(group) >= 3 and complete_round_robin([team["id"] for team in group], games):
        return "rr"
    return ""


def criterion_value(team: dict, crit: str, group: list[dict], games: list[dict], mode: str) -> float:
    if crit == "record":
        return win_pct(team)
    if crit == "ra":
        return -int(team.get("ra") or 0)
    if crit == "diff":
        return int(team.get("rs") or 0) - int(team.get("ra") or 0)
    if crit == "rs":
        return int(team.get("rs") or 0)
    if crit == "h2h" and mode == "pair":
        other = next(row for row in group if row["id"] != team["id"])
        return -pairwise_h2h(team["id"], other["id"], games)
    if crit == "h2h" and mode == "rr":
        return float(intra_wins(team["id"], {row["id"] for row in group}, games))
    return 0.0


def _reason_label(crit: str, mode: str, suffix: str) -> str:
    if crit == "h2h" and mode == "rr":
        label = "more wins inside the tied group"
    else:
        label = CRITERION_LABELS.get(crit, crit)
    if suffix:
        return f"{label} after {suffix}"
    return label


def sort_group(
    teams: list[dict],
    games: list[dict],
    order: list[str],
    reasons: dict[str, str] | None = None,
    suffix: str = "",
) -> list[dict]:
    if len(teams) <= 1:
        return list(teams)
    if not order:
        return sorted(teams, key=lambda team: (team.get("name") or "").lower())

    crit = order[0]
    rest = order[1:]
    mode = ""

    if crit == "h2h":
        mode = h2h_mode(teams, games)
        if not mode:
            note = f"{len(teams)}-team tie; not every pair has played"
            return sort_group(teams, games, rest, reasons, suffix or note)
        if mode == "rr":
            ids = {team["id"] for team in teams}
            wins = {team["id"]: intra_wins(team["id"], ids, games) for team in teams}
            if len(set(wins.values())) <= 1:
                note = f"{len(teams)}-team cycle"
                return sort_group(teams, games, rest, reasons, suffix or note)
        if mode == "pair" and pairwise_h2h(teams[0]["id"], teams[1]["id"], games) == 0:
            return sort_group(teams, games, rest, reasons, suffix)

    buckets: dict[float, list[dict]] = {}
    for team in teams:
        value = criterion_value(team, crit, teams, games, mode)
        buckets.setdefault(value, []).append(team)

    ranked: list[dict] = []
    split = len(buckets) > 1
    for value in sorted(buckets.keys(), reverse=True):
        bucket = buckets[value]
        if reasons is not None and split and len(bucket) == 1:
            label = _reason_label(crit, mode, suffix)
            reasons.setdefault(bucket[0]["id"], label)
        next_suffix = "" if split else suffix
        ranked.extend(sort_group(bucket, games, rest, reasons, next_suffix))
    return ranked


def sort_pool(teams: list[dict], games: list[dict], order=None) -> list[dict]:
    criteria = parse_order(order)
    reasons: dict[str, str] = {}
    ranked = sort_group(list(teams), games, criteria, reasons)
    for index, team in enumerate(ranked):
        team["seed"] = index + 1
        team["diff"] = int(team.get("rs") or 0) - int(team.get("ra") or 0)
        team["win_pct"] = round(win_pct(team), 3)
        reason = reasons.get(team["id"], "")
        if not reason:
            if len(ranked) == 1:
                reason = "only team in the pool"
            elif index == 0:
                reason = reasons.get(ranked[1]["id"], CRITERION_LABELS[criteria[0]])
            else:
                reason = "name order"
        team["seed_reason"] = reason
    return ranked


def head_to_head(a_id: str, b_id: str, games: list[dict]) -> int:
    return pairwise_h2h(a_id, b_id, games)


def compare_teams(a: dict, b: dict, games: list[dict], order=None) -> int:
    ranked = sort_pool([a, b], games, order)
    if ranked[0]["id"] == a["id"] and ranked[1]["id"] == b["id"]:
        return -1
    if ranked[0]["id"] == b["id"] and ranked[1]["id"] == a["id"]:
        return 1
    return 0
