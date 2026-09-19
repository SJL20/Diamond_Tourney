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

## [ ] 6. Photo upload for fields and venues — on the create form

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

- [ ] Upload control present on `/directors/new`
- [ ] Multiple captioned photos per venue, reorderable
- [ ] Server-side resize and cap
- [ ] EXIF stripped
- [ ] Guidance text on the upload control
- [ ] Photos on the public tournament page
- [ ] Uploads survive a redeploy
---

## [ ] 7. Remove lat/long AND the map pin adjuster from the director form

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

- [ ] Lat/long inputs removed from the form
- [ ] Map pin adjuster removed from the form
- [ ] Street address geocoded on save, stored on the venue
- [ ] Public page links to the address for directions
- [ ] Geocode failure does not block saving the tournament

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

- [ ] ## [ ] 10. Remove both map pin nudge controls; add a field map upload instead

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

- [ ] No "Nudge this diamond's pin" control anywhere on the form
- [ ] No "Nudge the map pin" control anywhere on the form
- [ ] No latitude or longitude input visible to a director, at venue or field level
- [ ] Street address geocoded on save; coordinates stored, never typed
- [ ] Image upload present on `/directors/new`, not only on a separate venue screen
- [ ] Multiple captioned images, reorderable, pdf accepted
- [ ] EXIF stripped on upload
- [ ] Guidance text shown on the upload control
- [ ] Images render on the public tournament page
- [ ] Uploads survive a redeploy


## [ ] 11. Import: admin link creates a new tournament instead of importing into the current one

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

- [ ] `/directors/import` unchanged: still creates a new tournament from a grid
- [ ] A scoped import inside a tournament loads games into that tournament only,
      with no slug or name fields and no new event created
- [ ] Admin label reads "Import schedule"
- [ ] An imported pool schedule produces standings
- [ ] A bracket can be drawn from those standings
- [ ] Provenance recorded without restricting format
- [ ] **End-to-end: import the Keystone Clash pool grid as CSV, confirm standings
      compute with correct seeds, then draw the 8-team double-elim bracket from them**
