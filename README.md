# Diamond Tourney + Region books

Wholly hosted tournament site: start an event natively or by linking a Tourney Machine page, teams sign up with a GameChanger URL, and this host pulls those public pages. Season team books stay behind a coach login. Bots are optional leftovers for screenshot ingest — they are not required to run a weekend.

Read `SOFTBALL-PLATFORM-BOT-OUTLINE.md`, `CURSOR-GROK-INTEGRATION.md`, and `docs/DIAMOND-TOURNEY.md`.

## Run locally (full server)

```bash
bash scripts/install-pocketbase.sh
bash scripts/local-server.sh
```

That starts PocketBase on **http://127.0.0.1:8097** if it is not already healthy, then prints the Keystone Clash URLs. Do not kill a healthy listener just to “restart Preview.”

Every page has a **site bar** (Find, Year, Account, Create). Tournament pages add a second **tournament bar** under it (Home, Games, Bracket, Stats, Info, Sign up, Admin). Season books use the same split: site bar, then team-book links. The two bars do not mix.

## How to create the schedule

1. **Log in** as a director (`td@local.test` / `EventTd1!` locally) and open **Create → Run it here**.
2. Name the weekend, then fill **Venue, address, and fields**. Each diamond needs a name. Add a street address and/or GPS so the public board can link a map. A field without its own pin inherits the park.
3. Pick a **bracket type**: pool then single-elim, pool only, single-elim, or double-elim.
4. Open signup. Put teams in the same pool letter (`A`, `B`) so pool play can pair them.
5. On **Admin**, save fields if you added more, then **Build pool schedule**. That fills round-robin games per field without double-booking a team or a diamond. **Draw bracket from standings** (or auto-schedule does it when the format is not pool-only).
6. **Rain desk** posts a public banner and can delay times, move a day, postpone games, or close a wet field and reassign.

Games on the public **Games** tab are grouped by field. A delay keeps the original first-pitch time on the row.

| Page | What it is |
|---|---|
| `/t/{slug}` | Tournament home — site bar on top, tournament bar under it |
| `/t/keystone-clash-2026` | Hosted Keystone Clash board — teams, GC links, pool records |
| `/t/keystone-clash-2026/stats` | Full published hitting/pitching board, filter by team |
| `/t/keystone-clash-2026/info` | Parking map, rules, raffle, rain-venue links |
| `/popup/index.html` | Local copy of the original popup (standings, teams, bracket, raffle) |
| `/popup/stats.html` | Original sortable stats board |
| `/popup/full-rules.html` | Full USA Softball weekend rules |
| `/popup/rain-update.html` | Sunday move to No Offseason |
| `/` | Log in, create an account, or find a tournament |
| `/find` | Search public weekends — Keystone Clash is featured |
| `/year/2026` | Series leaderboard — same club across weekends |
| `/start` | Create a tournament — fields + GPS/address, bracket type, guidelines, team packet |
| `/t/{slug}/admin` | Director desk — fields, auto-schedule per diamond, rain delay/move/postpone, packets |
| `/t/{slug}/signup` | Director or team signs up — GameChanger optional |
| `/t/central-saturday` | Live demo board (pools, championship tree, consolation) |

Keystone Clash 2026 is imported from the public popup. Directors can refresh it from `/directors/import-popup`. GameChanger URLs are stored as published; this host does not scrape GameChanger. Individual Friday/Saturday pool boxes are not on the popup, so they are not invented here.

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
