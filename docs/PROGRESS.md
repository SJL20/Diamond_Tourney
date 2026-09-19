# Progress board

The running answer to "where is this thing?" Read this before you read code.

`SOFTBALL-PLATFORM-BOT-OUTLINE.md` is the spec and does not change often.
`AGENTS.md` is the rulebook for agents. **This file is the state.**

## How this file gets maintained

- The Cloud Agent updates it at the end of every working session, in the same
  pull request as the code it describes. No separate bookkeeping commit.
- Every claim here is either verified or labelled **unverified**. If you cannot
  point at a test, a command, or a file, say so.
- Findings get struck through and moved to *Closed* when they are fixed. They do
  not get deleted — the next person needs to know it was once broken.
- No timelines. Effort is described as which files change and what could break.

---

## Right now

| | |
|---|---|
| Default branch | `main` |
| Repository | **public** — assume anything committed or served is world-readable |
| Stack | PocketBase 0.40.4, one box, serves `pb/pb_public/` |
| Local URL | `bash scripts/local-server.sh` → http://127.0.0.1:8097 |
| Live URL | https://www.diamondtourney.com (Fly app `diamond-tourney`) |
| Tests | 95 unit/integration cases + 13 acceptance checks |
| CI | `.github/workflows/ci.yml` → `scripts/ci.sh`, on every push and PR |
| Deploy | `.github/workflows/fly.yml` → `flyctl deploy --app diamond-tourney` on push to `main` |

Roughly 4,000 lines of PocketBase hooks, 1,700 lines of migrations, and 2,800
lines of browser JS. Complexity concentrates in three files — `schedule.js`,
`host.js`, and `main.pb.js` are about two thirds of the server logic.

Run everything with:

```bash
bash scripts/ci.sh
```

## Build phases

Phases are from outline §10.

| Phase | State | Notes |
|---|---|---|
| 0 — Box lives | **Done** | Collections, demo team, login, FAKE players |
| 1 — One real team book | **Done** | `scripts/acceptance_test.py` is green on all of outline §15 |
| 2 — Region hub | **Partial** | `/find`, `/year/{year}`, `/teams/{slug}` exist. Outline §2 still lists `/tournaments`, `/fields`, `/news`, and `/join`, which are not routed |
| 3 — First tournament site | **Mostly live** | Native create, Tourney Machine link, CSV import, signup, auto-schedule, bracket desk, rain desk, four stats doors, leaders, awards. Seeded public events: Keystone Clash 2026 and Harbor Eight (FAKE) |
| 4 — Scale | **Not started** | Family logins, player cards, rain texts (Resend), CSV export |

## Open findings

Ranked by what would hurt most on a live weekend.

### 1. Any account can administer any tournament — **closed**

See *Closed*. Director writes require `events.created_by`, a listed co-owner, or site admin.
`event_td` still lets a new account create a weekend of their own.
The owner (or site admin) adds co-owners by email on tournament setup.
Those addresses stay off public pages.

### 2. Keystone import stores zeros for numbers the popup never published — **open**

`upsertHitting` and `upsertPitching` in `pb/pb_hooks/keystone.js` write `0` for
fields the public popup does not carry — `r`, `bb`, `so` on hitting, and `h`,
`r`, `bb` on pitching. A stored `0` is indistinguishable from a real zero.
`er` is worse: it is back-computed from the published ERA and rounded,
`Math.round((era * innings) / 7)`, so it is a number nobody published.

Outline §1 says an unreadable cell becomes `null` plus a QC note, never a guess.
These rows feed `eventLeaders` and the `/year/{year}` board.

This needs an owner decision before a fix, because the columns are non-null
number fields — making them honest means either nullable fields or an explicit
"not published" marker, and either choice changes what the stats board renders.

### 3. Approving staging outside the API route does nothing — **open**

`applyStaging` in `pb/pb_hooks/softball.js` is what copies a staged game into
`team_games`, `hitting_game`, and `pitching_game` and rebuilds the record. It
only runs from `POST /api/coach/staging/{id}/decision`.

A coach or region admin who instead PATCHes `staging_games.status` to
`approved` through plain PocketBase REST gets a row that claims to be approved
with no live stats behind it, and no error. The bot is correctly blocked from
this path; a human is not.

### 4. The metric formulas exist in five places — **open**

`AGENTS.md` says do not change metric formulas. They are currently easy to
change by accident, because each one is written out more than once:

| Where | What |
|---|---|
| `pb/pb_hooks/softball.js` | season book, canonical server copy |
| `lib/metrics.py` | bots and tests |
| `pb/pb_public/js/metrics.js` | browser |
| `pb/pb_hooks/diamond.js` | tournament leaders — own `ba()` and `era()` |
| `pb/pb_hooks/year.js` | year board — third ERA |

`pb/pb_hooks/keystone.js` adds a fourth ERA usage in reverse. IP thirds are
also re-derived inline in `diamond.js` and `year.js`.

Only the Python copy and `/api/metrics/preview` are covered by tests, so the
JavaScript copies can drift without CI noticing. The cheap first step is a
parity test that asserts all surfaces agree on the same inputs.

### 5. Tournament player identity does not follow the outline key — **open**

`upsertPlayer` in `pb/pb_hooks/score.js` builds a name key as `"Name #jersey"`.
The outline requires `Firstname LastInitial #jersey`, for example
`Evelynn M #17`. `lib/metrics.py` has a correct `name_key`; the hook does not
use it. This is how the same player ends up as two rows across weekends.

### 6. The hosted sync fails silently — **open**

The `hosted-gc-tm-sync` cron in `pb/pb_hooks/main.pb.js` wraps its work in
`catch (err) {}`. A sync that stops working looks identical to one that has
nothing to do. There is a `sync_log` collection already; the cron should write
its failures there.

### 7. No test drives the browser — **open**

CI covers the API surface well and the UI not at all. There is no test for SPA
routing, the chrome bars, the director desk, or the season book pages, and no
direct unit tests for the hook modules.

### 8. Docs disagree with the code — **open**

- `README.md`'s page table omits the whole season book (`/teams/{slug}/...`),
  `/login`, `/register`, `/account`, `/admin/teams`, `/t/{slug}/leaders`, and
  `/t/{slug}/pools`. Signup-requires-GC is closed: `docs/DIAMOND-TOURNEY.md`
  now matches the optional-URL code.

### Closed

- ~~**Anyone with `event_td` could administer any tournament.**~~ Registration
  still assigns that role so a new account can create a weekend. Director
  writes now require `events.created_by`, a listed co-owner, or site admin.
  REST collection writes were locked the same way. The owner adds extra
  directors by email on tournament setup; public board / Find never include
  those addresses. Covered by
  `AccountAndYearTests.test_stranger_event_td_cannot_run_someone_elses_weekend`
  and `AccountAndYearTests.test_owner_adds_co_owner_by_email`.
  Fixed in this branch.

- ~~**Anyone could download a child's birth certificate.**~~ `GET
  /api/events/{slug}/roster` needed no credentials and returned
  `packet.docs[].url` for every team; `/plan` and `/event/{slug}/board` did the
  same. `event_teams` and `club_teams` served `contact_email` to anonymous
  REST. `team_docs` let any account list every event's packet. Fixed in
  [#1](https://github.com/SJL20/Diamond_Tourney/pull/1); covered by
  `PacketPrivacyTests`.
- ~~**CI had never passed.**~~ `scripts/ci.sh` ran the tests before starting
  PocketBase, so 19 of 25 died on connection-refused on a clean runner. It
  looked green locally only because the Cloud Agent `start` script leaves a
  healthy listener on `:8097`. Fixed in
  [#1](https://github.com/SJL20/Diamond_Tourney/pull/1).

## Owner decisions still open

From outline §12, plus what this session added. These block work, so they are
worth answering before the next session.

1. Region display name. Public product URL is **www.diamondtourney.com**. SMTP is PocketBase Admin mail + Cloudflare SPF/DKIM — no secrets in git.
2. First live team: name, slug, age group. `hawks-10u` is a placeholder.
3. First tournament: name, dates, field complex.
4. The `team_coach` email for the first real team.
5. ~~Pool tiebreak order~~ — directors can reorder, remove steps, and set a
   chain per pool. Default is record (tie = half), group-aware H2H, fewest RA,
   run differential, most RS. Presets: head-to-head first, runs first.
6. **New — finding 2:** for a weekend imported from a public popup that does not
   publish R, BB, SO, or ER, should the board show blanks or should those games
   stay out of the leaders entirely?
7. ~~**finding 1:** one owner per event, plus site admin.~~ Owner (or site
   admin) adds co-owners by email on tournament setup. Co-owners get the Admin
   tab. Only owner / site admin add or remove. Public pages never list those
   emails. Archive/delete stays site admin.

## Session log

Newest first. One entry per working session: what changed, what was proved, and
what the next session should pick up.

### 2026-09-19 — BACKLOG 21–24 box mail, two-book scores, assist, team pages

Cron `box-score-ask` emails both coaches a one-game token after
`start + game_length + 15`. Tokens work with no login. First book posts
`score_source=one_book`; a mismatch hides public runs (`conflict`, not a fake
0-0); agreement or a director pick marks `verified`. Assist is GET-only with
three questions and shown arithmetic. `/t/{slug}/team/{team-slug}` is the
forwardable team card; names on standings, schedule, games, bracket, and stats
link there. Public team JSON was checked logged-out — no coach email or phone.
SMTP still needs Fly Admin + SPF/DKIM (item 1). GameChanger menu names are not
invented. Item 26 is untouched. Covered by `BoxScoreTeamPageTests`.

### 2026-09-19 — open backlog 10–19 and scheduler format save

One PR for the remaining product items. Pin nudge lat/long is gone; `/directors/new`
shows the field-map desk (PDF accepted). CSV create defaults to `pool-to-bracket`
with `scheduler.origin = imported`. Info dates come from the event start/end;
East End parking copy is Keystone-only. Standings print no seeds or “name order”
before a final. Empty board tabs are role-aware. Draw-from-standings refuses with
zero finals; empty TBD brackets and Clear bracket / Clear schedule are on the
scheduler. Format on that tab saves through `/settings` (GitHub #19). Bracket
CSV import (preview + confirm, seed/winner/loser refs, no overwrite of finals)
is on the bracket page and the scheduler. A director can publish a blank
bracket from that tab; first-round slots fill when a pool game is marked
final. Schedule/overall sort by date, time, game number, then natural field
order. Public Find looks up a slug exactly instead of scanning only the
newest 80 weekends, so a new event still appears on a busy box. The
`/year/{year}` board pages through every public weekend instead of the
first 80 names, so Keystone Clash stays on 2026 after a long test run.
The Bracket tab sets the current event before it paints director actions,
so “Publish blank bracket” still shows on a cold load. SMTP
(item 1) is still Fly Admin + Cloudflare DNS. Covered by
`BacklogOpenTests`.

### 2026-09-18 — CSV schedule upload no longer invents Clipboard Open

Uploading or pasting a schedule CSV without naming the weekend used to POST
`event_slug=clipboard-open` and the API created that tournament. Admin → Import
a grid now keeps `?into=` the current slug. Scheduler has an in-event CSV desk
that posts to `/api/events/{slug}/schedule/import` (`created: false`). The
global door-three route only opens a new weekend when `create` is true and the
name is not the sample Clipboard Open. Pitching limits on that create path
default to none. Covered by `ScheduleCsvImportTests`.

### 2026-09-18 — field rows stay 1, 2, 3

Derek’s 6:07 note: Add another field on `/directors/new` jumped 1 → 3 → 5
because `bindFieldRows` incremented its index twice. Remove left leftover
numbers frozen. Add and remove now renumber legends and `field_name_<i>` /
`field_day_<i>_…` from DOM order, so a hole cannot walk the form off the
end. Covered by `FieldRowNumberTests` and
`TournamentUiTests.test_field_rows_renumber_from_dom`. BACKLOG item 9.

### 2026-09-18 — drawing a bracket does not rewrite imported pool play

Door-three import stores `scheduler.origin = imported`. Selecting a bracket
format, checking “draw bracket,” or clicking Build pool schedule no longer
deletes those games or invents new pairings. Draw bracket from standings only
writes `bracket_games`. Covered by `ImportedScheduleBracketTests`.

### 2026-09-18 — scheduler and custom bracket use registered-team dropdowns

Director Add-one-game and Games-by-field Home/Away are `<select>` lists of
signed-up `event_teams`. Pool on that form is the pools already on those
teams. Custom bracket Home/Away stay selects; Flight and Round are selects
too. `addGame` no longer calls `upsertEventTeam` — typed names that are not
already registered return 400. Empty custom-bracket seats stay TBD. Signup
team name is still a text field. Covered by `SchedulerTeamDropdownTests`.

### 2026-09-18 — admin team edit, flights, custom bracket, field min 1

Directors can edit and remove teams on Admin → Teams (name, pool, GameChanger
URL, contacts). Public board / anonymous JSON still omit coach email and phone.
Formats now include round robin and pool-then-double-elim. Bracket levels
gold/silver or platinum/gold/silver split the overall seed list. Custom
bracket builder adds or deletes unplayed games. Venue setup defaults to one
field, add/remove as needed, minimum one, no 16-field cap. New migration
`1700000026` is additive only. `scripts/check_migration_safety.py` fails CI
if a later migration copies the Harbor KEEP/wipe. Fly `/data` is unchanged.
Covered by `AdminTeamsBracketsTests`.

### 2026-09-18 — issues + Derek backlog in one PR

Private `team_contacts` (and `import_maps`) stay closed at the collection.
Signup and the director Teams pane capture coach phone plus a second contact.
Season `teams.age_group` includes 6U/8U. Public board / Find / anonymous REST
never see those addresses. Team CSV import (Google Forms / Excel-as-CSV) maps
columns, previews, rematches on email then name, and stores the timestamp in
`registered_at`. Mail failures log to `sync_log` and return `smtp_not_configured`
instead of an empty catch. Ages, tiebreak, geocode, and venue photos were
already on `main`; BACKLOG 3/4/6/7 are ticked. Pitching limits stay visible
and default to none (BACKLOG 8 superseded). SMTP/SPF on Fly is still ops.

Covered by `IssuesBacklogTests` and the existing packet-privacy contact test.

### 2026-09-18 — Fly deploys only `diamond-tourney` from GitHub Actions

`fly.toml` named the wrong app (`region-softball`). It now says
`diamond-tourney`. The only automatic deploy path is
`.github/workflows/fly.yml`: push or merge to `main` (plus
`workflow_dispatch` on `main`), concurrency group
`deploy-diamond-tourney`, secret `FLY_API_TOKEN`, and an explicit
`flyctl deploy --remote-only --app diamond-tourney`. Do not also enable
Fly dashboard GitHub auto-deploy. `ci.yml` is unchanged.

### 2026-09-18 — owner adds co-owners by email

Tournament setup has a Co-owners block. The owner (or site admin) types an
email. That address gets the Admin tab and director writes for this weekend
only. A listed co-owner cannot invite more people. Public board, Find, and
raw REST never return the list. `event_co_owners` collection rules are
closed. Covered by `test_owner_adds_co_owner_by_email`.

### 2026-09-18 — finding 1 plus admin login / forgot / remove

Director routes and REST write rules now check `events.created_by` (or site
admin). A self-registered `event_td` cannot change Keystone settings, post
rain, read the inbox, or PATCH the events collection. They can still open
their own weekend. PocketBase `/_/` admin signs in on `/login` as site admin.
`/forgot` and `/reset` exist. Site admin can archive or delete a tournament
after typing the slug; directors cannot.

### 2026-09-18 — land PRs #1–#6 and #4 on `main`

Merged the stacked product PRs onto `main` (packet privacy, Harbor Eight,
collapsed bracket, standings/game numbers, Derek tiebreak + CSV persist,
mail/ages/photos/per-pool tiebreak) plus the GameChanger public-page monitor
from #4. Bots may poll stored public GC URLs (~5 min when live) through
`GET /api/bot/gc-monitor`. No GC login, no unofficial API.

### 2026-09-18 — PocketBase admin login, forgot password, remove tournaments

The public `/login` form tries the `users` collection first, then PocketBase
`_superusers`. The `/_/` admin password (`admin@local.test` locally) is a site
admin on the main site: account home, `/admin/events`, `/admin/teams`, and
director desks. `/forgot` and `/reset` send a reset link when Admin SMTP is on;
the API never says whether the email exists. Site admin can hide a weekend from
Find (`status=archived`, `public=false`) or delete it after typing the slug.
Directors cannot. Delete stays `region_admin` / superuser only.

### 2026-09-18 — Derek 1:16 / 1:19 live-review package

Signup confirmation, director verify + welcome, and rain/schedule emails go
through PocketBase’s mailer. If SMTP is not configured, the request still
succeeds and CI accounts stay verified. Age create/setup is a multi-select
(6U–18U plus 11U), class A/B/C, combine vs split — no auto-divisions.
Keystone is stored as combined `11U/12U-C`. Street address is geocoded;
lat/lng stay in the record and only appear under “Nudge the map pin.”
Pitching limits stay configurable and **default to none**. Venue photos
upload unpublished, strip JPEG APP1/APP2 and PNG text/EXIF, and the first
published photo is the public header. Fly already stores files on `pb_data`.
Tiebreak order is stored on the event and on each pool; steps are removable;
public standings print the configured chain. H2H grouping is still enforced
in code. Finding 1 is unchanged.

### 2026-09-18 — Derek / Claude email fixes

`install-pocketbase.sh` maps `uname` (`linux_amd64`, `darwin_arm64`, …). A
`.devcontainer` installs PocketBase and forwards **8097**. Pool standings now
use win% (tie = half) and group-aware head-to-head: a 3-team cycle skips H2H
and goes to RA, then run differential. Directors reorder that list on create
and Admin setup. Each seed has a “why this seed” line. **Duplicate a weekend**
copies fields, clubs, and the unpaid schedule — not scores, boxes, or family
contacts.

Fly already mounts `pb_data` at `/data` (`fly.toml`). No volume change.

Finding 1 (any `event_td` can admin any event) is still open and is still the
live-standup blocker.

### 2026-09-18 — Standings tab, game numbers, save toast

Tournament nav now has **Standings** at `/t/{slug}/standings` (old `/pools` still works).
Every pool and bracket game gets a weekend `game_number` (`Game 7`) assigned on
create and backfilled by `1700000019_game_numbers.js`. The number shows on
Schedule, Games, Admin, the game page, and bracket cards.

Any successful save shows a toast on the page (`flashSaved`). Choosing a
box-score PDF or photo queues it immediately — no second button. A GameChanger
box URL saves when the field blurs.

### 2026-09-18 — Bracket cards start collapsed

Director field, time, sides, and score controls on `/t/{slug}/bracket` now
start closed on every game, including unset slots. The old card opened
"Set field and time" and left the 0–0 final row on the face of the card,
which stretched a four-game quarterfinal column to a couple thousand
pixels. `BracketCardTests.test_match_card_starts_collapsed` locks the
markup. Closed `<details>` also hide their forms in CSS so
`display: grid` on the desk cannot keep the settings visible.

Same desk: scheduler checkboxes persist on `events.scheduler` before
"Build pool schedule" or "Draw bracket", so a redraw shows what the
director just chose.

### 2026-09-18 — Harbor Eight practice weekend

Public board is now two events: Keystone Clash 2026 and Harbor Eight (FAKE).
Central Saturday and leftover test weekends are deleted by
`1700000017_harbor_eight.js`. Harbor Eight is eight labeled-FAKE clubs in two
pools, a Saturday round-robin with no scores, and an empty Sunday bracket. No
player lines. Each club has a `team_coach` login in `scripts/local-accounts.txt`
(`coach.oaks@local.test` / `CoachOaks1!` and the seven siblings).

### 2026-09-18 — first review session

Read the repo end to end and ran everything.

- Baseline: 25 unit cases and 13 acceptance checks passed locally, but the
  GitHub `ci` workflow had never passed. Root cause was ordering in
  `scripts/ci.sh`. Fixed; confirmed on a clean clone with no `pb_data`, no
  PocketBase binary, and nothing listening on the target port.
- Found and closed a chain that let an anonymous visitor download a child's
  birth certificate from any public event. Before and after on a pristine `main`
  database: 3 of 11 privacy checks passed, now 11 of 11.
- Proved finding 1 by registering an account and editing the Keystone Clash
  event with it. Restored the data.
- Added this board, `CONTRIBUTING.md`, `SECURITY.md`, and the GitHub templates,
  since collaborators are joining.

Next session should start on finding 1. It is the last thing in this list that
can embarrass the product in public during a live weekend.
