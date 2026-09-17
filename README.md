# Diamond Tourney + Region books

Wholly hosted tournament site: start an event natively or by linking a Tourney Machine page, teams sign up with a GameChanger URL, and this host pulls those public pages. Season team books stay behind a coach login. Bots are optional leftovers for screenshot ingest — they are not required to run a weekend.

Read `SOFTBALL-PLATFORM-BOT-OUTLINE.md`, `CURSOR-GROK-INTEGRATION.md`, and `docs/DIAMOND-TOURNEY.md`.

## Run locally

```bash
bash scripts/install-pocketbase.sh
bash scripts/start-pocketbase.sh
```

Cloud Agents use `.cursor/environment.json`: `install` fetches the binary, `start` runs `scripts/ensure-pocketbase.sh` (ready, then exit), `terminals` only follow the log. Port **8097** is declared for Preview. Do not put `exec pocketbase` in `start`.

Open http://127.0.0.1:8097

| Page | What it is |
|---|---|
| `/` | Log in, create an account, or find a tournament. Logged-in users land on their account. |
| `/account` | Tournaments you run and tournaments you joined |
| `/start` | Create a tournament (native or Tourney Machine) after login |
| `/find` | Search public weekends and join with GameChanger |
| `/year/2026` | Series leaderboard — same club across weekends |
| `/admin/teams` | Site admin team profiles (region admin). GameChanger optional. |
| `/t/{slug}/signup` | Director or team signs up — GameChanger URL required |
| `/t/central-saturday` | Live demo board (pools, championship tree, consolation) |

| Role | Email | Password |
|---|---|---|
| region admin | owner@local.test | RegionAdmin1! |
| event director | td@local.test | EventTd1! |
| demo coach | coach.demo@local.test | CoachDemo1! |
| Hawks 10U coach | coach.hawks@local.test | CoachHawks1! |
| bot (optional) | bot@local.test | BotStaging1! |

Admin UI: http://127.0.0.1:8097/_/

## Ingest a box (Bot A) then publish (Bot B)

```bash
python3 scripts/bot_a_ingest.py --team hawks-10u testdata/hawks_game1.txt
# approve in /teams/hawks-10u/admin/review
python3 scripts/bot_b_publish.py --team hawks-10u
```

## Acceptance tests (outline §15)

```bash
python3 scripts/acceptance_test.py
```

Or `bash scripts/ci.sh` (starts PocketBase if needed).

## Deploy (SSL)

```bash
fly apps create region-softball
fly volumes create pb_data --size 1
fly secrets set PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=...
fly deploy
```

`fly.toml` forces HTTPS. Default-branch deploys after you connect Fly. Until a domain is chosen, use the Fly URL.

## Automations

Ready-to-paste Cursor Automations live in `automations/`. Grok Bot setup is `grok-bot/SOFTBALL-INGEST.md`. You still create them once at [cursor.com/automations](https://cursor.com/automations) (not on the Start plan).
