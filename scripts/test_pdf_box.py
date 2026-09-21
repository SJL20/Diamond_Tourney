#!/usr/bin/env python3
"""Header-first PDF box extract. No server required."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.pdf_box_text import (
    extract_pdf,
    headerless_pdf_bytes,
    parse_words,
    sample_pdf_bytes,
)

ROOT = Path(__file__).resolve().parents[1]


def word(text, x, y=120, page=1, width=None):
    w = width if width is not None else max(8, 6 * len(text))
    return {
        "text": text,
        "x0": x,
        "x1": x + w,
        "top": float(y),
        "height": 10.0,
        "page": page,
        "level": 5,
    }


def header_row():
    cols = [("#", 40), ("Player", 80), ("AB", 250), ("R", 300), ("H", 348), ("RBI", 404), ("BB", 462), ("SO", 516), ("AVG", 572)]
    return [word(text, x, y=100, width=max(10, 7 * len(text))) for text, x in cols]


class PdfBoxTextTests(unittest.TestCase):
    def test_sample_pdf_keeps_blanks_zeros_and_drops_season_average(self):
        home, away = "FAKE Hawks 10U", "FAKE Heat 10U"
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(sample_pdf_bytes(home, away))
            path = handle.name
        result = extract_pdf(path, home, away)
        self.assertTrue(result["ok"], result)
        hit = {row["name"]: row for row in result["hitting"]}
        pit = {row["name"]: row for row in result["pitching"]}
        self.assertEqual(set(hit), {"FAKE Ada L", "FAKE Bea M", "FAKE Dee R"})
        self.assertEqual(set(pit), {"FAKE Cy P", "FAKE Eve S"})
        ada = hit["FAKE Ada L"]
        self.assertEqual(ada["side"], "home")
        self.assertEqual(ada["jersey"], "17")
        self.assertEqual(ada["ab"], 3)
        self.assertEqual(ada["h"], 2)
        self.assertIsNone(ada["rbi"])
        self.assertEqual(ada["so"], 0)
        self.assertNotIn("avg", ada)
        self.assertEqual(hit["FAKE Bea M"]["h"], 3)
        self.assertEqual(hit["FAKE Bea M"]["ab"], 2)
        dee = hit["FAKE Dee R"]
        self.assertEqual(dee["side"], "away")
        self.assertEqual(dee["rbi"], 0)
        cy = pit["FAKE Cy P"]
        self.assertEqual(cy["ip"], "3.1")
        self.assertIsNone(cy["er"])
        self.assertEqual(cy["so"], 5)
        self.assertEqual(cy["pitches"], 48)
        self.assertEqual(cy["strikes"], 30)
        self.assertEqual(pit["FAKE Eve S"]["ip"], "4.0")
        self.assertEqual(pit["FAKE Eve S"]["er"], 2)
        blob = json.dumps(result)
        self.assertNotIn(".400", blob)
        self.assertNotIn(".250", blob)
        self.assertNotIn("FAKE Zed Q", blob)
        self.assertNotIn("TEAM TOTALS", blob)
        self.assertIn("Blank RBI", result["note"])
        self.assertIn("FAKE Ada L #17", result["note"])
        self.assertIn("Blank ER", result["note"])
        self.assertIn("H is above AB", result["note"])
        self.assertIn("Mystery Club", result["note"])
        self.assertIn("AVG", result["note"])

    def test_headerless_and_empty_pdfs_keep_no_lines(self):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(headerless_pdf_bytes())
            path = handle.name
        quiet = extract_pdf(path, "FAKE Hawks 10U", "FAKE Heat 10U")
        self.assertEqual(quiet["hitting"], [])
        self.assertEqual(quiet["pitching"], [])
        self.assertIn("no batting or pitching headers", quiet["note"])

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(b"%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")
            path = handle.name
        empty = extract_pdf(path, "Home", "Away")
        self.assertEqual(empty["hitting"], [])
        self.assertTrue(empty["note"])

    def test_insurance_packet_is_not_a_box(self):
        path = ROOT / "testdata" / "packet" / "insurance.pdf"
        result = extract_pdf(str(path), "Score Hawks", "Score Heat")
        self.assertEqual(result["hitting"], [])
        self.assertEqual(result["pitching"], [])

    def test_two_numbers_in_one_column_stay_blank(self):
        words = header_row()
        words += [
            word("17", 40, y=120, width=12),
            word("FAKE", 80, y=120, width=28),
            word("Ada", 112, y=120, width=22),
            word("L", 138, y=120, width=8),
            word("3", 250, y=120, width=8),
            word("1", 300, y=120, width=8),
            word("2", 340, y=120, width=8),
            word("9", 356, y=120, width=8),
            word("1", 404, y=120, width=8),
            word("0", 462, y=120, width=8),
            word("0", 516, y=120, width=8),
        ]
        result = parse_words(words, "FAKE Hawks 10U", "FAKE Heat 10U")
        # Header row has no team name above it, so the section stays unread.
        self.assertEqual(result["hitting"], [])
        self.assertIn("unread", result["note"])

    def test_shifted_pair_under_one_header_is_blank_when_side_matches(self):
        words = [word("FAKE Hawks 10U", 36, y=80, width=120)]
        words += header_row()
        words += [
            word("17", 40, y=120, width=12),
            word("FAKE", 80, y=120, width=28),
            word("Ada", 112, y=120, width=22),
            word("L", 138, y=120, width=8),
            word("3", 250, y=120, width=8),
            word("1", 300, y=120, width=8),
            word("2", 344, y=120, width=8),
            word("9", 360, y=120, width=8),
            word("1", 404, y=120, width=8),
            word("0", 462, y=120, width=8),
            word("1", 516, y=120, width=8),
        ]
        result = parse_words(words, "FAKE Hawks 10U", "FAKE Heat 10U")
        self.assertEqual(len(result["hitting"]), 1)
        row = result["hitting"][0]
        self.assertIsNone(row["h"])
        self.assertEqual(row["ab"], 3)
        self.assertIn("Two numbers under H", result["note"])

    def test_invalid_ip_third_stays_blank(self):
        words = [word("FAKE Heat 10U", 36, y=80, width=110)]
        for text, x in (("#", 40), ("Player", 80), ("IP", 250), ("H", 310), ("R", 360), ("ER", 410), ("K", 460)):
            words.append(word(text, x, y=100, width=max(10, 7 * len(text))))
        words += [
            word("7", 40, y=120, width=10),
            word("FAKE", 80, y=120, width=28),
            word("Cy", 112, y=120, width=16),
            word("P", 132, y=120, width=8),
            word("3.3", 250, y=120, width=18),
            word("2", 310, y=120, width=8),
            word("1", 360, y=120, width=8),
            word("1", 410, y=120, width=8),
            word("4", 460, y=120, width=8),
        ]
        result = parse_words(words, "FAKE Hawks 10U", "FAKE Heat 10U")
        self.assertEqual(len(result["pitching"]), 1)
        self.assertIsNone(result["pitching"][0]["ip"])
        self.assertEqual(result["pitching"][0]["h"], 2)
        self.assertIn("IP for FAKE Cy P #7", result["note"])

    def test_ip_third_and_combined_pitches(self):
        words = [word("FAKE Hawks 10U", 36, y=80, width=120)]
        for text, x in (("#", 40), ("Player", 80), ("IP", 240), ("H", 300), ("ER", 360), ("P-S", 430)):
            words.append(word(text, x, y=100, width=max(12, 8 * len(text))))
        words += [
            word("12", 40, y=120, width=14),
            word("FAKE", 80, y=120, width=28),
            word("Cy", 112, y=120, width=16),
            word("P", 132, y=120, width=8),
            word("0.2", 240, y=120, width=18),
            word("1", 300, y=120, width=8),
            word("0", 360, y=120, width=8),
            word("41-27", 430, y=120, width=28),
        ]
        result = parse_words(words, "FAKE Hawks 10U", "FAKE Heat 10U")
        row = result["pitching"][0]
        self.assertEqual(row["ip"], "0.2")
        self.assertEqual(row["er"], 0)
        self.assertEqual(row["pitches"], 41)
        self.assertEqual(row["strikes"], 27)


if __name__ == "__main__":
    unittest.main()
