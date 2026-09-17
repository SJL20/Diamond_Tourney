import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lib.metrics import batting_average, contact_pct, era, ip_display_to_outs, outs_to_ip_display, strike_pct
from scripts.bot_a_ingest import parse_box


class MetricsTests(unittest.TestCase):
    def test_ip_thirds(self):
        self.assertEqual(ip_display_to_outs("2.1") + ip_display_to_outs("1.2"), ip_display_to_outs("4.0"))
        self.assertEqual(outs_to_ip_display(12), "4.0")

    def test_ba(self):
        self.assertEqual(batting_average(5, 16), ".312")
        self.assertEqual(batting_average(0, 0), ".000")

    def test_era(self):
        self.assertEqual(era(2, 12), "3.50")

    def test_rates(self):
        self.assertEqual(contact_pct(4, 1), "75.0")
        self.assertEqual(strike_pct(26, 41), "63.4")


class ParserTests(unittest.TestCase):
    def test_hawks_game1(self):
        text = (Path(__file__).resolve().parents[1] / "testdata" / "hawks_game1.txt").read_text()
        box = parse_box(text)
        self.assertEqual(box["opponent"], "Riverside Heat")
        self.assertEqual(box["result"], "W")
        evelynn = next(r for r in box["hitting"] if r["name_key"] == "Evelynn M #17")
        self.assertEqual(evelynn["ab"], 3)
        ava = next(r for r in box["pitching"] if r["name_key"] == "Ava B #8")
        self.assertEqual(ava["ip_outs"], 7)


if __name__ == "__main__":
    unittest.main()
