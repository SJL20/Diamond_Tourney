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
| Tests | 141 unit/integration cases + 13 acceptance checks |
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
Choosing Tournament Director stores `event_td`, and that role can still open a weekend of its own. Player/Fan is the default. Team Manager runs one club.
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
PDF upload now uses that marker (`blank` on the hitting and pitching rows) for
cells the text layer left empty. Keystone rows do not.

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

### 6. The hosted sync fails silently — **closed**

See *Closed*. The hosted sync and box-score mail crons write failures to
`sync_log` instead of swallowing them.

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

- ~~**Phone Schedule showed a 7-column table that wrapped letter-by-letter.**~~
  `schedulePair` put `desktop-table` on the wrapper only, so
  `table.desktop-table` never matched and the table stayed visible under the
  iOS tab bar. The hide rule now targets `.table-wrap.desktop-table` as well.
  Phone Schedule is date-grouped game cards (home/away stacked with the
  posted score); desktop keeps the table. Same pair is used on Games and the
  team sheet. Covered by `MobileDisplayTests`.

- ~~**`POST /api/bot/event-update` inserted a new `event_boxes` row every
  time.**~~ It now upserts via `attachUpdateBox` (same schedule_row), sets
  `event`, and applies stored lines. Covered by `PressureBotTests`.

- ~~**Stats inbox had no Approve/Reject for pending event boxes.**~~ Bots post
  `needs_review` to `POST /api/bot/event-box`, but Admin → Stats inbox only
  showed Open. Directors now Approve or Reject via
  `POST /api/events/{slug}/boxes/{id}/review`. Bot role is refused. A bot
  post stays `needs_review` and does not write `event_hitting` /
  `event_pitching` until a director approves. Reject removes only the player
  lines named on that box. Season-team staging Approve is unchanged. Covered
  by `EventBoxReviewTests`.

- ~~**Anyone with `event_td` could administer any tournament.**~~ A new
  account can still choose Tournament Director, which stores `event_td` and
  can create a weekend. Player/Fan is the default. Director
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
- ~~**Account recovery and role changes were open.**~~ Registration no longer
  marks an account confirmed when mail is down. Role, team, confirmation, and
  reset tokens cannot be edited by the account that holds them. Granting
  `region_admin` or `bot` takes the verified primary site admin. Reset links
  expire. Unapproved box lines stay off the public stat tables until a
  director approves them. Covered by `AccountHardeningTests`,
  `AccountAndYearTests`, and `EventBoxReviewTests`.
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

### 2026-09-23 — Google button no longer opens a blank window

Continue with Google was calling PocketBase `authWithOAuth2` immediately. That opens an empty browser window before it checks whether Google is enabled, then closes the window. On a phone that looks like a blank screen that returns to the page. The live site still has Google turned off: `GET /api/collections/users/auth-methods` returns `oauth2.enabled` false and no providers. The button now checks that list first. When Google is absent it writes the message under the button and does not open a window. When Google is present, the same tab goes to Google and comes back to `/login` to finish, which is the path a phone can keep open. Register these return addresses on the Google client: `https://www.diamondtourney.com/login`, `https://diamondtourney.com/login`, and `http://127.0.0.1:8097/login`. Boot still turns the provider on only when `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set.

### 2026-09-23 — Google sign-in and account type

Login and create-account offer Continue with Google next to email and password. A new account is Player/Fan unless the person picks Team Manager or Tournament Director. That same choice is on the profile and can be changed later. Site admin and bot accounts cannot change their own type. A Team Manager who switches to Player/Fan keeps the club already on the account. Opening a weekend requires Tournament Director (or site admin). Google client id and secret are not in git. Boot turns the provider on when `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are set. The redirect to register in Google Cloud is `https://www.diamondtourney.com/api/oauth2-redirect` (and `http://127.0.0.1:8097/api/oauth2-redirect` for local). Until those secrets are set, the button says Google sign-in is not turned on.

Proved by `AccountKindTests` in the diamond suite. A browser pass covers the register choice, the Google button, and saving a new account type on the profile.

### 2026-09-22 — Site admin can edit and delete any master team

`/admin/teams` gives each master team a Details button. Opening it loads the name, age, coach name, GameChanger link, private coach email and phone, second contact, and co-owners, then saves them. The list does not show those emails. Remove deletes that master team even when it has a roster, a season book, or a weekend with a final score. The weekend entry and that team's games on the weekend go with it. A director still cannot remove a weekend team that already has a final score.

Proved by `test_site_admin_attaches_leftovers_and_removes_duplicates` and `test_site_admin_removes_a_team_that_has_a_final_score`. A browser pass opens Details, saves a coach phone, and removes a roster team.

### 2026-09-22 — Attach leftovers can point at a chosen master

Each leftover group on `/admin/teams` still starts on the suggestion: the same GameChanger link, the exact same name, a new master team, or left unlinked when that name already belongs to more than one master. A site admin can switch that row to a different master team, force a new master team, or leave it unlinked. The button still runs only when they confirm it.

Proved by the choice override in `test_site_admin_attaches_leftovers_and_removes_duplicates`. A browser pass shows the suggestion selected and a typed pick of another master team.

### 2026-09-22 — Site admin can clean teams and attach leftovers

`/admin/teams` is still the Teams screen. A site admin can rename a master team and a year-board profile, and can remove a duplicate. Removing a year-board profile leaves the weekend row and its scores. Removing a master team is refused when that team has a roster, a season book, a score sheet in review, or a final game. An empty duplicate is deleted. Its weekend rows stay, with the master link cleared.

Attach leftover teams is a button on that page, not a migration. It runs only when a site admin confirms it, after they delete weekends that should not be copied (the test tournament, Keystone Clash). A shared GameChanger link, or the exact same name, becomes one master team. Hawks and Hawks 10U stay separate. A name that already matches more than one master team is skipped. Coach email is copied onto the private season contact. The public team row does not gain an email. Scores and player lines are not written.

Proved by `test_site_admin_attaches_leftovers_and_removes_duplicates` in the diamond suite. A browser pass covers the Teams page: the attach preview, removing a year-board profile, and the roster block on a master team.

### 2026-09-21 — Master team holds the club

The master `teams` row keeps the name, age, coach name, and public GameChanger link. Coach email, phone, a second contact, and a pending owner email stay on private `team_contacts`. Co-owner emails stay on private `team_co_owners`. A coach joins a weekend with the team already on the account. A director creates the team, adds it to the weekend, and passes ownership with `POST /api/teams/{id}/transfer`. An email with no account yet is stored as pending and attaches when that person registers and confirms. Old Keystone and Harbor rows still keep a blank `event_teams.team`. The September 21 database overview (passwords, backups, unique indexes, score locks) was read with this change. Those items need the owner or a separate pass. This change does not rotate production logins or turn on backups.

Proved by `test_master_profile_and_email_handoff` in the diamond suite and the acceptance checks. A browser pass covers the one-button join and the director create-and-hand-off form.

### 2026-09-21 — Master team before event signup

`teams` is the one team record. A coach creates it on the account page
(`POST /api/teams`) after the email is confirmed. A director creates it, then
picks it, on the event signup page. `event_teams.team` points at that row.
Signup with no master id is refused. CSV import writes the master row first,
then the weekend row. The map of every collection, including the unused ones
(`inquiries`, `orgs`, `seasons`), is `docs/DATABASE.md`.

`club_teams` is still the year-board and follow target for weekends that have
no master link. Old Keystone and Harbor rows were not guessed onto a master
team. `/admin/teams` still edits `club_teams`.

Proved by the diamond suite and acceptance checks. A browser pass
on a new weekend refused signup until a team existed: the director saved
Harbor Lights 10U and then picked it, and a coach saved Coach Lights 10U on
the account page and joined with that record. Both board rows store
`event_teams.team`.

### 2026-09-21 — PDF text extract on upload

A GameChanger-style PDF with a text layer is read when it is uploaded. Column
headers pick the cells (name, number, AB, H, RBI, IP, ER, strikeouts, and
pitches or strikes only when that header is on the page). Season columns such
as AVG, OBP, OPS, and ERA are left off the game lines. A blank cell stays
blank. A real 0 stays 0. The lines go to Approve stats as `needs_review`. The
bot still cannot approve them. A scan with no batting or pitching headers stays
queued, and the director checkbox can still accept that file as the book of
record. Two typed run totals on a coach link are not replaced by the PDF.
Bracket-only uploads are not extracted, because a box row needs a schedule game.

PocketBase number columns are `NOT NULL DEFAULT 0`, so a blank cannot live in
the number itself. Migration `1700000036_blank_stat_cells.js` adds a `blank`
list on `event_hitting` and `event_pitching`. The public board treats a listed
field as empty (an em dash), not as 0. Finding 2 is unchanged: Keystone popup
rows still store 0 for numbers that page never published.

`LadyDukesWPA2033_vs_NorthStars11UFisher_Sep_19_2026.pdf` is a side-by-side
GameChanger sheet. Both teams sit on one header line. That file is now read:
18 batting lines and 5 pitching lines, totals skipped, HR left off, and the
P-S footnote is not copied because it is not a column. Clipped names
(`C McWill`, `S Tortori`, `L Bruck`, `Cassidy`) are completed only when the
same page prints the longer name. The other two Downloads PDFs are still not
on this machine. Production image installs `poppler-utils` and `python3` and
copies `scripts/pdf_box_text.py`.

The combined suite is 134 unit/integration cases. Acceptance is still green. The two account-home checks look for Keystone inside a 200-event window. This machine's database is past that window, so those two miss it here. A fresh run is not.
A browser pass on the local game page uploaded that sample PDF, showed Ada’s
RBI as an em dash next to Dee’s real 0, and after Approve stats the full board
kept that split. Cy’s blank earned runs showed as an em dash, not 0.00.
The North Stars sheet was uploaded on a local game page the same way. Approve
stats showed 18 batting lines and 5 pitching lines, still `needs_review`.
Lucy C is 1.2 IP with 6 earned runs, and the card shows youth ERA 25.20.
Bruckner’s real 0 earned runs shows 0.00. The PDF’s 9–3 was not written as
the game score.

### 2026-09-21 — Mobile site-admin account would not load

`/account` showed **Could not load this account** after a successful login
when `GET /api/account/home` was not 200. After the bracket updates, a site
admin home mapped every weekend through full `eventJson` (bracket plan,
fields, packet). That is too much for a phone. The page also used three
PocketBase clients, so a phone that reloads after the password manager saves
could send an empty `Authorization` header.

Account and admin lists now return slim cards. One shared client keeps the
token in memory, `localStorage`, and a first-party cookie, and sends
`Bearer`. Superuser home no longer throws on missing `display_name` / follow
rules. If the primary site-admin address already has a `users` row, boot
promotes it to verified `region_admin`. Day-to-day admin is still that
verified address, not a new `/_/` superuser. The address is not added to a
public page.

Covered by `test_account_home_site_admin_cards_are_slim` and
`test_region_admin_account_home_is_site_admin`.

### 2026-09-21 — Stats sort and follow a team or tournament

The full stats board (`/t/{slug}/stats`) and the Keystone popup stats page
sort hitting by hits, average, OPS, or RBIs. Average is the default, highest
first. Pitching sorts by innings, ERA, strikeouts, or wins. ERA is the
default, lowest first. A scorebook that did not publish OPS or wins shows an
em dash, and that blank sorts last. Nothing is stored as a guessed 0. Leaders
and awards stay ranked by average and ERA.

A login can follow a public tournament or a team. Following a team adds that
login to the team's fan list. The account page lists tournaments followed
directly and tournaments a followed team is in. Fan rows live in `follows`
(`1700000035_follows.js`). Collection rules are closed, so the list API cannot
read someone else's address. Public team pages still omit email, phone, and
birthdate. This pass does not email the fan list.

Covered by `FollowAndStatsTests` (121 cases, acceptance still green).
A first list call came back empty because PocketBase rejected sorting
`follows` on `created`; that field is not on this collection. The list now
uses an unsorted filter. A browser pass on the local board confirmed the
popup and `/t/keystone-clash-2026/stats` open hitting on average and pitching
on ERA, the other sort keys reorder the rows, win cells stay an em dash, and
a login that follows Keystone Clash and Pittsburgh Passion sees both on the
account page. The public team page does not show an email.

### 2026-09-21 — Create-account password confirm and verification mail

Creating an account asks for the password twice and refuses a mismatch.
The confirmation email is sent in that same request. The new login opens
`/account` immediately, and that page has **Update your password**. The
confirmation page waits for **Confirm my email** so a mail preview does not
spend the link.

Live mail was refused because PocketBase still used `support@example.com`.
Resend accepts `noreply@diamondtourney.com`. That sender is saved on the Fly
volume, and migration `1700000034_mail_sender.js` replaces an `@example.com`
sender on the next boot. A confirmation to a test inbox arrived from
`noreply@diamondtourney.com`. Local tests still have SMTP disabled, so they
still expect `verify_reason=smtp_not_configured`.

`ladydukeslafever@gmail.com` is not a login on the live site. The address has
to be created on `/register`. The PocketBase `/_/` break-glass login is still
the seeded local superuser; change that password in `/_/`.

### 2026-09-21 — Account hardening

Confirmed email is required before a director opens a weekend, posts a score,
or sees a team contact or packet. New accounts stay unverified when mail is
not configured. Public user creation is closed. A user cannot change their own
role, team, confirmation flag, or reset tokens. Only the verified primary
site-admin address can grant `region_admin` or `bot`. Other verified site
admins can assign a team and the ordinary roles. Password reset tokens expire,
one superuser reset row is kept, and the forgot-password response says when
mail is not configured. Register, login, forgot, reset, and resend are rate
limited. Archived weekends and unapproved boxes are not on the public list.
Hitting and pitching lines publish only after a non-bot approval. New
tournaments start with auto-sync off. List caps on a weekend's games, teams,
and stat lines are higher so a full bracket is not silently cut off. Sync and
box-mail cron failures are written to `sync_log`.

The PocketBase `/_/` superuser stays the break-glass login. If the primary
address is registered before that person confirms it, a superuser has to
remove that account. Day-to-day admin does not need a new superuser screen.

### 2026-09-21 — Bracket review: consolation, DE merge, score 400, two schedulers

Owner review of the flexible-bracket desk. Seven fixes:

1. Consolation / placement games are opt-in on the bracket card. Scheduler
   JSON no longer defaults `consolation` to true, and a draw does not add
   3RD/5TH/7TH unless asked.
2. Double elim builds a real losers tree. Winners final is `WF`. Losers
   drop through `L1…LF`. Championship `F` is WF winner vs LF winner.
   IFN is the rematch when the losers-side wins. 8-team is 14 games
   without IFN, 15 with IFN.
3. `event_schedule.scored_by` is a `users` relation. Superuser and other
   non-`users` auth ids are skipped instead of 400
   `validation_missing_rel_records` (Harbor Eight score as PocketBase admin).
4. Specific-seed list is gone from the card. Seed *range*, pool finish,
   size, and a team list stay.
5. Weekend format is pool-then-bracket / pool only / round robin / bracket
   only. Single vs double lives on the card. Legacy `pool-double-elim`
   still draws losers if the card has no format.
6. Admin rail splits **Pool scheduler** and **Bracket scheduler**.
   `#admin-scheduler` opens the pool tab.
7. Combo coverage: SE 4/6/8, DE 4/6/8, 8-team + IFN, no consolation unless
   asked, superuser score.

28b / 29 / 31 stay open. Harbor Eight seed consolation games were not
edited. Covered by `scripts/test_brackets.mjs` and
`test_pool_double_elim_draws_losers` /
`test_empty_single_elim_has_no_consolation_unless_asked` /
`test_eight_team_de_merges_and_superuser_can_score`.

### 2026-09-20 — BACKLOG vs Derek’s 22:20 Scarecrow mail

Derek’s latest Claude mail said 25 / 26a / 26d / 30 were still at zero on the
pre-#37 `main`. Those four plus 26i extras are on `main` as `4b7a769`.
`docs/BACKLOG.md` now matches: 26a–26h headings are `[x]`, leftover product
is 28b / 29 / 31, leftover 26 extras are drag-reorder / re-seed-between-rounds
/ field-hours warn, leftover ops are SMTP, Keystone CSV E2E, scarecrow
empty-bracket clear, and owner GameChanger screenshots.

### 2026-09-20 — Flexible brackets: count, name, custom split

Derek’s Claude note listed Scarecrow as blocked on 25 / 26a / 26d / 30 / 26i.
Item 25 was already on `eventJson` / `/plan` / `/board` (Claude grepped the
wrong file). This PR adds `events.bracket_plan` and a director flow of
**one bracket by default, then add more → name each → custom split for each**.
On a phone the card shows name and size first; pairing, byes, and diamonds
sit under More settings. Add another sits above the cards so the first tree
does not bury it. Remove is a 44px control inside the card, not a fieldset
legend on the dashed border. Inputs are 16px. There is no automatic even
split. A Gold / Silver key without sizes now
refuses to draw and tells the director to assign a size, a seed range, a
pool-finish range, or teams. Each card also sets seed mode (reseed vs keep overall), pairing,
bye mode (top seeds or picked seeds), fields, and format.

Byes are `status=bye` records: no game number, field, time, schedule row, or
coach email. Six teams in an eight-slot tree give byes to seeds 1 and 2.
Custom builder seats accept `seed:N`, `winner:G1`, `loser:G3`, a registered
team, or TBD — the same tokens as CSV import. Labels are scoped per flight
(both may have G1). A round that does not fit one slot spans times; the top
seed’s half plays later when that preference is on. Per-flight format,
fields, pairing, consolation, and if-necessary are stored on the plan.

Scarecrow 8/6 and Keystone 8-team 4GG DE (14 games) are test shapes, not
hardcoded product. 28b / 29 / 31 stay open. Covered by `brackets.js` node
tests and `FlexibleBracketTests`.

### 2026-09-20 — Box chip: No box / Submitted / Approved

Schedule cards only said “box” or nothing, so a director could not tell a
posted scorebook from an approved one. The board now carries `box_status`
from `event_boxes` (queued / submitted / needs_review / approved / rejected).
Phone cards put a chip on the right: **No box**, **Submitted**, **Approved**,
or **Rejected**. Desktop adds a Box column. Public JSON has no emails.

Covered by `EventBoxReviewTests` (anonymous board before and after Approve)
and `MobileDisplayTests` (`boxMark`).

### 2026-09-20 — Phone Schedule no longer letter-wraps

Live Test Run Schedule on a phone still showed Game / When / Field / Round /
Home / Away / Score as a squeezed table. The prior mobile pass already built
game cards, but `desktop-table` was on `.table-wrap` and the CSS only hid
`table.desktop-table`, so the table stayed on top and wrapped Field into
F-i-e-l-d.

Phone now hides `.table-wrap.desktop-table` and lists date-grouped cards:
game number, round, time, field, home and away on their own lines with the
posted score, then status and one action. Desktop still uses the table.
Games-by-field and the team sheet use the same hide rule. No stats invented;
scores still come from the posted box.

Covered by `MobileDisplayTests` (`scheduleCards`, `.table-wrap.desktop-table`).

### 2026-09-20 — iOS tournament tab bar, compact stats, box review

Phone still had a top tournament strip that scrolled sideways (Home through
Admin). Apple HIG wants three to five bottom tabs with labels, 44px targets,
and overflow in More — not a hidden extra page. Phone now uses Home,
Schedule, Standings, Bracket, and More (Games, Stats, Info, Sign up, Admin).
Desktop keeps the full top row, wrapping instead of scrolling.

Stats / leaders / standings / year / season hitting no longer explode into
one labeled box per cell. Phone shows iOS-style rows: name, a secondary
line, and one primary number. Desktop tables stay.

Approve stats was file/GC links only even though `listPendingBoxes` already
returns converted `hitting` / `pitching`. Directors now see those lines on
Admin → Approve stats, Overview, and the game page before they tap Approve.
Empty is honest: “No converted hitting lines yet.” File and GC stay
secondary. Bots still cannot Approve. BACKLOG 28b stays open.

Covered by `MobileDisplayTests`, `test_display.mjs` (`asLineList`), and
`EventBoxReviewTests` asserting pending boxes carry converted names.

### 2026-09-20 — One-PR mobile pass (chrome, cards, times, home)

Phone review on Harbor Eight (390×844) showed the Admin rail stretching the
page (~970px) and tables hiding Home/Away/Score behind a nested swipe. This
PR contains the whole list: sticky chrome height vars, 44px taps, safe-area,
toast under the site bar, Admin desk `<select>` under 800px, 12-hour times and
weekday dates from `display.js`, Park hours, schedule/team game cards,
card-table labels for standings/stats/books, stacked bracket rounds, and a
parent home that leads with next pitch and team chips. Field hours are
collapsed. Live-score polling (BACKLOG 28b) is not in this PR.

### 2026-09-20 — BACKLOG statuses match `main` through PR #36

`docs/BACKLOG.md` has a status board and a pending list. Items 1–25 stay as
they were (1 still `[~]` for Fly SMTP). Items 26–26i stay open. 27 and 28
are done; **28b** live scores stays open. Shipped owner requests that had no
heading are **32** (dynamic live gates, PR #30), **33** (Approve stats
findable, PRs #29 + #31), and **34** (iOS tab bar / compact stats / review,
PR #35). BACKLOG 29/30/31 are not those GitHub PRs.

Next product build is still **26 + 26i**. Do not invent GameChanger menu names
to close 21/22. GitHub issue #7 stays open (same as item 1).

### 2026-09-19 — two-bot pressure test + event-update upsert

Spun Bot A (season ingest/publish) and Bot C (event-box / event-update /
gc-monitor) as parallel processes against a fresh weekend plus Hawks.
Bots stayed out of Approve; director cleared the Stats inbox; public
board/team JSON kept coach contacts off; leaders scaled (min 4 AB after
two finals) and printed no over badge without an IP cap.

`POST /api/bot/event-update` used to `new Record` a box every time and
skip `event` / `applyBoxLines`. It now upserts through `attachUpdateBox`.
Covered by `scripts/pressure_test_bots.py` and `PressureBotTests`.

### 2026-09-19 — Approve stats is on the game, overview, and Stats tab

Directors could not find the box Approve button. It lived only on Admin →
Stats inbox, a hidden rail pane. The rail is now **Approve stats**. Overview
lists it first and repeats waiting boxes with Approve / Reject. A waiting box
also shows **Approve stats** on the game page. Logged-in directors see a
banner on the public Stats / leaders tabs that links to `/admin#admin-stats`.
Packet Approve on Teams is unchanged (that is insurance/roster files).

### 2026-09-19 — Dynamic leader gates and no “over” without an IP cap

Test Run on diamondtourney.com showed Min 8 AB / Min 5 IP and pitching counts
“Weekend limit 0.0 IP” with an over badge. Native weekends default to no
pitching cap; a 0.0 cap treated any inning as over. Counts now say “No posted
weekend inning cap” and never print over/ok unless `pitch_limit_mode` is ip or
both and the IP cap is above zero.

Live qualifying mins scale with finals played: 2 AB / 1.0 IP after the first
game, 4 AB / 2.0 IP after two, up to the Sunday awards line (8 AB / 3.0 IP).
Keystone packet mins stay as published. Awards still use 8 / 3.0. Covered by
`LeaderQualifyTests`.

### 2026-09-19 — director Approve/Reject for pending event boxes

Stats inbox (`/t/{slug}/admin` → Stats inbox) only had Open for queued /
submitted / `needs_review` boxes. Directors now have Approve and Reject,
wired to `POST /api/events/{slug}/boxes/{id}/review`. `requireEventAdmin`
plus an explicit bot-role refuse — never Bot A/C self-approve.
Approve sets `event_boxes.status` to `approved` and re-applies stored
hitting/pitching through `applyBoxLines` (upsert, no invented cells).
Reject sets `rejected` and leaves live hitting/pitching rows; there was no
existing reject-wipe pattern. `1700000030` adds the `rejected` select
value. Season `/teams/{slug}/admin/review` is unchanged.

Covered by `EventBoxReviewTests` and the Stats inbox markup check in
`TournamentUiTests`.

### 2026-09-19 — Claude 8:33: parking map href + flights persist

Derek’s 8:33 mail (Claude, on his behalf) said PR #26 left two items half-done.

Item 12b: `mapHref` was computed, but the info-page `<img>` still hardcoded
`/popup/parking-map.png` plus East End alt/directions. The image now uses
`parkingMapView` / `mapHref`. A copied Keystone `parking-map.png` packet URL
does not render on any other slug. Keystone still shows its own popup map.

Item 25 (Claude’s number, not a BACKLOG heading): board/plan already returned
`bracket_flights` via `eventJson`, and `/settings` already saved it. Auto-schedule
only persisted flights inside `if (format)`. Flights now save on that path
even when format is unchanged. A settings POST with only `bracket_flights`
is checked on both `/plan` and `/board`.

Covered by `test_info_dates_come_from_event_not_keystone_literal` and
`test_scheduler_settings_save_format_without_building`.

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
A stray backtick in the game-page score ternary (`eventGame`) left the SPA
on “Loading…” in Chrome (`Missing } in template expression`); the false
branch is one template again. Browser-verified on isolated `:8112`
(`box-card-classic`): first book 5–3 one-book, mismatch held as —, director
picked the Dukes book to verified, assist stayed GET-only.

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
