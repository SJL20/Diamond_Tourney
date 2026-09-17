# Skill — Bot C Tournament Board

Follow outline §§1, 8, 9.

## Trigger

During an event window, a final score or box arrives (Slack `#event-scores` or webhook).

## Steps

1. Auth as `bot`.
2. List work: `GET /api/bot/event-boxes` (queued GC PDFs and public box URLs). Do not scrape GameChanger from this host — open the coach-supplied public URL or PDF the director/manager stored.
3. POST extracted lines to `/api/bot/event-box`:

```json
{
  "event_slug": "EVENT_SLUG",
  "schedule_id": "…",
  "home_runs": 6,
  "away_runs": 4,
  "gc_url": "https://web.gc.com/teams/…/schedule/…/box-score",
  "hitting": [{"side": "home", "jersey": "4", "name": "Maeve D", "ab": 4, "r": 1, "h": 2, "rbi": 1, "bb": 0, "so": 0}],
  "pitching": [{"side": "home", "jersey": "7", "name": "Sam P", "ip": "4.0", "h": 3, "r": 1, "er": 1, "bb": 1, "so": 5}],
  "parser_notes": "Read from the public box the coach pasted."
}
```

CLI: `python3 scripts/bot_c_event_box.py --list` then `--event SLUG --game ID --json lines.json`.

4. Or POST `/api/bot/event-update` for a score-only update:

```json
{
  "event_slug": "EVENT_SLUG",
  "schedule_id": "…",
  "home_runs": 6,
  "away_runs": 4,
  "status": "final",
  "box": { "hitting": [], "pitching": [], "source": "gc" }
}
```

3. If only a final score exists, omit `box` and note “no box” — leaders stay unchanged.
4. Do not unlock `event_players.roster_locked`.
5. Do not edit rules text.
6. Leader gates default: min 8 AB, min 3.0 IP.
7. After a final, standings and the next bracket slot update (`advanceBracket`). Do not pick all-tournament by eye — `/t/{slug}/awards` is the number sheet.
