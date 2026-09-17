# Skill — Bot B Team Publisher

Follow outline §§1, 6, 9.

## Trigger

Coach approved a staging game, or Sunday 20:00 America/New_York.

## Steps

1. Auth as `bot`.
2. POST `/api/bot/publish` with `{ "team_slug": "…" }`.
3. Confirm W-L came from approved `team_games` only.
4. Confirm the recap `posts` row has `public: false`.
5. List leftover `staging_games` with status `staged` or `needs_review`.
6. Ping the owner with that review list. Do not approve them.

CLI: `python3 scripts/bot_b_publish.py --team hawks-10u`
