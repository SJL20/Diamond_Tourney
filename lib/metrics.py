"""Shared softball metric formulas (outline §1)."""

from __future__ import annotations


def ip_display_to_outs(ip) -> int | None:
    """Convert softball IP (4.0 / 2.1 / 0.2) to integer outs."""
    if ip is None or ip == "":
        return None
    if isinstance(ip, int):
        return ip
    text = str(ip).strip()
    if not text:
        return None
    if "." in text:
        whole, frac = text.split(".", 1)
        rem = int(frac[:1] or "0")
        if rem not in (0, 1, 2):
            raise ValueError(f"invalid IP remainder: {ip}")
        return int(whole or "0") * 3 + rem
    return int(float(text)) * 3


def outs_to_ip_display(outs: int) -> str:
    if outs is None:
        return "0.0"
    innings, rem = divmod(int(outs), 3)
    return f"{innings}.{rem}"


def batting_average(h: int, ab: int) -> str:
    if not ab:
        return ".000"
    return f"{(h / ab):.3f}".lstrip("0")


def contact_pct(ab: int, so: int) -> str | None:
    if not ab:
        return None
    return f"{((ab - so) / ab) * 100:.1f}"


def era(er: int, ip_outs: int) -> str | None:
    if not ip_outs:
        return None
    ip = ip_outs / 3.0
    return f"{(er * 7) / ip:.2f}"


def strike_pct(strikes: int | None, pitches: int | None) -> str | None:
    if not pitches:
        return None
    return f"{(strikes / pitches) * 100:.1f}"


def name_key(first: str, last_initial: str, jersey) -> str:
    return f"{first.strip()} {last_initial.strip().upper()} #{int(jersey)}"


def dedup_key(team_id: str, date: str, opponent: str, us_runs: int, them_runs: int) -> str:
    opp = " ".join((opponent or "").lower().split())
    return f"{team_id}|{date}|{opp}|{us_runs}-{them_runs}"


def normalize_name_key(raw: str, jersey=None) -> str:
    text = " ".join((raw or "").split())
    if "#" not in text and jersey is not None and str(jersey) != "":
        text = f"{text} #{jersey}"
    return text
