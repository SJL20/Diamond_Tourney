# Skill — Bot A Team Stat Ingest

Follow `SOFTBALL-PLATFORM-BOT-OUTLINE.md` §§1, 6, 7, 9.

## Trigger

New GameChanger screenshot, pasted box, or text file for a team slug.

## Steps

1. Read the box. Do not invent numbers. Unreadable cell → `null` + QC note.
2. Build player lines as `Firstname LastInitial #jersey`.
3. Convert IP with `.1` / `.2` to integer outs (`scripts` / `lib/metrics.py`).
4. POST `/api/bot/ingest` as `bot@…` only:

```json
{
  "team_slug": "hawks-10u",
  "payload": {
    "date": "2026-09-06",
    "opponent": "Riverside Heat",
    "us_runs": 8,
    "them_runs": 4,
    "result": "W",
    "source": "gc",
    "hitting": [],
    "pitching": [],
    "parser_notes": ""
  }
}
```

5. CLI: `python3 scripts/bot_a_ingest.py --team hawks-10u testdata/hawks_game1.txt`
6. Notify the coach: “review game vs {opponent}”.

## Forbidden

Approve staging. Delete approved rows. Create a second player when the name does not match — set `needs_player_link`.
