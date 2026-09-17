# Cursor + Grok hands-free integration

This replaces outline §§9–14 for how work actually runs. Product rules in §§1–8, 11, and 15 are unchanged.

## Who does what

| Job | Runner |
|---|---|
| Schema, pages, deploy, CI | Cursor Cloud Agent (Grok 4.6) in this repo |
| Recurring ingest / publish / event / copy | Cursor Automations — prompts in `automations/` |
| Screenshot / GameChanger computer use | Grok Bot **Softball Ingest** — `grok-bot/SOFTBALL-INGEST.md` |
| Approve staged games, publish Phase 1 news, first production merge | Human |

Bots never approve their own staging. PocketBase hooks enforce that (`pb/pb_hooks/main.pb.js`).

## Local URL

`bash scripts/start-pocketbase.sh` → http://127.0.0.1:8097

Accounts: `scripts/local-accounts.txt`.

## Hands-free loops

1. Coach drops a box in Slack `#stat-drop` → Automation / Grok Bot A → `POST /api/bot/ingest` → review queue.
2. Coach hits Approve in `/teams/{slug}/admin/review` → hook copies live rows, rebuilds W-L, optional `BOT_B_WEBHOOK_URL`.
3. Sunday 20:00 ET Automation Bot B drafts unpublished recaps and lists leftover staging.
4. Event weekend Slack `#event-scores` → Bot C → `/api/bot/event-update`.
5. Cloud Agent PR + CI Automation keeps Phase 0–1 green. Deploy from the default branch via Fly (`fly.toml`).

## Secrets (Cursor Cloud Agents dashboard)

`PB_URL`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` (builder only), `PB_BOT_EMAIL`, `PB_BOT_PASSWORD`, `FLY_API_TOKEN`, `BOT_B_WEBHOOK_URL`, `BOT_B_WEBHOOK_KEY`.

Grok Bot gets the bot user only.

## Phase 0 done when

Login works and the demo hitting table renders (`/teams/demo/hitting` after `coach.demo@local.test`).

## Diamond Tourney (partner deck)

Derek’s concept lives in `docs/partner/Diamond_Tourney.pptx` and `docs/DIAMOND-TOURNEY.md`. Public event board: `/t/central-saturday`. Schedule paste: `/directors/import`. Pricing and registration stay unbuilt until Phase 4.

## Phase 1 done when

`python3 scripts/acceptance_test.py` is green: same player rolls up, IP 2.1+1.2=4.0, reject does not change BA/W-L, double approve does not double-count, public cannot read hitting, Hawks coach book is hidden from Rivals coach.
