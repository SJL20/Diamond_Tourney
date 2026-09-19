# Diamond Tourney — owner backlog

Owner-filed work items from the first live review of diamondtourney.com.
Work in order. Do not reorder without asking the owner.

Each item states the constraint that matters, not just the request. Where an item
says "do not," that is a rule, not a preference — read the reasoning before
proposing an alternative.

Status: `[ ]` open, `[x]` done, `[~]` in progress.

---

## [~] 1. No email is sent when a user signs up

**Blocker for the next live event.**

Nothing sends on signup. The blocker is configuration, not code: PocketBase
defaults to a local sendmail binary that does not exist in the Fly container.
Set real SMTP credentials in Admin → Settings → Mail (Resend or Postmark). The
sending domain needs SPF and DKIM at Cloudflare or mail lands in spam, which is
worse than sending nothing.

Three emails, in priority order:

1. **Team registration confirmation to the coach** — tournament name, dates,
   venue, amount owed, link to the public page. This is what stops "did you get
   our entry?" texts to the director. Depends on item 2.
2. **Address verification** for new director accounts (standard PocketBase flow).
3. **Director welcome** after verification, linking to tournament creation.

Then add: **schedule-change notice** to every registered coach when the director
posts a delay, field move, or rain update. This replaces the group text and is
the core product promise.

Code path is live (`pb/pb_hooks/mail.js`): signup confirmation, director verify +
welcome, forgot-password, and rain/schedule notices. Failures write `sync_log`
(`signup_mail`, `verify_mail`, `rain_mail`, …) and the API returns
`mail.reason` (`smtp_not_configured` when Admin → Settings → Mail has no
sender). Callers no longer empty-catch. **Ops still required on Fly** — this
repo cannot store SMTP secrets.

- [ ] SMTP configured, test mail delivers to an external inbox
- [ ] SPF and DKIM added for the sending domain
- [ ] Coach receives confirmation on team registration
- [ ] Director accounts receive verification email
- [x] Mail failures logged, never silently swallowed

---

## [x] 2. Teams need coach email and phone — NOT on the public collection

**Blocker. Also gates item 1.**

Teams has `coach_name` and `coach_note` and no way to contact anyone. Directors
need coach **email** and **phone** when a team is added.

**The trap:** teams is defined with `listRule: ""` and `viewRule: ""`. In
PocketBase an empty string means fully public and unauthenticated.
`GET /api/collections/teams/records` returns every record to anyone. Adding
`coach_email` and `coach_phone` as plain fields there publishes every coach's
personal cell number and email to the open internet, scrapable, while the UI
looks fine.

That would also violate the AGENTS.md non-negotiable: *"Do not publish family
emails, addresses, or birthdates."*

**Do this instead** — a separate collection:

    team_contacts
      team          relation -> teams
      coach_email   email
      coach_phone   text        // text, not number: formatting and leading digits matter
      alt_name      text
      alt_email     email
      alt_phone     text
      role          select      // head coach, team manager, billing

Read and write restricted to the tournament's director, a region admin, or that
team's own coach. Never public. Public team pages keep working unchanged.

Support a second contact — whoever registers a team is frequently not the person
in the dugout Saturday.

**While in this file:** teams restricts `age_group` to
`["10U","12U","14U","16U","18U"]`. Add `6U` and `8U`. 8U events are real.

- [x] Coach email and phone captured on team add/edit
- [x] Verify with a logged-out `curl` against the API that contacts are not
      readable — do not verify by looking at the page
- [x] Director, region admin, and that team's own coach can read and edit
- [x] Optional second contact supported
- [x] Phone stored as text
- [x] `age_group` includes 6U and 8U

---

## [x] 3. Age group multi-select on the director form, spanning divisions

**Blocker for the next live event.**

No way to pick age groups when creating a tournament. Add a multi-select.

**Constraint:** do NOT create one division per selected age group. Keystone Clash
2026 ran as a single 11U/12U-C bracket — one pool, one bracket, two age groups.
Auto-splitting would have broken that event. A division must be able to carry
more than one age group.

The director makes two decisions: which age groups are in the tournament, and
whether they are combined into one division or split into several.

Age group values: 6U, 8U, 10U, 12U, 14U, 16U, 18U. Class: A, B, C (plus
Rec / Travel where it applies). Division names follow the selection —
"11U/12U-C" combined, "12U-B" single — and stay editable.

Shipped on `main` before this file was ticked. Create/setup is a multi-select
(6U–18U plus 11U), class A/B/C, combine vs split. The host does not invent a
pool per age. Keystone Clash 2026 is stored as combined `11U/12U-C`.

- [x] Multi-select on the create form
- [x] A single division can hold multiple age groups
- [x] Combined vs split is the director's choice
- [x] Division name reflects selection, editable
- [x] **Acceptance test: Keystone Clash 2026 can be recreated exactly as it ran**

---

## [x] 4. Configurable pool play tiebreaker order

**Blocker. Pairs with the grouped-tiebreaker fix.**

Directors run different rules and expect to set them, as Tourney Machine allows.
Some go to head-to-head first; others go straight to runs allowed once more than
two teams are tied.

The grouped tiebreaker fix added an `order` parameter to
`rankTeams(rows, games, order)`, currently passed `null`. This item populates it.

Store the ordered list on the **division**, not the tournament — one tournament
can run several divisions under different rules. Default:

    ["record", "head_to_head", "runs_allowed", "run_diff", "runs_scored"]

Drag-to-reorder UI, steps removable. Two presets cover most directors:
**head-to-head first** and **runs first**.

**Fixed regardless of configured order:** head-to-head applies only when the tied
group is exactly two teams, or when every team in the group played every other
team in it. This is not a preference — it is what stops a three-way head-to-head
cycle from producing different seeds on different runs. Enforce it in code no
matter where head-to-head sits in the chosen order.

Print the configured chain on the public standings page alongside the per-team
reason line the fix produces.

Shipped on `main`. Order lives on the event and on each pool. Default chain is
record → H2H → RA → run differential → RS. H2H still skips a 3+ group unless
the group is exactly two or everyone has played everyone.

- [x] Order stored per division, defaulting to the chain above
- [x] Drag-to-reorder UI with both presets
- [x] Order passed to `rankTeams` in place of `null`
- [x] 3+ way ties still skip head-to-head unless round-robin complete
- [x] Chain displayed publicly
- [x] Changing order re-seeds without re-entering scores

---

## [x] 5. Bulk team import from CSV (Google Forms export)

**High. Largest single time saver for directors.**

Most directors collect signups via Google Form, which exports CSV. Today the only
path into the teams section is one at a time.

**The hard part is column mapping, not parsing.** Every director's form differs:
"Team Name" vs "Name of Team" vs "Organization / Team". A fixed-format importer
fails on the first real file. Required flow:

1. Upload CSV
2. Detect columns, show them with sample rows
3. Map columns to fields via dropdowns, guesses pre-selected by fuzzy header match
4. Preview exactly what will be created, problems flagged inline
5. Import on confirm

Remember the mapping per director so re-import skips step 3.

Fields: team name (required), coach name, coach email, coach phone (text —
leading zeros die if parsed as a number), age group, class, GameChanger link or
ID, submission timestamp, paid, notes.

**The timestamp column matters.** Google Forms stamps every submission, and that
order is what a first-paid-first-pick track draft runs on. Map it into the
existing paid/created ordering rather than discarding it.

**Re-import will bite.** Directors upload the same file repeatedly as entries
arrive. Importing 20 rows onto an existing 14 must not produce 34 teams. Match on
coach email first, then normalized team name (case and whitespace insensitive).
Offer skip or update per match, defaulting to skip. Show counts before
committing: "12 new, 14 already present, 2 rows with problems."

Validate in the preview: missing team name, duplicates within the file, malformed
emails, rows over the division cap, unrecognized age groups. Nothing writes until
the director has seen the preview.

File handling: strip the UTF-8 BOM Excel adds; handle quoted fields with commas
and apostrophes (team names are full of both — "O'Brien's Bandits", "Smash 12U,
Gold"); accept csv and tsv, consider xlsx since directors resave the export in
Excel; cap row count.

Also worth building: a downloadable **Google Form template** with columns already
named to match. One-click import for anyone who uses it, and the form can carry a
Diamond Tourney link their coaches see.

Director desk → Teams has an importer. CSV/TSV (Excel paste or Save As CSV).
xlsx binaries are not parsed on the server — save as CSV. Template lives at
`/templates/diamond-tourney-team-signup.csv`. Covered by
`IssuesBacklogTests.test_google_forms_csv_preview_and_reimport`.

- [x] Upload with column detection and sample rows
- [x] Mapping UI, guesses pre-filled, remembered per director
- [x] Preview with per-row validation before any write
- [x] Re-import matches existing teams, no duplicates
- [x] Timestamp feeds paid/registration ordering
- [x] GameChanger link imports to the existing field
- [x] A real Google Forms export imports cleanly end to end

---

## [x] 6. Photo upload for fields and venues — on the create form

**Medium. Owner-confirmed on the live site.**

Add photo upload directly to `/directors/new`, not only to a separate venue
editing screen. A director setting up a tournament should document the site in
the same pass, not come back later.

Purpose is wayfinding: show visiting teams what they are driving to and where
things are. This replaces the draggable map pin (see item 7) — a photo of the
entrance answers "where do I go" better than a coordinate ever does.

What matters, in order:

1. **The entrance and parking lot** — the hardest thing to find at an unfamiliar
   complex, and the source of most Saturday-morning phone calls
2. **A layout map** showing which diamond is Field 1 vs Field 2
3. **The fields themselves** — surface, backstop, dugouts

Keystone Clash had a hand-made parking map for exactly this reason. This
generalizes it.

PocketBase file fields with thumbnails; nothing custom needed. Multiple images
with captions, reorderable, first used as the public page header. Cap at 2–5 MB
with server-side resizing — directors upload straight off a phone. Accept jpg,
png, webp, heic.

**Two requirements, not suggestions:**

- **Strip EXIF on upload.** Phone photos carry GPS and timestamps. Publishing
  those on a public page is a privacy leak about where children are on a given
  weekend.
- **No people in field photos.** These pages are public and this is a youth
  sports product. Put a plain line on the upload control: "Photos of fields and
  facilities only, please — no photos of players."

**Storage:** PocketBase writes uploads to local disk, which on Fly means the
mounted volume. Confirm a volume is mounted and that backups cover the files
directory, not only the database.

- [x] Upload control present on `/directors/new`
- [x] Multiple captioned photos per venue, reorderable
- [x] Server-side resize and cap
- [x] EXIF stripped
- [x] Guidance text on the upload control
- [x] Photos on the public tournament page
- [x] Uploads survive a redeploy
---

## [x] 7. Remove lat/long AND the map pin adjuster from the director form

**Medium. Owner-confirmed on the live site — supersedes any earlier note about
keeping a draggable pin.**

Remove both the coordinate inputs and the nudge-the-pin map control from
`/directors/new`. No director knows their decimal coordinates, and dragging a pin
on a small map is fiddly on a phone in a parking lot. Both are friction on a form
that should take ninety seconds.

**Keep the coordinates themselves** — parents driving to an unfamiliar complex
need a map link. Geocode the street address in the background on save and store
the result on the venue. If geocoding fails or lands imprecisely, accept it: the
uploaded parking and entrance photos from item 6 are the real wayfinding, and
they work better than a pin.

- [x] Lat/long inputs removed from the form
- [x] Map pin adjuster removed from the form
- [x] Street address geocoded on save, stored on the venue
- [x] Public page links to the address for directions
- [x] Geocode failure does not block saving the tournament

---

## [x] 8. Hide the pitching limit section for softball

**Superseded by the owner (2026-09-18).** Keep the section visible and
configurable. Default is **none**. Do not hide it for softball. Fields and
storage stay. Baseball can still turn a limit on later without a rebuild.

- [x] Hidden when sport is softball — **not done; owner asked to keep it visible**
- [x] Field and storage retained
- [x] Appears when sport is baseball — section always visible; mode defaults to none

---

## [x] 9. Field rows skip numbers on Add another field

**Medium. Derek, live review 2026-09-18 6:07 ET.**

`/directors/new` and Admin → Venue started at Field 1, then Add produced Field 3,
then Field 5. Removing a row left the leftover legends frozen, so it looked like
the click did nothing.

`bindFieldRows` advanced its index twice per click (`Math.max(...) + 1` and then
`n += 1`). The visible legend and the `field_name_<i>` input used that index.
`parseFieldRows` already reads every `field_name_N` key, so a gap did not drop
a diamond — but add/remove loops could still walk the index off the form.

Fix: drop the carried `n`. After every add or remove, renumber `.field-row`
legends and every `field_*` / `field_day_*` name from DOM order so the next
index is `rows.length` and submitted names stay `field_name_0`, `field_name_1`,
… with no hole.

- [x] Add three fields: legends 1, 2, 3
- [x] Remove the middle: remaining 1, 2
- [x] Submitted names are dense (`field_name_0`, `field_name_1`)
- [x] Twenty fields save and reload
- [x] Existing tournament fields re-save unchanged

- [x] ## [x] 10. Remove both map pin nudge controls; add a field map upload instead

**High. Owner has raised this repeatedly — it is still live on the site.**

Replaces items 6 and 7, which split this across two entries and left item 7
asking to keep a draggable pin. There is no draggable pin. Remove all of it.

### Remove — two places in `pb/pb_public/js/event.js`

**Per-diamond**, inside `fieldRow()` around lines 106–113:

    <summary>Nudge this diamond's pin</summary>
    <label>Latitude <input name="field_lat_${i}" ...></label>
    <label>Longitude <input name="field_lng_${i}" ...></label>

**Venue level**, inside `setupVenueFields()` around lines 219–227:

    <summary>Nudge the map pin</summary>
    <label>Latitude <input name="lat" ...></label>
    <label>Longitude <input name="lng" ...></label>

Remove the `<details>` wrapper, the summary, and both coordinate inputs in each
case. Remove the surrounding helper text about pins. Around line 1494 there is
already `fd.delete("field_lat_" + i)` / `fd.delete("field_lng_" + i)` — that
cleanup can go too once the inputs no longer exist.

**Keep the coordinates in the data.** Geocode from the street address on save and
store the result on the venue and field records. Directors never type or adjust
coordinates. If geocoding lands imprecisely, accept it — the uploaded map below
is the real wayfinding.

### Add — a field map upload on `/directors/new`

In place of the venue-level pin control, an upload for images that show people
where to go. This is what the nudge control was badly trying to do.

What directors will actually upload, in order of usefulness:

1. **A complex map** — which diamond is Field 1 vs Field 2, where parking is,
   where the gate is. Usually a hand-drawn or marked-up image.
2. **The entrance and parking lot** — the hardest thing to find at an unfamiliar
   complex, and the source of most Saturday-morning phone calls.
3. **The fields themselves.**

Keystone Clash 2026 used exactly this: a hand-made parking map linked from the
tournament page. This makes it a first-class feature instead of a one-off.

PocketBase file fields with thumbnails; nothing custom needed. Multiple images
per venue, each with a caption. Reorderable. First image shown on the public
tournament page. Cap 2–5 MB with server-side resizing — directors upload straight
off a phone. Accept jpg, png, webp, heic, and pdf (complex maps are often PDFs).

**Two requirements, not suggestions:**

- **Strip EXIF on upload.** Phone photos carry GPS and timestamps. Publishing
  those on a public page is a privacy leak about where children are on a given
  weekend.
- **No people in the images.** These pages are public and this is a youth sports
  product. Put a plain line on the upload control: "Fields and facilities only,
  please — no photos of players."

Uploads land on the mounted Fly volume at `/data`, so they persist across
deploys. Confirm backups cover the files directory and not only the database.

### Acceptance criteria

- [x] No "Nudge this diamond's pin" control anywhere on the form
- [x] No "Nudge the map pin" control anywhere on the form
- [x] No latitude or longitude input visible to a director, at venue or field level
- [x] Street address geocoded on save; coordinates stored, never typed
- [x] Image upload present on `/directors/new`, not only on a separate venue screen
- [x] Multiple captioned images, reorderable, pdf accepted
- [x] EXIF stripped on upload
- [x] Guidance text shown on the upload control
- [x] Images render on the public tournament page
- [x] Uploads survive a redeploy


## [x] 11. Import: admin link creates a new tournament instead of importing into the current one

**High. Owner-reproduced on the live site.**

### 11a. Wrong destination from the admin page

`pb/pb_public/js/event.js` line 2297, on a tournament's admin overview:

    <a class="btn ghost" data-link href="/directors/import">Import a grid</a>

`/directors/import` is the standalone create-an-event-from-CSV flow — it asks for
Event slug and Event name. Clicking it from inside an existing tournament creates
a second, unrelated tournament rather than importing into the current one. A
director following it during setup silently ends up with a duplicate.

**Keep `/directors/import` exactly as it is.** Starting a new tournament from a
grid is a real and wanted flow, reached from the directors landing page.

**Add the scoped version** for use from inside a tournament: same CSV parsing, no
slug or name fields, games land in the tournament the director is already in.
There is already a scoped importer to build on — `teamImportDesk()` and
`bindTeamImport(slug, ...)` — with column mapping and preview.

### 11b. Rename the label

"Import a grid" → **"Import schedule"**. Directors do not call it a grid.

### 11c. Importing must not disable brackets

The CSV import sets `format = "imported"` (`pb/pb_hooks/main.pb.js` line 714,
`pb/pb_hooks/host.js` line 588). In `pb/pb_hooks/schedule.js`, `"imported"` is
excluded from both `formatWantsBracket()` and `formatWantsPool()`, so a director
who imports a pool schedule can never draw a bracket from the standings, and pool
handling is off too.

**This breaks the core positioning.** "Bring the schedule you already have" is the
main way a director is expected to start. If importing means no bracket, they go
back to Tourney Machine for the part that matters most on Sunday.

`"imported"` describes where the games came from, not what the tournament is. It
should not be a format and should not restrict anything afterward.

**Fix:** record provenance separately — an `imported` boolean, or the existing
`source` field (`ev.source === "popup"` is already used at line 2299) — and let
the director pick a real format for an imported event, defaulting to
`pool-to-bracket`. Imported games populate pool play, standings compute normally,
the bracket draws from them.

### Acceptance criteria

- [x] `/directors/import` unchanged: still creates a new tournament from a grid
- [x] A scoped import inside a tournament loads games into that tournament only,
      with no slug or name fields and no new event created
- [x] Admin label reads "Import schedule"
- [x] An imported pool schedule produces standings
- [x] A bracket can be drawn from those standings
- [x] Provenance recorded without restricting format
- [ ] **End-to-end: import the Keystone Clash pool grid as CSV, confirm standings
      compute with correct seeds, then draw the 8-team double-elim bracket from them**


      ## [x] 12. Info page shows Keystone Clash's dates and parking map on other tournaments

**High. Owner-reproduced on /t/scarecrow-slugfest/info — wrong data shown publicly.**

### 12a. Hardcoded date fallback

`pb/pb_public/js/event.js` line 1462:

    ["Dates", packet?.dates || "September 11–13, 2026"],

September 11–13 2026 is Keystone Clash. Any tournament without a `packet.dates`
value displays Keystone's dates on its own public info page. Scarecrow Slugfest
runs September 26–28 and shows September 11–13.

Every other row in that block falls back correctly to the event's own record —
Where, Format, Questions all read from `board.event`. Dates is the only one
carrying a literal.

**Fix:** derive the dates from `board.event.start` and `board.event.end`,
formatted the same way ("September 26–28, 2026"). Never fall back to a literal
date. If start and end are missing, show nothing — an empty row is correct; the
wrong dates are not. Note the `.filter(([, v]) => v)` on that array already drops
empty rows, so returning an empty string is safe.

### 12b. The parking map is Keystone's, on every local event

Lines 1455–1459, immediately above:

    <img src="/popup/parking-map.png"
         alt="Aerial map of East End Park showing the main lot off Meadow St and the Field 2 lot.">
    <p class="muted">Both lots are marked in orange. Enter off Meadow St.
       Overflow parking is on East O'Hara St.</p>

This renders whenever `local` is true. The image, the alt text, and the
directions are all East End Park — hardcoded. A tournament at Ambridge Middle
School shows a map of a park forty minutes away, with instructions to enter off a
street that isn't there.

**This is worse than the dates.** Wrong dates look like a bug; a wrong parking map
sends families to the wrong place on a Saturday morning.

**Fix:** render this section only when the event has its own uploaded map, and use
that image and that event's directions text. This is what item 10 (field map
upload) provides — until it exists, the section should not render for any event
that is not Keystone Clash.

### Why this keeps happening

Keystone Clash was imported as the first real tournament and its values were
written inline as defaults. They are correct for exactly one event and wrong for
every other one, and they fail silently — the page renders cleanly with the wrong
information.

Worth a sweep of `event.js` and the hooks for other literals of the same kind:
East End Park, Meadow St, McDonald, specific 2026-09 dates, the Keystone contact
names. Anything that names a specific venue, date, or person should come from the
event record.

### Acceptance criteria

- [x] Dates on the info page come from the event's own start and end
- [x] A tournament with no dates set shows no Dates row, not a fallback date
- [x] Scarecrow Slugfest shows September 26–28, 2026
- [x] The parking section renders only for events with their own uploaded map
- [x] No other tournament displays the East End Park map, alt text, or directions
- [x] Grep for remaining hardcoded venue names, addresses, dates and contacts;
      list anything found

Leftovers that stay on purpose: Keystone parking / raffle / popup links are
gated on `slug === "keystone-clash-2026"`. Create-form placeholders still say
East End 1 / Meadow St. `keystone.js` dates belong to that event.
`lib/standings.py` still has `"name order"` for the season book — do not change
metric formulas.


## [x] 13. Scheduler page: purpose and button labels are unclear, and one silently deletes games

**High. Owner could not tell what the buttons did — and he is the domain expert.**

On `/t/<slug>/admin#admin-scheduler`, the two primary buttons sit side by side
with no indication that they belong to different moments in the weekend, and the
checkbox labels describe implementation rather than consequence.

### What each control actually does

- **Build pool schedule** — generates pool games across the days, hours and fields.
  Setup-time action, run once before the tournament.
- **Draw bracket from standings** — seeds by record and creates bracket games.
  Run *after* pool play is complete. A completely different moment.
- **Replace unplayed pool games** — deletes every scheduled game and rebuilds.
  Skips anything `status === "final"`.
- **Also draw empty bracket slots now** — builds the bracket skeleton with TBD
  placeholders alongside the pool schedule.
- **If you draw a bracket, include consolation games** — adds losers-bracket and
  placement games.

### Problems

**13a. The two buttons imply they are alternatives.** They are sequential and
days apart. Separate them: pool building in one section, bracket drawing in
another, ideally disabled with an explanation until pool play has results.

**13b. "Replace unplayed pool games" is mislabeled and it deletes.** The code at
`pb/pb_hooks/schedule.js` line 648 deletes *all* non-final rows in
`event_schedule`, bracket games included — not only pool games. The label
understates the scope, and "Replace" reads as harmless.

It is also checked by default. Correct during setup, dangerous on Saturday when a
director is only nudging a time. At minimum: rename to something like "Clear and
rebuild the schedule (keeps completed games)", and confirm before deleting when
any games already exist.

**13c. "Also draw empty bracket slots now" does not say why.** Reword to name the
use: it produces a printable blank bracket for the fence before teams are known.

**13d. No explanation of sequence.** One line at the top of the section stating
the order — set fields and hours, build pool, play, then draw bracket from
standings — would remove most of the confusion.

### Acceptance criteria

- [x] Pool building and bracket drawing are visually separate, not adjacent buttons
- [x] "Draw bracket from standings" explains when to use it, and is unavailable
      with a reason given until pool results exist
- [x] The replace checkbox names its real scope, including bracket games
- [x] Confirmation before deleting when the schedule already has games
- [x] The replace checkbox is not checked by default once a schedule exists
- [x] One line at the top stating the order of operations
- [x] **A director who has never used the product can tell what each button does
      without being told**

## [x] 14. Standings page publishes alphabetical seeds before any game is played

**High. Public-facing and misleading. Owner-reproduced on /t/scarecrow-slugfest.**

On a tournament with no results yet, the standings page renders all 14 teams with
seeds 1 through 14 and a stated reason for each. Every row is 0-0-0 with zero runs.

The reasons read:

    Seed 1  Athletics    — better record (tie counts as half a win)
    Seed 2  Devil Dogs   — name order
    Seed 3  Dukes 11     — name order
    ...
    Seed 14 Venom        — name order

That is alphabetical order presented as seeding. A coach opening this sees their
team ranked 13th before a pitch has been thrown, with an official-looking reason
attached.

### Two separate defects

**14a. Seed 1's reason is borrowed and false.** `pb/pb_hooks/diamond.js` line 332:

    else if (i === 0) reason = reasons[ranked[1].id] || TIEBREAK_LABELS[criteria[0]];

When no team has a reason, seed 1 takes the label of the first criterion —
"better record" — even though every team is 0-0. It states something untrue.

**14b. "name order" is surfaced as a tiebreaker.** Line 333 falls through to
`"name order"` when nothing separates two teams. Alphabetical is a stable-sort
fallback so the list does not shuffle between page loads. It is not a tiebreaking
rule and must never be shown to the public as the reason for a seed.

### Expected behavior

**Before any game is final:** the standings tab should show an empty state — the
team list with no seeds and no reasons, or a line saying standings appear once
scores are entered. Not a ranked list.

**Once results exist:** show seeds and reasons only for teams a criterion actually
separated. Where teams remain genuinely tied on every configured criterion, show
them as tied — same seed number or a "tied" marker — rather than inventing an
order. If a stable order is needed for display, sort alphabetically silently and
say nothing.

The configured tiebreak chain printed at the bottom of the page is good and
should stay.

### Acceptance criteria

- [x] A tournament with no final games shows no seeds and no reasons
- [x] The string "name order" never appears in public output
- [x] Seed 1 never displays a reason belonging to another team
- [x] Teams tied on every configured criterion display as tied, not ordered
- [x] Once one game is final, standings and reasons appear and are correct
- [x] **Check the schedule, bracket and stats tabs for the same problem — an empty
      tournament should not render authoritative-looking empty results anywhere**



## [x] 15. Board empty states ignore the viewer's role — no director actions, and admin copy shown publicly

**Medium. Public-facing. Principle applies beyond this one string.**

### The principle

The board already knows who is viewing. `pb/pb_public/js/event.js` imports
`canAdminEvent` and uses `isDirector()` throughout — a game edit desk at line
706, different bracket copy at line 985, score posting gated at line 1080.

The empty states skip it. Line 1021:

    <p class="empty">No games on the weekend board yet.
    Build pool play on Admin, then draw the bracket.</p>

Rendered identically to everyone. Two consequences.

### 15a. The director is told to go elsewhere instead of being given the action

A logged-in director looking at an empty Schedule tab should be able to act from
where they are. The screen knows they can administer the event; sending them to
find Admin is a step that does not need to exist.

Put the three routes on the screen as working controls, import first:

- **Import a schedule** — the path the product leads with, and what a director
  arriving from Tourney Machine, a spreadsheet, or paper will want
- **Build pool play**
- **Draw bracket from standings**

Same principle for the other tabs — an empty Standings should offer score entry,
an empty Bracket should offer the draw.

### 15b. A coach or parent is shown instructions they cannot act on

The same string tells a logged-out viewer to "Build pool play on Admin," a screen
they cannot reach. Anyone without admin rights should see something plain:
"The schedule isn't posted yet. Check back closer to the weekend."

### Broader pass

This is a consistency problem, not a missing feature. Every public tab should be
checked against two questions:

1. Does a logged-in director get the action inline, rather than directions to
   another screen?
2. Does everyone else see something true, understandable, and free of admin
   instructions?

Roles to consider now that they exist: site admin, event director, team manager
or scorekeeper, logged-out public. A team manager who can post their own score
needs different affordances from a parent.

### Acceptance criteria

- [x] No admin instruction text renders for viewers without admin rights, anywhere
- [x] A director sees working controls on empty Schedule, Standings, Bracket and Stats
- [x] Import is offered first among the schedule routes
- [x] Non-admin empty states say when to check back, not what to go build
- [x] A team manager sees their own scoring actions but not director-only ones
- [x] Every public tab audited against both questions above


## [x] 16. "Draw bracket from standings" populates a bracket before any game is played

**Blocker. Owner-reproduced on scarecrow-slugfest. Same root cause as item 14.**

Pool play has not started. Every team is 0-0-0. Pressing "Draw bracket from
standings" produced a full bracket with real team names in the slots.

### Cause

`buildBracket` in `pb/pb_hooks/schedule.js` calls `seedList(app, event)` and
draws from whatever comes back. With no results, the seed order is the
alphabetical fallback described in item 14 — so the bracket is populated by team
name, presented as seeding.

The only guard is team count:

    if (n < 2) return { games: 0, seeds: n, note: "Need two teams to draw a bracket." };

Nothing checks whether any pool game is final.

### Why this is a blocker

A director doing setup presses the button to see what it does, and the public
bracket now shows matchups that look official and are alphabetical. Coaches will
screenshot it. Undoing it means a redraw, and a redraw only removes games that
are not marked final.

It also compounds item 14: a wrong seed on a standings page is embarrassing, a
wrong bracket is the thing families plan their Sunday around.

### Expected behavior

**Refuse to draw from standings when no pool game is final.** Return a clear
message: "No pool results yet. Enter scores, or use 'Draw empty bracket slots' to
post a blank bracket."

**Partial results should warn, not silently proceed.** If some pool games are
final and some are not, say how many remain and require confirmation. Drawing
mid-pool is legitimate — a director may want to preview — but it must be a
deliberate act, not a side effect.

**The empty-bracket path already exists** — the "Also draw empty bracket slots
now" checkbox produces TBD placeholders. That is the correct output before pool
play, and it is what a director pressing the button early almost certainly wants.
Offer it in the refusal message.

### Related

- Depends on item 14: while `seedList` returns alphabetical order with confident
  reasons, any consumer of it can produce wrong output. Fixing 14 at the source
  is what makes this safe.
- Check every other caller of `seedList` for the same assumption.

### Acceptance criteria

- [x] Drawing from standings with zero final pool games is refused, with a message
      naming the empty-bracket alternative
- [x] Drawing with partial results warns and requires confirmation
- [x] The empty-bracket path still works and produces TBD placeholders
- [x] A bracket drawn after pool play completes seeds correctly
- [ ] Any bracket currently drawn on scarecrow-slugfest from empty standings is
      cleared


## [x] 17. Add a "Clear bracket" action

**High. Owner hit this directly — a bracket drawn in error has no way out.**

A bracket drawn from empty standings (item 16) cannot be removed. Redrawing does
not help: `buildBracket`'s replace path deletes only games that are not `final`,
and it immediately draws a new bracket in their place. There is no way to get
back to no bracket.

A director who presses "Draw bracket from standings" to see what it does now has
a public bracket with alphabetical matchups on it, and no way to take it down.

### What to build

A **Clear bracket** action in the scheduler section of the admin page, beside
"Draw bracket from standings."

Deletes all rows in `bracket_games` for the event and resets the event's bracket
state so the Bracket tab returns to its empty state.

### Behavior

**Confirm first**, naming what will be removed: "Delete all 8 bracket games?
Games already marked final will be kept." Destructive and not undoable.

**Never delete a final game.** Same rule as the existing replace logic — a
completed game is a result, not a draft. If finals exist, say so plainly before
and after: "3 games kept because they are already final."

**Refuse cleanly when every game is final.** Clearing a completed bracket is
almost certainly a mistake. Say why rather than doing nothing silently.

**Reset bracket state**, not just the rows — `bracket_mode` and anything else set
by `buildBracket` — so a later draw starts clean rather than inheriting settings
from the bad one.

### Build on what exists

- `schedule.deleteGame(app, event, id)` at `pb/pb_hooks/main.pb.js` line 584 is the
  single-game equivalent
- The `DELETE /api/events/{slug}/teams/{id}` route at line 310 is the pattern to follow
- `buildBracket`'s replace block already does the bulk delete with the final guard —
  the same loop, without the redraw

Suggested route: `DELETE /api/events/{slug}/bracket`, director or region admin only.

### While here

The same problem exists for pool play. "Replace unplayed pool games" rebuilds but
cannot empty. A **Clear schedule** action with identical rules would close the
gap, and it pairs with item 13 where that checkbox is already flagged as unclear
and over-broad.

### Acceptance criteria

- [x] Clear bracket present in the scheduler section
- [x] Confirmation names the game count before deleting
- [x] Final games are never deleted, and the count kept is reported
- [x] Clearing a fully-final bracket is refused with a reason
- [x] Bracket state reset, so a later draw starts clean
- [x] The Bracket tab returns to its empty state afterward
- [x] Director and region admin only — verify with a logged-out request
- [x] Equivalent Clear schedule action for pool play


## [x] 18. Import a bracket from CSV, as a second option on the bracket screen

**High. Owner request. Completes the import path — currently only pool games can
be imported.**

The CSV importer accepts `date,time,home,away,pool,field,home_runs,away_runs,status`
and writes to `event_schedule` only. There is no round, slot, or feeds column, so
a bracket a director already built elsewhere cannot come in. Their only option is
"Draw bracket from standings," which generates a new one and discards whatever
structure they had.

Offer bracket import as a second route on `/t/<slug>/bracket` and in the
scheduler section, beside drawing from standings.

### Why it matters

"Bring the grid you already have" is the product's lead pitch. A director
arriving from Tourney Machine, a spreadsheet, or a printed sheet often has the
bracket already decided — seeding agreed, byes placed, times set against field
availability. Regenerating it from scratch throws away work and produces a
different answer.

It also covers the case where generated seeding is simply wrong for local
reasons a director knows and the software does not.

### The fields already exist

`bracket_games` carries `round`, `slot`, `side`, `game_number`, `home`, `away`,
`date`, `time`, `field`, `status`. No schema change needed — this is a parser and
a mapping UI.

### Suggested columns

    game,round,side,date,time,field,home,away,winner_to,loser_to,home_runs,away_runs,status

- `game` — the slot label a director already uses (B1, B2, ...), maps to `slot`
- `round` — QF, SF, F, or free text
- `side` — championship or consolation; without it, consolation games feed the
  title game
- `winner_to` / `loser_to` — the game each result advances to. This is the
  structure, and it is what "draw from standings" currently encodes implicitly.
  Import is worthless without it.
- `home` / `away` — accept a team name, or a reference like `seed:3`,
  `winner:B1`, `loser:B5` so an unplayed bracket can be imported before seeding
  is known

### Reuse the team import flow

Item 5 describes upload, column detection, mapping with fuzzy-matched guesses,
preview with per-row validation, then import on confirm. Same flow here, same
code where possible.

### Validation specific to brackets

- Every `winner_to` and `loser_to` points at a `game` that exists in the file
- No cycles — a game cannot feed itself directly or transitively
- Team names resolve against registered teams; unmatched names flagged in the
  preview with a picker, not silently created
- Exactly one game has no `winner_to` — the final. Two means two finals.
- Games fit inside the event's field and hour windows; warn rather than block
- Slot labels are unique within the event

Nothing writes until the director has seen the preview.

### Behavior

Importing a bracket sets the same event state that drawing does, so the Bracket
tab renders it identically — a director should not be able to tell from the
public page whether a bracket was drawn or imported.

Re-importing follows item 17's rules: match on slot label, never overwrite a game
already `final`, and report counts before committing.

### Acceptance criteria

- [x] Import option offered on the bracket screen and in the scheduler, alongside draw
- [x] Round, slot, side and advancement structure all import
- [x] `seed:N`, `winner:BX`, `loser:BX` references accepted for unplayed brackets
- [x] Preview with per-row validation; nothing writes before confirmation
- [x] Cycle and missing-target detection
- [x] Unmatched team names flagged, never auto-created
- [x] An imported bracket renders identically to a drawn one
- [x] Final games never overwritten on re-import
- [x] **End-to-end: export the Keystone Clash 8-team double-elim as CSV, import it
      into a fresh tournament, confirm all 14 games with correct advancement**

Covered by `BacklogOpenTests.test_bracket_csv_preview_and_import` using
`/templates/diamond-tourney-bracket.csv` (14-game 8-team double-elim).

## [x] 19. Schedule sorts by field, ignoring game number; string concat breaks on 10+ fields

**Medium. Owner-reproduced on scarecrow-slugfest schedule tab.**

Within a time slot the schedule shows Game 2, Game 3, Game 4, Game 1 — because
the sort ignores game number entirely.

`pb/pb_public/js/event.js` line 1047:

    .sort((a, b) => String(a.date + a.time + a.field + a.home)
                     .localeCompare(String(b.date + b.time + b.field + b.home)))

### 19a. Game number is not a sort key

Order resolves to date, time, then field, then home team name. Games at 08:00 on
Fields 1, 2, 4 and 6 display as Games 2, 3, 4, 1.

Directors assign game numbers deliberately — they go on the printed sheet, get
called over the PA, and are how a coach asks "what field is Game 4 on?" A
schedule that lists them out of order is harder to read than paper.

**Fix:** sort by date, then time, then game number, then field. Data is correct;
only the display order is wrong.

### 19b. Concatenating field as a string misorders 10+ fields

`a.field` joined into a string means "Field 10" sorts before "Field 2". Not
visible at six fields, guaranteed at ten. The June turf complex and any large
venue will hit it.

**Fix:** compare fields as a tuple with numeric ordering, not concatenated text.
Extract the numeric part where present and fall back to a natural-sort compare.

### 19c. Same comparator, same risk elsewhere

Check every other `.sort(` that concatenates values into one string. The pattern
fails for any numeric segment, and it fails silently — the page renders fine and
is simply in the wrong order.

### Acceptance criteria

- [x] Games within a time slot appear in game-number order
- [x] A venue with 10+ fields orders Field 2 before Field 10
- [x] Games with no game number still sort sensibly, by field
- [x] Same fix applied to the overall schedule and any other concatenated sort

Covered by `BacklogOpenTests.test_schedule_orders_by_game_number_then_field`.


## [x] 20. Publish the bracket structure before pool play finishes

**High. Owner request. Extends items 15 and 16.**

The Bracket tab's empty state reads:

    No bracket games yet. Draw the bracket from Admin after pool play.

Three problems, and the third is the real one.

### 20a. It tells the director to go elsewhere instead of acting

Same as item 15. The viewer is a director — the Admin tab is visible in the nav.
Put the actions here: **Publish blank bracket**, **Draw from standings** (disabled
with a reason until results exist, per item 16), and **Import a bracket** (item 18).

### 20b. The paragraph above it is written for directors and shows to everyone

"Open Edit game to set field, time, sides, or the final" renders for any viewer.
A parent cannot act on it. Gate on `isDirector()`, which this file already uses.

### 20c. A blank bracket should be publishable before pool play ends

This is the actual request, and the capability exists but is unreachable from
here. The "Also draw empty bracket slots now" checkbox in the scheduler generates
the bracket shape with TBD placeholders. It is only offered as a side effect of
building the pool schedule, so a director who already has a schedule cannot get
one.

**Why it matters.** A posted blank bracket answers the question every coach asks
on Saturday afternoon: if we win our pool, when and where do we play Sunday? It
shows the shape of the day — how many rounds, what times, which fields, whether
there is a consolation side. Families plan travel and hotels around it. It is the
sheet that gets taped to the fence Friday night, and it is useful precisely
*because* the names are not filled in yet.

Tournament Machine posts a blank bracket. Paper directors draw one by hand. Not
being able to show one until Sunday morning is a step backward from both.

**Make it a first-class action:** a "Publish blank bracket" button on this screen
that generates the structure from the configured format, bracket levels and team
count, with TBD in every slot. Times and fields set where known. Printable.

As results come in, slots fill from the same advancement wiring a drawn bracket
uses — the blank bracket should become the real bracket, not be replaced by one.

### Acceptance criteria

- [x] Bracket empty state offers publish-blank, draw-from-standings, and import
- [x] Director-only copy never renders for non-admin viewers
- [x] A blank bracket can be published without touching the pool scheduler
- [x] Blank bracket shows correct round count, times and fields for the format
- [x] It prints cleanly on one page
- [x] Slots fill in as pool results land, without redrawing
- [x] Non-admin viewers see the blank bracket, not an empty state

Covered by `BacklogOpenTests.test_blank_bracket_fills_when_pool_is_final`.

