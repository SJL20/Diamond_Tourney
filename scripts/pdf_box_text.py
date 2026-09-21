#!/usr/bin/env python3
"""Read a GameChanger-style box-score PDF text layer into review lines.

Headers decide the columns. A cell that is missing, shifted, or a season
average stays null. This does not approve anything and does not invent a 0.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

BATTING_MAP = {
    "AB": "ab",
    "R": "r",
    "H": "h",
    "RBI": "rbi",
    "BB": "bb",
    "SO": "so",
    "K": "so",
}
PITCHING_MAP = {
    "IP": "ip",
    "H": "h",
    "R": "r",
    "ER": "er",
    "BB": "bb",
    "SO": "so",
    "K": "so",
    "NP": "pitches",
    "#P": "pitches",
    "P": "pitches",
    "PITCHES": "pitches",
    "S": "strikes",
    "STRIKES": "strikes",
    "P-S": "p_s",
    "PS": "p_s",
    "NP-S": "p_s",
}
IGNORE = {
    "AVG", "OBP", "SLG", "OPS", "ERA", "WHIP",
    "SB", "CS", "HR", "2B", "3B", "HBP", "SAC", "SF", "LOB", "PA",
    "W", "L", "SV", "BF", "WP", "HP", "TB", "GDP", "HBP",
}
META = {
    "#": "jersey",
    "NO": "jersey",
    "NUM": "jersey",
    "JERSEY": "jersey",
    "PLAYER": "name",
    "NAME": "name",
    "BATTER": "name",
    "PITCHER": "name",
    "POS": "skip",
    "POSITION": "skip",
}
STORE = {
    "ab", "r", "h", "rbi", "bb", "so",
    "ip", "er", "pitches", "strikes",
}
LABELS = {
    "ab": "AB", "r": "R", "h": "H", "rbi": "RBI", "bb": "BB", "so": "SO",
    "ip": "IP", "er": "ER", "pitches": "Pitches", "strikes": "Strikes",
}
# Single letters stay in the name. A last initial is often P or C.
POSITIONS = {
    "1B", "2B", "3B", "SS", "LF", "CF", "RF",
    "DH", "DP", "FLEX", "UTIL", "INF", "OF", "EH",
}
SECTION_LABELS = {
    "batting", "pitching", "hitting", "boxscore", "linescore", "fielding", "totals",
}
DASHES = {"-", "–", "—", "−"}
STATISH = re.compile(r"^(?:\d+|\d+\.\d+|\.\d+|\d+-\d+|[-–—−])$")
AVERAGE = re.compile(r"^(?:\.\d{3}|[01]\.\d{3})$")
TOTALS = re.compile(r"^(?:team\s+)?totals?$", re.I)


def norm_header(text: str) -> str:
    token = (text or "").strip().upper().replace("–", "-").replace("—", "-")
    return re.sub(r"[^A-Z0-9#\-]", "", token)


def is_known(token: str) -> bool:
    return token in META or token in BATTING_MAP or token in PITCHING_MAP or token in IGNORE


def map_token(token: str, kind: str) -> str | None:
    if token in META:
        return META[token]
    if token in IGNORE:
        return "ignore"
    table = BATTING_MAP if kind == "batting" else PITCHING_MAP
    if token in table:
        return table[token]
    if token in BATTING_MAP or token in PITCHING_MAP:
        return "ignore"
    return None


def norm_name(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def match_side(label: str, home: str, away: str) -> str:
    """Match a section title to the scheduled home or away name."""
    n = norm_name(label)
    if len(n) < 4:
        return ""

    def strong(a: str, b: str) -> bool:
        if not a or not b:
            return False
        if a == b:
            return True
        short, long = (a, b) if len(a) <= len(b) else (b, a)
        return len(short) >= 6 and short in long

    nh, na = norm_name(home), norm_name(away)
    h, a = strong(n, nh), strong(n, na)
    if h and a:
        if abs(len(n) - len(nh)) < abs(len(n) - len(na)):
            return "home"
        if abs(len(n) - len(na)) < abs(len(n) - len(nh)):
            return "away"
        return ""
    if h:
        return "home"
    if a:
        return "away"
    return ""


def words_from_tsv(text: str) -> list[dict]:
    """Read poppler `pdftotext -tsv`. Columns follow the header row."""
    lines = text.splitlines()
    if not lines:
        return []
    header = lines[0].split("\t")
    index = {name: i for i, name in enumerate(header)}
    needed = ("left", "top", "width", "height", "text")
    if any(name not in index for name in needed):
        return []

    def cell(parts: list[str], name: str) -> str:
        slot = index[name]
        if slot >= len(parts):
            return ""
        if name == "text":
            return "\t".join(parts[slot:]).strip()
        return parts[slot].strip()

    rows = []
    for line in lines[1:]:
        parts = line.split("\t")
        if len(parts) <= index["text"]:
            continue
        word = cell(parts, "text")
        if not word or word.startswith("###"):
            continue
        level = cell(parts, "level") if "level" in index else "5"
        if level and level != "5":
            continue
        try:
            x0 = float(cell(parts, "left"))
            y = float(cell(parts, "top"))
            width = float(cell(parts, "width"))
            height = float(cell(parts, "height") or "8")
            page = int(cell(parts, "page_num") or "1") if "page_num" in index else 1
        except ValueError:
            continue
        rows.append({
            "page": page,
            "level": 5,
            "x0": x0,
            "x1": x0 + width,
            "top": y,
            "height": height or 8.0,
            "text": word,
        })
    return rows


def cluster_lines(words: list[dict]) -> list[dict]:
    if not words:
        return []
    heights = sorted(w.get("height") or 8.0 for w in words)
    tol = max(3.0, heights[len(heights) // 2] * 0.55)
    ordered = sorted(words, key=lambda w: (w["page"], w["top"], w["x0"]))
    lines: list[dict] = []
    for word in ordered:
        if (
            lines
            and lines[-1]["page"] == word["page"]
            and abs(lines[-1]["top"] - word["top"]) <= tol
        ):
            bucket = lines[-1]
            n = len(bucket["words"])
            bucket["top"] = (bucket["top"] * n + word["top"]) / (n + 1)
            bucket["words"].append(word)
        else:
            lines.append({"page": word["page"], "top": word["top"], "words": [word]})
    for line in lines:
        line["words"].sort(key=lambda w: w["x0"])
    return lines


def line_text(line: dict) -> str:
    return " ".join(w["text"] for w in line["words"]).strip()


def classify_header(words: list[dict]) -> dict | None:
    tokens = []
    unknown = False
    for word in words:
        token = norm_header(word["text"])
        if not token:
            continue
        if token.isdigit():
            unknown = True
            continue
        if is_known(token):
            tokens.append(token)
            continue
        if len(token) > 2:
            unknown = True
    if unknown or not tokens:
        return None
    has_ab = "AB" in tokens
    has_ip = "IP" in tokens
    if has_ab and has_ip:
        return {"kind": "ambiguous", "slots": [], "ignored": [], "dups": []}
    if has_ab:
        kind = "batting"
    elif has_ip:
        kind = "pitching"
    else:
        return None
    stat_keys = set()
    for token in tokens:
        key = map_token(token, kind)
        if key in STORE or key == "p_s":
            stat_keys.add(key)
    if len(stat_keys) < 3:
        return None
    slots, ignored, dups = build_slots(words, kind)
    return {"kind": kind, "slots": slots, "ignored": ignored, "dups": dups}


def build_slots(words: list[dict], kind: str) -> tuple[list[dict], list[str], list[str]]:
    items = []
    ignored = []
    dups = []
    seen: set[str] = set()
    for word in words:
        token = norm_header(word["text"])
        if not token or not is_known(token):
            continue
        key = map_token(token, kind)
        if key in (None, "name", "skip"):
            continue
        if key == "ignore":
            ignored.append(token)
        elif key in seen:
            dups.append(key)
        else:
            seen.add(key)
        cx = (word["x0"] + word["x1"]) / 2
        items.append({
            "key": key,
            "token": token,
            "cx": cx,
            "x0": word["x0"],
            "x1": word["x1"],
        })
    if dups:
        items = [item for item in items if item["key"] not in dups]
    items.sort(key=lambda item: item["cx"])
    for i, slot in enumerate(items):
        cap = 22 if slot["key"] == "jersey" else 32
        prev_cx = items[i - 1]["cx"] if i else None
        next_cx = items[i + 1]["cx"] if i + 1 < len(items) else None
        left = slot["cx"] - cap if prev_cx is None else (prev_cx + slot["cx"]) / 2
        right = slot["cx"] + cap if next_cx is None else (slot["cx"] + next_cx) / 2
        slot["left"] = max(left, slot["cx"] - cap)
        slot["right"] = min(right, slot["cx"] + cap)
        if slot["right"] <= slot["left"]:
            slot["right"] = slot["left"] + 8
    return items, ignored, dups


def is_statish(text: str) -> bool:
    return bool(STATISH.match((text or "").strip()))


def assign(words: list[dict], slots: list[dict]) -> tuple[dict, list[dict]]:
    claimed: dict[str, list[dict]] = {}
    rest = []
    for word in words:
        cx = (word["x0"] + word["x1"]) / 2
        best = None
        best_d = None
        for slot in slots:
            if cx < slot["left"] or cx >= slot["right"]:
                continue
            dist = abs(cx - slot["cx"])
            if best is None or dist < best_d:
                best = slot
                best_d = dist
        text = word["text"].strip()
        if best and best["key"] == "jersey" and re.fullmatch(r"#?\d{1,3}", text):
            claimed.setdefault("jersey", []).append(word)
        elif best and best["key"] != "jersey" and (best["key"] == "ignore" or is_statish(text)):
            claimed.setdefault(best["key"], []).append(word)
        else:
            rest.append(word)
    return claimed, rest


def cell_value(field: str, text: str):
    raw = (text or "").strip()
    if raw in DASHES or raw == "":
        return None, "blank"
    if field == "ip":
        if re.fullmatch(r"\d+", raw):
            return f"{int(raw)}.0", None
        match = re.fullmatch(r"(\d+)\.(\d)", raw)
        if match and match.group(2) in "012":
            return f"{int(match.group(1))}.{match.group(2)}", None
        return None, "bad"
    if field == "p_s":
        match = re.fullmatch(r"(\d+)-(\d+)", raw)
        if match:
            return (int(match.group(1)), int(match.group(2))), None
        return None, "bad"
    if AVERAGE.match(raw):
        return None, "average"
    if re.fullmatch(r"\d+", raw):
        return int(raw), None
    return None, "bad"


def player_name(words: list[dict]) -> tuple[str, str]:
    text = " ".join(w["text"].strip() for w in words if w["text"].strip())
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" ,")
    jersey = ""
    hashed = re.search(r"#\s*(\d{1,3})", text)
    if hashed:
        jersey = hashed.group(1)
        text = (text[: hashed.start()] + " " + text[hashed.end() :]).strip()
    leading = re.match(r"(\d{1,2})\s+([A-Za-z].*)$", text)
    if leading and not jersey:
        jersey = leading.group(1)
        text = leading.group(2).strip()
    parts = text.split()
    if len(parts) >= 2 and parts[-1].upper() in POSITIONS:
        parts = parts[:-1]
    text = " ".join(parts).strip(" ,")
    return text, jersey


def is_skippable_name(name: str) -> bool:
    if TOTALS.match(name.strip()):
        return True
    folded = re.sub(r"[^a-z]", "", name.lower())
    return folded in SECTION_LABELS


def who(name: str, jersey: str) -> str:
    return f"{name} #{jersey}" if jersey else name


def parse_player(words: list[dict], header: dict, side: str, notes: list[str]) -> dict | None:
    claimed, rest = assign(words, header["slots"])
    name, jersey = player_name(rest)
    jersey_words = claimed.get("jersey") or []
    if jersey_words and not jersey:
        match = re.search(r"\d{1,3}", jersey_words[0]["text"])
        if match:
            jersey = match.group(0)
    if len(jersey_words) > 1:
        notes.append(f"Jersey for {who(name, jersey) or 'a row'} was left blank.")
        jersey = ""
    if not re.search(r"[A-Za-z]", name) or is_skippable_name(name):
        return None
    label = who(name, jersey)
    had_number = False
    values: dict = {}
    for slot in header["slots"]:
        key = slot["key"]
        if key not in STORE and key != "p_s":
            continue
        if key in values:
            continue
        tokens = claimed.get(key) or []
        if not tokens:
            values[key] = None
            continue
        tokens = sorted(tokens, key=lambda w: w["x0"])
        blob = "".join(w["text"].strip() for w in tokens)
        if len(tokens) > 1 and not (
            key == "ip" and re.fullmatch(r"\d+\.\d", blob)
        ):
            values[key] = None
            notes.append(f"Two numbers under {LABELS.get(key, key)} for {label} were left blank.")
            continue
        value, reason = cell_value(key, tokens[0]["text"] if len(tokens) == 1 else blob)
        values[key] = value
        if isinstance(value, tuple):
            had_number = True
        elif isinstance(value, int) or (isinstance(value, str) and value):
            had_number = True
        elif reason == "blank":
            pass
        elif reason == "average":
            notes.append(f"{LABELS.get(key, key)} for {label} looked like a season average and was left blank.")
        else:
            notes.append(f"{LABELS.get(key, key)} for {label} was left blank.")
    if not had_number:
        return None
    for key, value in list(values.items()):
        if key == "p_s":
            continue
        if value is None and key in STORE and not any(
            n.startswith(f"Two numbers under {LABELS.get(key, key)} for {label}")
            or n.startswith(f"{LABELS.get(key, key)} for {label}")
            for n in notes
        ):
            notes.append(f"Blank {LABELS.get(key, key)} for {label}.")
    pair = values.pop("p_s", None)
    if isinstance(pair, tuple):
        if "pitches" not in values or values.get("pitches") is None:
            values["pitches"] = pair[0]
        if "strikes" not in values or values.get("strikes") is None:
            values["strikes"] = pair[1]
    ab, hits = values.get("ab"), values.get("h")
    if isinstance(ab, int) and isinstance(hits, int) and hits > ab:
        notes.append(f"H is above AB for {label}.")
    row = {"side": side, "jersey": jersey, "name": name}
    for key in ("ab", "r", "h", "rbi", "bb", "so", "ip", "er", "pitches", "strikes"):
        if key in values:
            row[key] = values[key]
    return row


def is_section_label(text: str) -> bool:
    return re.sub(r"[^a-z]", "", (text or "").lower()) in SECTION_LABELS


def is_label_candidate(text: str) -> bool:
    """A team title has letters and almost no stat cells. A player row does not."""
    if not text or is_section_label(text):
        return False
    statish = 0
    letters = 0
    for token in text.split():
        if is_statish(token) or AVERAGE.match(token):
            statish += 1
        elif re.search(r"[A-Za-z]", token):
            letters += 1
    return letters > 0 and statish < 3


def side_above(lines: list[dict], index: int, home: str, away: str) -> tuple[str, str, bool]:
    """Closest title above this header, stopping at the previous header.

    The third value is true when a title was there and it matched neither team.
    """
    fallback = ""
    for j in range(index - 1, -1, -1):
        if lines[j].get("header"):
            break
        text = line_text(lines[j])
        if not is_label_candidate(text):
            continue
        if not fallback:
            fallback = text
        side = match_side(text, home, away)
        if side:
            return side, text, False
    return "", fallback, bool(fallback)


def parse_words(words: list[dict], home: str = "", away: str = "") -> dict:
    lines = cluster_lines(words)
    any_header = False
    for line in lines:
        line["header"] = classify_header(line["words"])
        if line["header"]:
            any_header = True
    notes: list[str] = []
    hitting = []
    pitching = []
    ignored: list[str] = []
    current_side = ""
    for i, line in enumerate(lines):
        header = line.get("header")
        if not header:
            text = line_text(line)
            if is_label_candidate(text):
                found = match_side(text, home, away)
                if found:
                    current_side = found
            continue
        if header["kind"] == "ambiguous":
            notes.append("A header row listed both AB and IP, so that row was left unread.")
            continue
        for key in header["dups"]:
            notes.append(f"{LABELS.get(key, key)} was listed twice, so that column was left blank.")
        ignored.extend(header["ignored"])
        side, label, unmatched = side_above(lines, i, home, away)
        if side:
            current_side = side
        elif not unmatched:
            side = current_side
        if not side:
            title = " ".join((label or "unlabeled").split())[:80]
            kind = "Batting" if header["kind"] == "batting" else "Pitching"
            notes.append(f"{kind} section \"{title}\" is unread until it matches the home or away name.")
            continue
        j = i + 1
        while j < len(lines) and not lines[j].get("header"):
            row = parse_player(lines[j]["words"], header, side, notes)
            if row:
                if header["kind"] == "batting":
                    hitting.append(row)
                else:
                    pitching.append(row)
            j += 1
    return finish(bool(words), any_header, hitting, pitching, notes, ignored)


def finish(had_words: bool, any_header: bool, hitting: list, pitching: list, notes: list, ignored: list) -> dict:
    if not had_words:
        note = "PDF text extract found no text layer. The file stays queued."
        return {"ok": True, "hitting": [], "pitching": [], "note": note}
    if not any_header:
        note = "PDF text extract found no batting or pitching headers. The file stays queued."
        return {"ok": True, "hitting": [], "pitching": [], "note": note}
    parts = ["PDF text extract."]
    if hitting or pitching:
        parts.append("Lines are waiting on Approve stats.")
    else:
        parts.append("No player lines were kept.")
    seen = set()
    kept = 0
    for note in notes:
        if note in seen:
            continue
        seen.add(note)
        kept += 1
        if kept <= 12:
            parts.append(note)
    if kept > 12:
        parts.append("More cells were left blank.")
    cols = []
    for token in ignored:
        if token not in cols:
            cols.append(token)
    if cols:
        parts.append("Columns left off the game lines: " + ", ".join(sorted(cols)) + ".")
    return {
        "ok": True,
        "hitting": hitting,
        "pitching": pitching,
        "note": " ".join(parts),
    }


def words_from_pdftotext(path: str) -> tuple[list[dict], str]:
    try:
        proc = subprocess.run(
            ["pdftotext", "-enc", "UTF-8", "-tsv", path, "-"],
            check=False,
            capture_output=True,
        )
    except FileNotFoundError:
        return [], "missing"
    text = proc.stdout.decode("utf-8", errors="replace")
    words = words_from_tsv(text)
    if words:
        return words, ""
    if proc.returncode != 0:
        return [], "failed"
    return [], ""


def extract_pdf(path: str, home: str = "", away: str = "") -> dict:
    file = Path(path)
    if not file.is_file():
        return {
            "ok": False,
            "hitting": [],
            "pitching": [],
            "note": "PDF text extract failed. The file stays queued.",
        }
    words, err = words_from_pdftotext(str(file))
    if err == "missing":
        return {
            "ok": False,
            "hitting": [],
            "pitching": [],
            "note": "PDF text extract is unavailable on this server. The file stays queued.",
        }
    if err == "failed":
        return {
            "ok": False,
            "hitting": [],
            "pitching": [],
            "note": "PDF text extract failed. The file stays queued.",
        }
    return parse_words(words, home, away)


def _pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_text_pdf(items: list[tuple], width: int = 720, height: int = 900) -> bytes:
    """Place ASCII strings. y is the distance from the top of the page."""
    commands = ["BT"]
    for item in items:
        x, y, text = item[0], item[1], item[2]
        size = item[3] if len(item) > 3 else 10
        baseline = height - y - size
        commands.append(f"/F1 {size} Tf")
        commands.append(f"1 0 0 1 {x:.2f} {baseline:.2f} Tm")
        commands.append(f"({_pdf_escape(text)}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("latin-1", errors="replace")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
            f"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
        ).encode(),
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    ).encode()
    return bytes(out)


def sample_pdf_bytes(home: str = "FAKE Hawks 10U", away: str = "FAKE Heat 10U") -> bytes:
    """A text-layer box with a blank cell, a real zero, a season average, and an unread club."""
    bat = {"jersey": 40, "name": 78, "AB": 250, "R": 300, "H": 348, "RBI": 404, "BB": 462, "SO": 516, "AVG": 572}
    pit = {"jersey": 40, "name": 78, "IP": 250, "H": 300, "R": 348, "ER": 404, "BB": 462, "K": 516, "NP": 570, "S": 626}
    items: list[tuple] = []

    def add(x, y, text):
        items.append((x, y, text))

    def batting_header(y):
        add(bat["jersey"], y, "#")
        add(bat["name"], y, "Player")
        for key in ("AB", "R", "H", "RBI", "BB", "SO", "AVG"):
            add(bat[key], y, key)

    def pitching_header(y):
        add(pit["jersey"], y, "#")
        add(pit["name"], y, "Player")
        for key in ("IP", "H", "R", "ER", "BB", "K", "NP", "S"):
            add(pit[key], y, key)

    y = 48
    add(36, y, home)
    y += 18
    add(36, y, "Batting")
    y += 18
    batting_header(y)
    y += 18
    add(bat["jersey"], y, "17")
    add(bat["name"], y, "FAKE Ada L")
    add(bat["AB"], y, "3")
    add(bat["R"], y, "1")
    add(bat["H"], y, "2")
    add(bat["BB"], y, "1")
    add(bat["SO"], y, "0")
    add(bat["AVG"], y, ".400")
    y += 18
    add(bat["jersey"], y, "4")
    add(bat["name"], y, "FAKE Bea M")
    add(bat["AB"], y, "2")
    add(bat["R"], y, "0")
    add(bat["H"], y, "3")
    add(bat["RBI"], y, "1")
    add(bat["BB"], y, "0")
    add(bat["SO"], y, "1")
    add(bat["AVG"], y, ".250")
    y += 18
    add(bat["name"], y, "TEAM TOTALS")
    add(bat["AB"], y, "5")
    add(bat["R"], y, "1")
    add(bat["H"], y, "5")
    add(bat["RBI"], y, "1")
    add(bat["BB"], y, "1")
    add(bat["SO"], y, "1")
    y += 28
    add(36, y, "Pitching")
    y += 18
    pitching_header(y)
    y += 18
    add(pit["jersey"], y, "12")
    add(pit["name"], y, "FAKE Cy P")
    add(pit["IP"], y, "3.1")
    add(pit["H"], y, "4")
    add(pit["R"], y, "2")
    add(pit["BB"], y, "1")
    add(pit["K"], y, "5")
    add(pit["NP"], y, "48")
    add(pit["S"], y, "30")
    y += 36
    add(36, y, away)
    y += 18
    add(36, y, "Batting")
    y += 18
    batting_header(y)
    y += 18
    add(bat["jersey"], y, "8")
    add(bat["name"], y, "FAKE Dee R")
    add(bat["AB"], y, "3")
    add(bat["R"], y, "1")
    add(bat["H"], y, "1")
    add(bat["RBI"], y, "0")
    add(bat["BB"], y, "0")
    add(bat["SO"], y, "2")
    add(bat["AVG"], y, ".333")
    y += 28
    add(36, y, "Pitching")
    y += 18
    pitching_header(y)
    y += 18
    add(pit["jersey"], y, "1")
    add(pit["name"], y, "FAKE Eve S")
    add(pit["IP"], y, "4.0")
    add(pit["H"], y, "5")
    add(pit["R"], y, "3")
    add(pit["ER"], y, "2")
    add(pit["BB"], y, "2")
    add(pit["K"], y, "3")
    add(pit["NP"], y, "40")
    add(pit["S"], y, "22")
    y += 36
    add(36, y, "Mystery Club")
    y += 18
    add(36, y, "Batting")
    y += 18
    add(bat["jersey"], y, "#")
    add(bat["name"], y, "Player")
    add(bat["AB"], y, "AB")
    add(bat["R"], y, "R")
    add(bat["H"], y, "H")
    y += 18
    add(bat["jersey"], y, "9")
    add(bat["name"], y, "FAKE Zed Q")
    add(bat["AB"], y, "1")
    add(bat["R"], y, "0")
    add(bat["H"], y, "1")
    return build_text_pdf(items)


def headerless_pdf_bytes() -> bytes:
    return build_text_pdf([(36, 48, "Scanner page with no stat headers")])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", required=True)
    args = parser.parse_args()
    try:
        job = json.loads(Path(args.job).read_text(encoding="utf-8"))
        result = extract_pdf(job.get("pdf") or "", job.get("home") or "", job.get("away") or "")
    except Exception:
        result = {
            "ok": False,
            "hitting": [],
            "pitching": [],
            "note": "PDF text extract failed. The file stays queued.",
        }
    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
