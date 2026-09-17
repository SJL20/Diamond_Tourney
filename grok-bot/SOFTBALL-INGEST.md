# Grok Bot — Softball Ingest

Companion to Cursor Cloud Agents. This Bot does **not** own the git repo.

## Setup

1. Create a Grok Bot named **Softball Ingest**.
2. Paste `skills/bot-a-ingest.md` as a skill first.
3. Then add a routine (not more than every 5 minutes):

```
If there are new files in the drop folder or a Slack #stat-drop message with a box score:
1. Parse with the Bot A skill. Do not invent stats.
2. POST {PB_URL}/api/bot/ingest as PB_BOT_EMAIL / PB_BOT_PASSWORD.
3. Slack the team coach: review game vs {opponent}.
Never click Approve. Never store PB_ADMIN_PASSWORD. All Grok Bots share one computer.
```

4. Slack keyword listener on `#stat-drop`, **or** give Cursor Automation Bot A this Bot’s webhook.

## Secrets on the Bot

Only `PB_URL`, `PB_BOT_EMAIL`, `PB_BOT_PASSWORD`. Staging-only token.

## Screenshot path

GameChanger website scrape is best-effort. The supported path is a screenshot or pasted box dropped in Slack / the drop folder.
