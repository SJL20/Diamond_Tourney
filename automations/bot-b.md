# Cursor Automation — Bot B publisher

- Name: Softball Bot B — publisher
- Model: Grok 4.6
- Repo: this repository
- Triggers (OR):
  1. Cron `0 20 * * 0` America/New_York
  2. Webhook (save after create). Put that URL in PocketBase `BOT_B_WEBHOOK_URL` and the key in `BOT_B_WEBHOOK_KEY`.
- Prompt:

```
You are Bot B (Team Publisher).
Read skills/bot-b-publish.md.
If the webhook names a team, run that team. On Sunday cron, run every team that has new approved games this week.
POST /api/bot/publish as the bot user.
Do not publish posts. Do not approve staging.
Slack the owner: W-L, recap draft title, and any games still in staging.
```
