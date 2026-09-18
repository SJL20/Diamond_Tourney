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
| Default branch | `main`, deploys to Fly |
| Repository | **public** — assume anything committed or served is world-readable |
| Stack | PocketBase 0.40.4, one box, serves `pb/pb_public/` |
| Local URL | `bash scripts/local-server.sh` → http://127.0.0.1:8097 |
| Tests | 31 unit/integration cases + 13 acceptance checks |
| CI | `.github/workflows/ci.yml` → `scripts/ci.sh`, on every push and PR |

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
| 3 — First tournament site | **Mostly live** | Native create, Tourney Machine link, CSV import, signup, auto-schedule, bracket desk, rain desk, four stats doors, leaders, awards. Keystone Clash 2026 and `central-saturday` are seeded |
| 4 — Scale | **Not started** | Family logins, player cards, rain texts (Resend), CSV export |

## Open findings

Ranked by what would hurt most on a live weekend.

### 1. Any account can administer any tournament — **open**

`/api/account/register` is public, and the server assigns every new account the
`event_td` role. About twenty director routes guard on
`requireRole(["region_admin", "event_td"])`, which that role satisfies. So a
stranger can edit a tournament they have nothing to do with.

Verified against the local server with a freshly registered account:

```
self-registered stranger.8cdd6161@nowhere.test
  role assigned by the server: 'event_td'

Attempts against keystone-clash-2026, an event this account has nothing to do with:
  ALLOWED  change event settings          (venue became "STRANGER WAS HERE")
  ALLOWED  post a rain notice             (public board read "STRANGER POSTED THIS")
  ALLOWED  close someone else's signup
  ALLOWED  read the stats inbox
```

The demo data was restored afterwards.

On a live Saturday this is a stranger posting "games cancelled" on a real
tournament's public board. The shape of the fix is to stop treating a role name
as authority and check event ownership instead — `events.created_by`, plus a
backfill for the seeded events, which currently have no owner. It touches every
director route and its tests, which is why it is not folded into the packet
privacy fix.

Related, same root cause: `event_boxes` has `createRule` and `updateRule` of
`@request.auth.id != ''` (`pb/pb_migrations/1700000012_game_scores.js`), so any
account can attach or overwrite a box score on any game.

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

- `docs/DIAMOND-TOURNEY.md` says team signup requires a GameChanger URL. The
  code and `test_diamond.py` both make it optional, on purpose.
- `README.md`'s page table omits the whole season book (`/teams/{slug}/...`),
  `/login`, `/register`, `/account`, `/admin/teams`, `/t/{slug}/leaders`, and
  `/t/{slug}/pools`.

### Closed

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

1. Region display name, and the domain. Still the Fly URL until then.
2. First live team: name, slug, age group. `hawks-10u` is a placeholder.
3. First tournament: name, dates, field complex.
4. The `team_coach` email for the first real team.
5. Pool tiebreak order, if not the default (wins, losses, head-to-head, runs
   allowed, runs scored).
6. **New — finding 2:** for a weekend imported from a public popup that does not
   publish R, BB, SO, or ER, should the board show blanks or should those games
   stay out of the leaders entirely?
7. **New — finding 1:** should a director be able to invite a co-director, or is
   one owner per event enough? The answer changes the ownership check.

## Session log

Newest first. One entry per working session: what changed, what was proved, and
what the next session should pick up.

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
