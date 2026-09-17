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
3. **Coach-supplied uploads only.** Screenshot or scorebook photo. No GameChanger scrape (TOS). Same rule as outline §7.
4. **Pricing (not billed yet):** The Sheet free ≤8 teams; Tournament $79/event; Organization $399/year. Per event, not a February-cancelled monthly plan.
5. **Narrow to softball and baseball.** Youth ERA base 7, RA/RS tiebreaks, finish-the-inning later. Do not generalize.

## Three doors

| Door | Status in this repo |
|---|---|
| You already have a schedule | **Live** — CSV import + public board (`/directors/import`) |
| Start it here | **Live** — native create (`/directors/new`) or link a public Tourney Machine URL (`/directors/link-tm`) |
| Team signup | **Live** — director or team, GameChanger URL required (`/t/{slug}/signup`). Hosted sync reads those public pages. No bot required. |

## Tiebreak (outline §6, confirmed by the deck)

Pool order: wins, then losses, then head-to-head, then runs allowed, then runs scored.

## Awards

All-tournament team is the leaderboard with gates (min 8 AB / 3.0 IP), printed Sunday on the field — `/t/{slug}/awards`. Not “who the director happened to watch.”

## Parallel work

His deck’s “already built” schedule/standings/bracket is the product truth we are matching. Our Phase 0–1 team books and Bot A staging stay. Do not delete either side.
