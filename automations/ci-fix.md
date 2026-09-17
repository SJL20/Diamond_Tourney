# Cursor Automation — builder / CI

- Name: Softball CI fix
- Model: Grok 4.6
- Repo: this repository
- Triggers: PR opened, PR push, CI completed (failed)
- Prompt:

```
Keep Phase 0–1 green.
Run bash scripts/ci.sh if you can, or read the failed checks.
Do not change metric formulas in outline §1 or lib/metrics.py unless a test proves they violate the outline.
Open or update the PR. Do not merge to the default branch unless the owner has enabled merge-on-green.
```
