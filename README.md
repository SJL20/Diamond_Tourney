# Diamond Tourney + Region books

Public GitHub home: [github.com/SJL20/Diamond_Tourney](https://github.com/SJL20/Diamond_Tourney).

New here? `docs/PROGRESS.md` is where the project actually stands and what is
still broken. `CONTRIBUTING.md` is how to run it, test it, and open a pull
request. Found private data where it should not be? `SECURITY.md`.

Wholly hosted tournament site: start an event natively or by linking a Tourney Machine page, teams sign up with a GameChanger URL, and this host stores those public pages. Grok bots may poll the stored public GameChanger URLs (about every 5 minutes during a live event) and push readable scores onto the board. Season team books stay behind a coach login. PDF / screenshot ingest still works.

Read `SOFTBALL-PLATFORM-BOT-OUTLINE.md`, `CURSOR-GROK-INTEGRATION.md`, and `docs/DIAMOND-TOURNEY.md`.

## Run locally (full server)

```bash
bash scripts/install-pocketbase.sh
bash scripts/local-server.sh
```

The install script picks the PocketBase build for this machine (`linux_amd64` on
the Cloud Agent, `darwin_arm64` on an Apple Silicon Mac). Codespaces / VS Code
can also use `.devcontainer/` — it forwards **8097**. Production is
https://www.diamondtourney.com (Fly → PocketBase → Cloudflare). Fly already
keeps SQLite and files on the `pb_data` volume at `/data`. SMTP is PocketBase
Admin mail; put SPF/DKIM on Cloudflare. Do not commit mail passwords.

That starts PocketBase on **http://127.0.0.1:8097** if it is not already healthy, then prints the Keystone Clash URLs. Do not kill a healthy listener just to “restart Preview.”

Every page has a **site bar** (Find, Year, Account, Create). Tournament pages add a second **tournament bar** under it (Home, Schedule, Games, Bracket, Stats, Info, Sign up, Admin). Season books use the same split: site bar, then team-book links. The two bars do not mix.

## How to create the schedule

1. **Log in** as a director (`td@local.test` / `EventTd1!` locally) and open **Create → Run it here**, or **Duplicate an existing tournament** to reuse last year’s fields and unpaid schedule.
2. Name the weekend, then fill **Venue, address, and fields**. Set the **global** first-pitch and last-out window. Each diamond needs a name, and each date can be narrower — or unchecked if that field is dark. Auto-schedule will not put a game on a closed diamond or after that field’s last out. A field without its own pin inherits the park.
3. Pick a **bracket type**: pool then single-elim, pool only, single-elim, or double-elim.
4. Open signup. Put teams in the same pool letter (`A`, `B`) so pool play can pair them.
5. On **Admin**, save fields if you added more, then **Build pool schedule**. That fills round-robin games per field without double-booking a team or a diamond. **Draw bracket from standings** (or auto-schedule does it when the format is not pool-only).
6. **Rain desk** posts a public banner and can delay times, move a day, postpone games, or close a wet field and reassign.

**Schedule** is the weekend grid: pool and bracket together, sorted by date, first pitch, and field. **Games** stays pool-only, grouped by diamond. Empty bracket slots still appear on **Schedule** and **Bracket** so the field number and time stay visible.

On **Bracket**, every card shows **Field** and **Time**. A director can edit those, swap home/away, reopen a final, or move a team from one seat to another after a protest. Saving only field or time does not wipe a posted score.

**Scoring:** the director can enter or override any score from Admin or a game page. A team manager who signed that club up can post a result for their own games; those sit as submitted until the director marks them final.

## How to upload stats

Open the game (`Games` → the match, or Admin → Box). Four doors:

1. **GameChanger mobile PDF** — from the GC app, export/share the box as PDF. A team manager drops it on their game. Status is `queued` for a bot unless they also type lines.
2. **Public GameChanger box URL** — paste a public page such as `https://web.gc.com/teams/…/schedule/…/box-score`. This host stores the link. Bots poll that public page on a recurring monitor (`GET /api/bot/gc-monitor`, about every 5 minutes while the event is live) and post only numbers the page shows. No GC account login.
3. **Grok bot** — queued PDFs and links appear on Admin → Stats inbox, `GET /api/bot/event-boxes`, and `GET /api/bot/gc-monitor`. The bot (or you) posts extracted hitting, pitching, and the score to `POST /api/bot/event-box`. Local helpers: `python3 scripts/bot_gc_monitor.py --list` and `python3 scripts/bot_c_event_box.py --list`.
4. **Director PDF** — the tournament director uploads a GC export or a scorebook scan. Check “official book” if a bot should not wait on it.

Lines land in the weekend leaders only when someone (bot or person) types them. A PDF is not turned into invented numbers.

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
| `/t/{slug}/overall` | Weekend schedule — pool + bracket, field and time |
| `/t/{slug}/bracket` | Championship tree — field and time on every card; directors can edit or reorder after a protest |
| `/t/{slug}/admin` | Director desk — left rail for tournament setup, venue, scheduler, rain, teams, stats |
| `/t/{slug}/games/{id}` | Four stats doors — GC mobile PDF, public box URL, Grok bot, director PDF |
| `/t/{slug}/signup` | Director or team signs up — GameChanger optional |
| `/t/{slug}/pools` | Pool standings on their own, without the rest of the home page |
| `/t/{slug}/leaders` | Weekend leaders with the gates applied (min 8 AB, min 3.0 IP) |
| `/t/{slug}/awards` | All-tournament team, printed Sunday on the field |
| `/t/harbor-eight` | FAKE 8-team practice weekend — two pools, empty Sunday bracket, one coach login per club |
| `/login`, `/register`, `/forgot`, `/reset`, `/account` | Log in (including the PocketBase admin account), reset a password, see the weekends you run |
| `/admin/events` | Site admin — hide a tournament from Find or delete it |
| `/admin/teams` | Region admin club desk — team profiles, GameChanger link optional |
| `/directors/new`, `/directors/link-tm`, `/directors/import` | The three doors: start it here, link a Tourney Machine page, paste a schedule you already have |

Season books stay behind a coach login. They are not part of the public product:

| Page | What it is |
|---|---|
| `/teams/{slug}` | Public team card — W-L only, no player stats |
| `/teams/{slug}/home` | Coach home — record, next game, last five |
| `/teams/{slug}/roster` | Name, number, positions, bats/throws, grad year |
| `/teams/{slug}/hitting` | AB R H RBI BB SO, BA, Contact%, with team totals |
| `/teams/{slug}/pitching` | IP H R ER BB SO, pitches/strikes, ERA, Strike% |
| `/teams/{slug}/games`, `/teams/{slug}/games/{id}` | Game log and a single game's box |
| `/teams/{slug}/admin/review` | Approve or reject what a bot staged |

Keystone Clash 2026 is imported from the public popup. Directors can refresh it from `/directors/import-popup`. GameChanger URLs are stored as published; bots may monitor those public pages. Individual Friday/Saturday pool boxes are not on the popup, so they are not invented here.

| Role | Email | Password |
|---|---|---|
| PocketBase / site admin | admin@local.test | SoftballAdmin1! |
| region admin | owner@local.test | RegionAdmin1! |
| event director | td@local.test | EventTd1! |
| Harbor Oaks coach (FAKE) | coach.oaks@local.test | CoachOaks1! |
| demo coach | coach.demo@local.test | CoachDemo1! |
| Hawks 10U coach | coach.hawks@local.test | CoachHawks1! |
| bot (optional) | bot@local.test | BotStaging1! |

Admin UI: http://127.0.0.1:8097/_/

## Ingest a box (Bot A) then publish (Bot B)

```bash
python3 scripts/bot_a_ingest.py --team hawks-10u testdata/hawks_game1.txt
# approve in /teams/hawks-10u/admin/review
python3 scripts/bot_b_publish.py --team hawks-10u
python3 scripts/bot_gc_monitor.py --list
python3 scripts/bot_c_event_box.py --list
python3 scripts/bot_c_event_box.py --event SLUG --game GAME_ID --home-runs 6 --away-runs 4
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

Ready-to-paste Cursor Automations live in `automations/` (including `bot-gc-monitor.md` for the 5-minute public GameChanger poll). Grok Bot setup is `grok-bot/SOFTBALL-INGEST.md`. You still create them once at [cursor.com/automations](https://cursor.com/automations) (not on the Start plan).
