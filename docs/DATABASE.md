# Database map

PocketBase collections are the database. This file is the map: which table is the team, which tables nothing reads, and the rules for the next change.

`SOFTBALL-PLATFORM-BOT-OUTLINE.md` §5 is the original collection list. The tournament product grew past that list. Where this file and the outline disagree, this file matches the code.

## The team rule

**One team, created before any event signup.**

`teams` is the master record: name, slug, age group, coach name, public GameChanger link, public W-L, logo. A coach creates it on the account page after the email is confirmed (`POST /api/teams`). That row is stored on `users.team`. A director creates the same kind of row, then adds it to a weekend, then passes ownership to an email (`POST /api/teams/{id}/transfer`). If that email has no account yet, the team waits and attaches when they register and confirm.

`event_teams` is one weekend's entry: pool, seed, packet, paid flag. `event_teams.team` points at `teams`. Signup refuses a request that does not already have that id. A coach who already owns the team joins with that id only. Name, contacts, co-owners, and the GameChanger link are not typed again on the weekend.

```
teams (master)
  └── event_teams (one row per weekend)
        ├── event_players
        ├── team_docs
        └── team_contacts
```

A coach with no master team sees "Create your team" on the account page. The event signup form does not have a free-text team name. A director saves the team, then picks it from the list, then joins the weekend.

CSV import is the director bulk door. For each new name it writes the master `teams` row first, then the `event_teams` row that points at it. The same slug on a later import reuses the master row.

Rows already on the board keep a blank `event_teams.team` until a site admin runs **Attach leftover teams** on `/admin/teams`. That button is the one-time pass. It does not run on deploy. Delete the weekends you do not want in the master list first (the test tournament, Keystone Clash). The pass groups a blank link by the public GameChanger URL, then by the exact team name. `Hawks` and `Hawks 10U` stay two teams. A name that already belongs to more than one master team is left unlinked. Each group starts on that suggestion. A site admin can switch a group to a different master team, to a new master team, or leave it unlinked. Scores and player lines are not written.

Coach email, phone, the second contact, and a pending owner email stay on `team_contacts` keyed by the master team. Co-owner emails stay on `team_co_owners`. None of those are columns on `teams`. `teams` is publicly readable. The GameChanger link on `teams` is a public page URL.

## Why `teams` looked unused

Three tables were all called "the team."

| Table | What it actually is | Who writes it |
|---|---|---|
| `teams` | Season book and, now, the master team | Seed (demo, Hawks, Rivals), `POST /api/teams`, CSV import |
| `event_teams` | One club inside one weekend | Signup, import, Keystone/Harbor seeds |
| `club_teams` | Year-board identity, usually keyed by a GameChanger URL | Signup still upserts one; `/admin/teams` edits this table |

Before the master-team link, signup wrote `event_teams` and `club_teams` and never `teams`. `/admin/teams` is the club list, not `teams`. The account page showed a season book only when `users.team` was already set, which registration did not do. `/teams` in the browser is the login gate, not a directory. The public card `/teams/{slug}` works when you already know the slug.

`users.team` is still one team per coach account. A director account can create many master teams and is not attached to them.

`club_teams` is still written, because the year board and Follow-a-team use it for weekends that have no master link. New signups set both `event_teams.team` and `event_teams.club`. The year board prefers `event_teams.team` when it is set (`team:{id}`), then `club_teams`, then the single weekend row. `/admin/teams` is where a site admin renames a master team, removes a duplicate, and removes a year-board profile. Removing a profile clears `event_teams.club` and leaves the weekend row. Removing a master team is refused when that team has a roster, a season book, a score sheet in review, or a final game. An empty duplicate is deleted, and its weekend rows stay with a blank link.

## Collection inventory

Checked against hooks, the public pages, and the tests. "Unused" means nothing in the running app reads or writes the rows after the migration that created them.

### In use

| Collection | Role |
|---|---|
| `users` | Logins. `role`, `team` (master team), display name, verify and reset tokens. |
| `teams` | Master team and season book. Public name, slug, age, W-L, logo. |
| `players` | Season roster. Key is `Firstname LastInitial #jersey`. |
| `team_games` | Approved season games. Dedup key is team + date + opponent + score. |
| `hitting_game`, `pitching_game` | Season box lines. |
| `staging_games` | Bot or coach ingest. Approve copies into the season book. Bots never approve. |
| `events` | One weekend. |
| `event_teams` | Weekend entry. `team` is the master link. |
| `event_players`, `event_hitting`, `event_pitching` | Weekend roster and lines. |
| `event_schedule`, `bracket_games` | Pool games and bracket games. |
| `event_boxes` | Raw box (JSON plus file). Child tables hold the lines. |
| `pools` | Pool name and the tiebreak JSON the standings use. |
| `fields` | Diamonds for one event (`fields.event`). |
| `team_contacts` | Private coach email and phone for the master team, plus a pending owner email. Rules are closed. Hooks are the only reader. |
| `team_docs` | Packet files. Protected. Not a public list. |
| `box_submissions` | Score-email links and coach uploads. |
| `event_co_owners` | Extra directors by email. Addresses stay off public pages. |
| `sync_log` | Mail and sync failures. |
| `venue_photos` | Park photos and the map PDF. |
| `import_maps` | A director's remembered CSV column map. Closed. |
| `team_co_owners` | Extra emails that can open the team with the owner. Closed. Not a second team. |
| `follows` | A login following an event or a `club_teams` row. Closed. |
| `login_resets` | Password-reset tokens for the admin login path. |
| `club_teams` | Year-series identity used by `/year/{year}`, `/admin/teams`, and follows. Not the master team. |
| `posts` | Bot B writes an unpublished recap. No public news page reads it. Phase 1 keeps `public` false. |

### Unused

| Collection | Why it is still here |
|---|---|
| `inquiries` | Outline §2 "join" form. No page posts to it and nothing lists it. Create rule is public, so a client could insert a row; the app never does. |
| `orgs` | One seed row, "Region Softball". No screen reads it. |
| `seasons` | One seed row, "2026 Summer". `teams.season` is set for the three seed teams and never read. |

### Fields that mislead

- `pools.tiebreak_notes` is a sentence copied onto some seed pools. Standings read `pools.tiebreak` and `events.tiebreak`, not that sentence.
- `event_teams.contact_email` and `event_teams.gamechanger_url` remain on old rows (Keystone, Harbor, earlier signups). A weekend entry that has `event_teams.team` set does not get a new copy of the email or the GameChanger link. Readers use the master row when that link is filled, and the old event columns when it is not.
- `fields` was a region directory. It is now per event. The seed diamond "Central Park Complex" has no event, so no weekend board shows it.
- `event_teams.name` is the name copied from the master team at signup. Public reads prefer the master name when `event_teams.team` is set. The id is the identity. The copied name is the label for rows that have no link yet.

## Design rules

1. **Create the master team first.** A new weekend entry sets `event_teams.team`. Do not insert an `event_teams` row from a typed name unless the master row was written earlier in that same director import.
2. **Do not add a fourth team table.** `club_teams` stays until the year board and follows point at `teams`. New features use `teams`.
3. **Private contact, public profile.** Email, phone, address, and birthdate go in `team_contacts` or `team_docs`. Never on `teams`, and never on a collection whose list rule is empty.
4. **Hooks bypass collection rules.** A closed rule does not protect a route that loads the row with `app.findRecordsByFilter` and returns the email. Check both the migration and the hook.
5. **New API rules start with** `@request.auth.id != '' && (...)`. An empty id must not match an empty column. Authorize by ownership (`created_by`, co-owner, `users.team`, `event_teams.account`), not by the `event_td` role. Registration hands that role out.
6. **Migrations are additive.** A new file with the next number. Do not edit a migration that already ran. Do not list events and delete the ones missing from a keep-set. `scripts/check_migration_safety.py` fails CI on that pattern.
7. **Do not invent a link.** Unreadable or missing identity stays null. Matching "Hawks" to "Hawks 10U" by guess is a bad link. The site-admin attach pass may join rows that share a GameChanger URL or the exact same name. It is a button, not a migration.
8. **A new collection needs a writer and a reader** in the same change, or it is named in this file as unused. `inquiries`, `orgs`, and `seasons` are the examples to avoid.
9. **Metric formulas do not move with schema work.** Youth ERA base is 7. IP stays integer outs. An unpublished stat is null, not 0.
10. **Bots write staging and event boxes.** They do not approve staging, delete approved rows, or create master teams.

## What a later pass still has to do

- Point follows and the year board at `teams` only, then stop writing `club_teams`.
- The site-admin attach button covers a blank `event_teams.team`. It still does not treat a shorter name as the same club.
- Let one coach account hold more than one master team. `users.team` is a single relation today.
- Give `posts`, `inquiries`, `orgs`, and `seasons` a real page, or leave them listed here as unused.
