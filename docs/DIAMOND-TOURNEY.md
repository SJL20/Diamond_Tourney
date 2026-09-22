# Diamond Tourney × Region books

Partner concept deck (Derek Rocco, September 2026): `docs/partner/Diamond_Tourney.pptx`.

We keep **one PocketBase box**. We do **not** switch to Vercel + Supabase + Claude. Map his stack onto what already runs here:

| Deck | This repo |
|---|---|
| Vercel public pages | `pb/pb_public/` on Fly (`fly.toml`) |
| Supabase | PocketBase (auth, files, SQLite) |
| Claude box-score vision | Grok Bot A + `/api/bot/ingest` — coach confirms, nothing publishes unverified |
| Resend | PocketBase Admin SMTP for signup / verify / welcome / rain. Cloudflare DNS holds SPF/DKIM. No mail secrets in the repo. Phase 4 rain texts still later. |
| diamondtourney.com | Live: Fly → PocketBase → Cloudflare at https://www.diamondtourney.com (apex too) |

## What we took from the deck

1. **Wedge (door 3):** “You already have a schedule.” Paste the Excel / Tourney Machine / legal-pad grid. Get a public link, live standings with real tiebreakers, and a bracket that fills itself. That is `/directors/import` and `/t/{slug}`.
2. **Stats justify the price.** Season team books stay behind login. **Tournament** batting, pitching, awards, and weekend lines are public — after a coach confirms the box.
3. **Coach-supplied data only.** Screenshot, scorebook photo, CSV, GC mobile PDF, or a public GameChanger URL the coach pastes. Bots **may monitor those public GC pages** on a recurring poll (about every 5 minutes during a live event) and POST readable scores/lines through `/api/bot/ingest` (season staging) or `/api/bot/event-box` / `/api/bot/event-update` (tournament). **No GC account login, no unofficial API, no invented numbers.** Same extract rules as outline §7.

## Identity (team, not email)

The master team is a row in `teams`. It holds the club name, age, coach name, and public GameChanger link. Coach email, phone, and co-owners stay on private rows (`team_contacts`, `team_co_owners`), never on the public team. A coach creates that record on the account page after confirming email, then joins a weekend with one button. A director creates the same record, adds it to the weekend, and passes ownership to an email. `event_teams.team` is the link, so the weekend entry is not a second team. Site admin opens `/admin/teams` to edit a master team's details, delete any master team (roster, season book, and weekend entries included), remove a bad year-board profile, and attach leftover weekend teams onto the master list. That attach is a button they run after deleting weekends that should not be copied. The year-board rows on that page are still `club_teams`. The PocketBase Admin account signs in on `/login` as site admin. The event owner can add extra directors by email on **Admin → Tournament setup**. Those addresses never appear on public pages. Email is only a login. A team can exist with no GameChanger. GameChanger, when present, is the club's public page, stored on the master team. The collection map is `docs/DATABASE.md`.
4. **Pricing (not billed yet):** The Sheet free ≤8 teams; Tournament $79/event; Organization $399/year. Per event, not a February-cancelled monthly plan.
5. **Narrow to softball and baseball.** Youth ERA base 7, RA/RS tiebreaks, finish-the-inning later. Do not generalize.

## Three doors

| Door | Status in this repo |
|---|---|
| You already have a schedule | **Live** — schedule CSV import + public board (`/directors/import`) |
| You already have a team list | **Live** — director desk → Teams imports a Google Forms / Excel CSV with column mapping |
| Start it here | **Live** — native create (`/directors/new`) or link a public Tourney Machine URL (`/directors/link-tm`) |
| Team signup | **Live** — the master team holds the name, coach, co-owners, contacts, and GameChanger link. A coach joins a weekend with one button. A director creates the team, adds it, then passes ownership to an email. `/t/{slug}/signup` only points `event_teams.team` at that row. See `docs/DATABASE.md`. |
| Year series | **Live** — GameChanger link is the club identity. `/year/2026` rolls W-L and leaders across weekends. |
| Import Keystone Clash popup | **Live** — `/directors/import-popup` reads public `data.json` / `stats.json` from https://thedr21.github.io/KeystoneClash/. Stores coach-published GameChanger URLs. Bots may monitor those public GC pages. Individual pool boxes that are not on the popup are not invented. |

## Tiebreak (outline §6, confirmed by the deck, updated 2026-09-18)

Default pool order (director can reorder, remove steps, or pick a preset; each pool can have its own chain):

record (win% with a tie as half) → head-to-head → fewest runs allowed → run differential → most runs scored.

Head-to-head is group-aware: it applies only for a 2-team tie, or when every pair in the tied group has a decided game. A 3-team cycle skips H2H. Each seed on the standings tab has a “why this seed” line. Public standings print the configured chain.

Age groups are a multi-select (6U–18U, including 11U). Class A/B/C and combine-vs-split are settings only — the host does not auto-create a division per age. Keystone Clash 2026 is one combined `11U/12U-C` division. Pitching limits stay on the form and default to none.

`lib/standings.py` and `pb/pb_hooks/diamond.js` must stay in lockstep. Do not change season-book metric formulas.

## Awards

All-tournament team is the leaderboard with gates (min 8 AB / 3.0 IP), printed Sunday on the field — `/t/{slug}/awards`. Not “who the director happened to watch.” Live `/leaders` and `/stats` gates start at 2 AB / 1.0 IP after the first final and rise with games played (2 AB and 1.0 IP per game, capped at those weekend numbers). Pitching-count “over” only appears when the event has a posted IP cap.

## GameChanger monitor loop

Allowed:

- Coach, manager, or director stores a **public** GameChanger team or box-score URL (`gc.com`, `web.gc.com`, `gamechanger.io`).
- Grok bots list those URLs with `GET /api/bot/gc-monitor` (`python3 scripts/bot_gc_monitor.py --list`).
- Poll about every **5 minutes** while an event is `live` (30 minutes when none is live).
- Open the public page only. Read posted scores and box lines. Write:
  - Season book → `POST /api/bot/ingest` → `staging_games`. **Coach must Approve.** Bots never approve staging and never delete approved rows.
  - Tournament → `POST /api/bot/event-box` (lines + score) or `POST /api/bot/event-update` (score only). Use `needs_review` when the page is messy.
- GC mobile PDF / screenshot / pasted box remains a supported door (`GET /api/bot/event-boxes`).
- A PDF upload with a text layer is read on the server into `needs_review`. Headers pick the columns. A blank cell stays blank. A scan with no text layer stays queued for a person. The bot still cannot approve.

Forbidden:

- GameChanger account login or unofficial API
- Invented stats, or pool boxes a public page / the Keystone popup does not list
- Unlock locked rosters, edit rules text, change metric formulas
- Publish family emails, addresses, or birthdates

The PocketBase job `hosted-gc-tm-sync` still pings linked pages for reachability every two hours. It does not type box lines.

## Parallel work

His deck’s “already built” schedule/standings/bracket is the product truth we are matching. Our Phase 0–1 team books and Bot A staging stay. Do not delete either side.
