# Skill — Bot A Team Stat Ingest

Follow `SOFTBALL-PLATFORM-BOT-OUTLINE.md` §§1, 6, 7, 9.

## Trigger

New GameChanger screenshot, pasted box, PDF, text file, **or** a public GameChanger URL from `GET /api/bot/gc-monitor` for a team slug.

## Steps

1. Read the box (drop folder / Slack / public GC page). Do not invent numbers. Unreadable cell → `null` + QC note.
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
6. Watch list: `python3 scripts/bot_gc_monitor.py --list` (club / season rows write here; event rows are Bot C).
7. Notify the coach: “review game vs {opponent}”.

Public GameChanger URLs only (hosts `gc.com`, `web.gc.com`, `gamechanger.io`). Do not log into a private GC account.

## Forbidden

Approve staging. Delete approved rows. Create a second player when the name does not match — set `needs_player_link`. Invent stats. GC login.
