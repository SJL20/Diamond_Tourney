# Region Softball Platform — Agent instructions

Read `SOFTBALL-PLATFORM-BOT-OUTLINE.md`, `CURSOR-GROK-INTEGRATION.md`, and `docs/DIAMOND-TOURNEY.md` before changing anything.

Public tournament product name: **Diamond Tourney**. Season books stay behind login. Door-three wedge: import a schedule the director already has. Do not scrape GameChanger.

You are a Cursor Cloud Agent (Grok). The owner does not write HTML or SQL. You do.

## Non-negotiable (outline §1)

- Do not invent player stats. Unreadable cell → `null` + QC note. Never guess.
- Player identity key: `Firstname LastInitial #jersey` (example: `Evelynn M #17`). Never key off batting-order row.
- IP thirds: `.1` = 1/3 inning, `.2` = 2/3. Sum in outs, then convert.
- Youth ERA = `(ER * 7) / IP` when IP > 0, two decimals. ERA base is 7.
- BA = `H / AB` when AB > 0, three decimals (`.312`). Else `.000`.
- Contact% = `(AB - SO) / AB * 100` when AB > 0, one decimal.
- Strike% = `Strikes / Pitches * 100` when Pitches > 0, one decimal.
- Never double-count a game. Dedup key: `team_id + date + opponent + score`.
- Raw game rows are append-only. Rollups are computed on read or rebuilt.
- New game stats land in `staging_games` until status = `approved`.
- Public hub shows only public fields. Team books stay behind login.
- Do not publish family emails, addresses, or birthdates.
- Bots never approve their own staging. Bots never delete approved rows.
- Do not change metric formulas.

## Stack

- PocketBase 0.40 (SQLite + auth + files + REST) serves `pb/pb_public/`.
- One box, one URL. No Next.js unless the owner later asks to split a CDN frontend.
- Local: `bash scripts/start-pocketbase.sh` → `http://127.0.0.1:8097`
- Cloud Agent boot: `scripts/ensure-pocketbase.sh` (`.cursor/environment.json` `start`) makes `:8097` healthy and **returns**. Do not `exec` PocketBase from `start` — that hangs boot and Preview port-forward. `terminals` only tails logs (`--attach`).
- Production: Docker + Fly (`fly.toml`). Default branch deploys.

## Collections

Use the exact names in outline §5. Slugs are lowercase-hyphen.

## Phase defaults (until owner overrides)

- Age group: 10U
- Shared `team_coach` login (no family logins yet)
- Staging required
- Public hub: team W-L only, no player stats
- Demo team slug: `demo` (FAKE players labeled FAKE)
- First live sample team slug: `hawks-10u` until owner fills section 12

## What each bot may do

| Bot | Allowed | Forbidden |
|---|---|---|
| A ingest | Parse box, write `staging_games`, notify coach | Approve, delete approved rows, invent numbers |
| B publisher | Rebuild W-L from approved games, draft unpublished `posts` | Publish, approve staging |
| C tournament | Scores, standings, bracket, leaders | Rules text, locked rosters |
| D hub | Draft news / field notes | `public=true` in Phase 1 |
| Builder | Schema, pages, deploy, tests | Formula changes |

## Local accounts (dev only)

See `scripts/local-accounts.txt`. Never put production passwords in the repo.
