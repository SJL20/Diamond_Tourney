# Diamond Tourney × Region books

Partner concept deck (Derek Rocco, September 2026): `docs/partner/Diamond_Tourney.pptx`.

We keep **one PocketBase box**. We do **not** switch to Vercel + Supabase + Claude. Map his stack onto what already runs here:

| Deck | This repo |
|---|---|
| Vercel public pages | `pb/pb_public/` on Fly (`fly.toml`) |
| Supabase | PocketBase (auth, files, SQLite) |
| Claude box-score vision | Grok Bot A + `/api/bot/ingest` — coach confirms, nothing publishes unverified |
| Resend | Not built yet (Phase 4 rain/schedule texts) |
| diamondtourney.com | Owner still picks the domain (outline §12) |

## What we took from the deck

1. **Wedge (door 3):** “You already have a schedule.” Paste the Excel / Tourney Machine / legal-pad grid. Get a public link, live standings with real tiebreakers, and a bracket that fills itself. That is `/directors/import` and `/t/{slug}`.
2. **Stats justify the price.** Season team books stay behind login. **Tournament** batting, pitching, awards, and weekend lines are public — after a coach confirms the box.
3. **Coach-supplied data only.** Screenshot, scorebook photo, CSV, or a public GameChanger URL the coach pastes. **No GameChanger scrape, no login into GC, no unofficial API.** Same rule as outline §7.

## Identity (team, not email)

Site admin manages **team profiles** (`/admin/teams`). Email is only a login that can attach to a team. A team can exist with no GameChanger — year totals still follow that club. GameChanger, when present, is an optional public-page link, not the team’s identity.
4. **Pricing (not billed yet):** The Sheet free ≤8 teams; Tournament $79/event; Organization $399/year. Per event, not a February-cancelled monthly plan.
5. **Narrow to softball and baseball.** Youth ERA base 7, RA/RS tiebreaks, finish-the-inning later. Do not generalize.

## Three doors

| Door | Status in this repo |
|---|---|
| You already have a schedule | **Live** — CSV import + public board (`/directors/import`) |
| Start it here | **Live** — native create (`/directors/new`) or link a public Tourney Machine URL (`/directors/link-tm`) |
| Team signup | **Live** — director or team (`/t/{slug}/signup`). GameChanger is optional; a paper team signs up without one. When a URL is there, hosted sync reads that public page. No bot required. |
| Year series | **Live** — GameChanger link is the club identity. `/year/2026` rolls W-L and leaders across weekends. |
| Import Keystone Clash popup | **Live** — `/directors/import-popup` reads public `data.json` / `stats.json` from https://thedr21.github.io/KeystoneClash/. Stores coach-published GameChanger URLs. Does not scrape GameChanger. Individual pool boxes that are not on the popup are not invented. |

## Tiebreak (outline §6, confirmed by the deck, updated 2026-09-18)

Default pool order (director can reorder on create / Admin setup):

record (win% with a tie as half) → head-to-head → fewest runs allowed → run differential → most runs scored.

Head-to-head is group-aware: it applies only for a 2-team tie, or when every pair in the tied group has a decided game. A 3-team cycle skips H2H. Each seed on the standings tab has a “why this seed” line.

`lib/standings.py` and `pb/pb_hooks/diamond.js` must stay in lockstep. Do not change season-book metric formulas.

## Awards

All-tournament team is the leaderboard with gates (min 8 AB / 3.0 IP), printed Sunday on the field — `/t/{slug}/awards`. Not “who the director happened to watch.”

## Parallel work

His deck’s “already built” schedule/standings/bracket is the product truth we are matching. Our Phase 0–1 team books and Bot A staging stay. Do not delete either side.
