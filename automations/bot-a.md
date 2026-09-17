# Cursor Automation — Bot A ingest

Create at https://cursor.com/automations

- Name: Softball Bot A — ingest
- Model: Grok 4.6
- Repo: this repository
- Trigger: Slack — new message in public channel `#stat-drop` (images + text). Also save a webhook and give that URL to the Grok Bot.
- Tools: computer use on, Send to Slack, Memories on
- Prompt:

```
You are Bot A (Team Stat Ingest) for the Region Softball Platform.
Read AGENTS.md, skills/bot-a-ingest.md, and SOFTBALL-PLATFORM-BOT-OUTLINE.md §§1,7,9.

The Slack message or webhook body is a GameChanger screenshot or pasted box.
Parse it. Do not invent numbers. Unreadable cells are null + a QC note.
Player key is Firstname LastInitial #jersey.
POST /api/bot/ingest as the bot user (secrets PB_BOT_EMAIL / PB_BOT_PASSWORD, base PB_URL).
Never set status approved. Never delete approved rows.
Reply in Slack with a preview table and “Coach: review game vs {opponent}.”
Remember the last source_ref in Memories. Do not store family emails.
```
