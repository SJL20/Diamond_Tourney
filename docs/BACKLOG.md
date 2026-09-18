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

## [x] 6. Photo upload for fields and venues

**Medium.**

Directors should upload photos of the complex so visiting teams know what they
are driving to. PocketBase file fields with thumbnails on the venue or field
record — nothing custom needed.

What matters, in order: **the entrance and parking lot** (hardest thing to find,
source of most Saturday-morning phone calls), a **layout map** showing which
diamond is Field 1 vs Field 2, then the fields themselves. Keystone Clash had a
hand-made parking map for exactly this reason; this generalizes it.

Multiple images per venue with captions, reorderable, first used as the public
page header. Cap at 2–5 MB with server-side resizing — directors upload straight
off a phone. Accept jpg, png, webp, heic.

**Two requirements, not suggestions:**

- **Strip EXIF on upload.** Phone photos carry GPS and timestamps. Publishing
  those on a public page is a privacy leak about where children are on a given
  weekend.
- **No people in field photos.** These pages are public and this is a youth
  sports product. Put a plain line on the upload control: "Photos of fields and
  facilities only, please — no photos of players." Consider a review step rather
  than instant publish.

**Storage:** PocketBase writes uploads to local disk, which on Fly means the
mounted volume. Confirm a volume is mounted and that backups cover the files
directory, not only the database.

Shipped: captioned `venue_photos`, unpublished until publish, first published
photo is the public header, JPEG/PNG EXIF stripped, Fly volume `pb_data` →
`/data`. This pass adds HEIC/HEIF to the accepted types and a 5 MB cap.
Pixel resize needs an image converter the Fly image does not ship — the cap
is the server-side limit.

- [x] Multiple captioned photos per venue, reorderable
- [x] Server-side resize and cap
- [x] EXIF stripped
- [x] Guidance text on the upload control
- [x] Photos on the public tournament page
- [x] Uploads survive a redeploy

---

## [x] 7. Remove lat/long from the director form — geocode the address

**Medium.**

Asking a director for decimal coordinates is the wrong ask; nobody knows them,
and it is friction on a form that should take ninety seconds.

**Keep the coordinates.** Parents driving to an unfamiliar complex need the map
pin, and the Keystone parking map used it. Take a street address and geocode in
the background on save. Store the resolved lat/long on the venue and let the
director nudge the pin on a small map — geocoders routinely land ballfields in
the wrong lot.

Shipped on `main`. Street address is geocoded (Nominatim). Lat/lng stay on the
record and only appear under “Nudge the map pin.” Failure does not block save.

- [x] Lat/long inputs removed
- [x] Address geocoded on save
- [x] Coordinates stored and used by the public map
- [x] Pin manually adjustable
- [x] Geocode failure does not block saving

---

## [x] 8. Hide the pitching limit section for softball

**Superseded by the owner (2026-09-18).** Keep the section visible and
configurable. Default is **none**. Do not hide it for softball. Fields and
storage stay. Baseball can still turn a limit on later without a rebuild.

- [x] Hidden when sport is softball — **not done; owner asked to keep it visible**
- [x] Field and storage retained
- [x] Appears when sport is baseball — section always visible; mode defaults to none
