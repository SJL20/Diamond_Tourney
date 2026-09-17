# Skill — Bot C Tournament Board

Follow outline §§1, 8, 9.

## Trigger

During an event window, a final score or box arrives (Slack `#event-scores` or webhook).

## Steps

1. Auth as `bot`.
2. POST `/api/bot/event-update`:

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
