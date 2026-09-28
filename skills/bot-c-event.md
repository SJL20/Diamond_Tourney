# Skill — Bot C Tournament Board

Follow outline §§1, 8, 9.

## Trigger

During an event window: a final score or box arrives (Slack `#event-scores` or webhook), **or** the ~5 minute GameChanger monitor cycle while the event status is `live`.

## Steps

1. Auth as `bot`.
2. List work:
   - `GET /api/bot/gc-monitor` — coach-supplied public GameChanger team and box URLs to poll (`python3 scripts/bot_gc_monitor.py --list`).
   - `GET /api/bot/event-boxes` — queued GC PDFs and public box URLs. If hitting or pitching is already filled from a PDF text extract, leave those lines for the director. Read the file yourself only when the note says it has no text layer or no headers.
3. Open each public GC URL (no login). Read posted scores and lines only. Unreadable cell → `null` + QC note.
4. POST extracted lines to `/api/bot/event-box`:

```json
{
  "event_slug": "EVENT_SLUG",
  "schedule_id": "…",
  "home_runs": 6,
  "away_runs": 4,
  "gc_url": "https://web.gc.com/teams/…/schedule/…/box-score",
  "hitting": [{"side": "home", "jersey": "4", "name": "Maeve D", "ab": 4, "r": 1, "h": 2, "rbi": 1, "bb": 0, "so": 0}],
  "pitching": [{"side": "home", "jersey": "7", "name": "Sam P", "ip": "4.0", "h": 3, "r": 1, "er": 1, "bb": 1, "so": 5}],
  "parser_notes": "Read from the public box the coach stored.",
  "status": "needs_review"
}
```

CLI: `python3 scripts/bot_c_event_box.py --list` then `--event SLUG --game ID --json lines.json`. Use `--review` when QC is uncertain so status stays `needs_review`.

5. Or POST `/api/bot/event-update` for a score-only update when the public page shows a score but no readable lines.

Pool game (`schedule_id` is an `event_schedule` id):

```json
{
  "event_slug": "EVENT_SLUG",
  "schedule_id": "POOL_GAME_ID",
  "home_runs": 6,
  "away_runs": 4,
  "status": "final",
  "box": { "hitting": [], "pitching": [], "source": "gc" }
}
```

Bracket game — the id in `board.bracket` / `board.overall` where `kind` is `bracket`. Pass it as `schedule_id` (falls back to `bracket_games` when it is not a pool row) or as `bracket_id`.

Live, no winner, bracket does not advance:

```json
{
  "event_slug": "EVENT_SLUG",
  "schedule_id": "BRACKET_GAME_ID",
  "home_runs": 3,
  "away_runs": 1,
  "status": "live",
  "inning": "Bot 4"
}
```

Final. Winner is the home or away team from the runs. A tie leaves the winner blank and does not advance. `bracket_id` + `winner_id` still finalizes with that winner.

```json
{
  "event_slug": "EVENT_SLUG",
  "bracket_id": "BRACKET_GAME_ID",
  "home_runs": 6,
  "away_runs": 2,
  "status": "final"
}
```

A live post does not change a bracket game that is already final. Send `status: "final"` to correct it.

6. If only a final score exists, omit player lines and note “no box” — leaders stay unchanged.
7. Do not unlock `event_players.roster_locked`.
8. Do not edit rules text.
9. Leader gates default: min 8 AB, min 3.0 IP.
10. After a final, standings and the next bracket slot update (`advanceBracket`). Do not pick all-tournament by eye — `/t/{slug}/awards` is the number sheet.

Do not invent Friday/Saturday pool boxes or player lines the public page does not show. A PDF with a text layer is read on upload into the director review list. A scan with no text layer stays queued beside this monitor loop.
