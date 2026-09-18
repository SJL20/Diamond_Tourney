# Grok Bot — Softball Ingest

Companion to Cursor Cloud Agents. This Bot does **not** own the git repo.

## Setup

1. Create a Grok Bot named **Softball Ingest**.
2. Paste `skills/bot-a-ingest.md` as a skill first. Also add `skills/bot-c-event.md` if this computer runs event weekends.
3. Then add a routine (not more than every 5 minutes):

```
If there are new files in the drop folder or a Slack #stat-drop message with a box score:
1. Parse with the Bot A skill. Do not invent stats.
2. POST {PB_URL}/api/bot/ingest as PB_BOT_EMAIL / PB_BOT_PASSWORD.
3. Slack the team coach: review game vs {opponent}.

Also, every cycle (about 5 minutes while an event is live):
1. GET {PB_URL}/api/bot/gc-monitor (or python3 scripts/bot_gc_monitor.py --list).
2. Open each coach-supplied public GameChanger URL (gc.com / web.gc.com / gamechanger.io).
3. Read posted scores and box lines that are visible without a GC login.
4. Season book → POST /api/bot/ingest (staging only). Event board → POST /api/bot/event-box or /api/bot/event-update.
5. Unreadable cell → null + QC note. Never invent a box the public page does not show.
6. Queued PDFs still come from GET /api/bot/event-boxes — OCR / type those too.

Never click Approve. Never store PB_ADMIN_PASSWORD. Never log into a private GameChanger account. All Grok Bots share one computer.
```

4. Slack keyword listener on `#stat-drop`, **or** give Cursor Automation Bot A this Bot’s webhook.
5. For live weekends, also use Automation `automations/bot-gc-monitor.md`.

## Secrets on the Bot

Only `PB_URL`, `PB_BOT_EMAIL`, `PB_BOT_PASSWORD`. Staging-only token.

## Allowed GameChanger path

Coach-supplied **public** GameChanger team or box-score URLs stored on the host. Poll them. Write through the bot APIs. PDF / screenshot / pasted box remains the other supported path.

Forbidden: GC account login, unofficial API, invented numbers, approving staging, deleting approved rows.
