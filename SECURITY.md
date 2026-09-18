# Security

This repository is public, and the platform handles data about children: team
rosters, parent contact emails, and uploaded age-proof documents such as birth
certificates. Please treat exposure bugs accordingly.

## Reporting

**Do not open a public issue or pull request for a data-exposure bug.** A public
report tells everyone how to reach the data before it can be closed.

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. If that is unavailable, contact the
repository owner ([@SJL20](https://github.com/SJL20)) directly and wait for a
reply before posting anything publicly.

Helpful things to include:

- The exact request — method, path, and whether you were logged in.
- What came back that should not have.
- Whether an ordinary self-registered account was enough, or none at all.

## What counts

Worth reporting:

- Any private field readable without the right login: a family email, an
  address, a birthdate, an uploaded packet document, or a season player stat.
- Any write a caller should not have: posting a score, a rain notice, or a
  roster change on an event they do not own.
- Any path that lets a bot approve its own staged stats.
- Any path that publishes a season team book to the public.

Not a vulnerability:

- Tournament scores, standings, brackets, and published weekend stat lines.
  Those are public on purpose once a coach confirms the box.
- The credentials in `scripts/local-accounts.txt`. They are local development
  accounts against a throwaway database and are meant to be in the open.

## Where to look, if you are checking

Two surfaces have to agree, and only one of them is obvious:

1. **Collection API rules** in `pb/pb_migrations/`, which govern the raw
   `/api/collections/...` REST endpoints. These are reachable whether or not any
   page in the app uses them.
2. **Hook routes** in `pb/pb_hooks/`, which query with app context and therefore
   bypass those rules entirely. Whatever a hook puts in its JSON is published,
   regardless of how the collection is locked down.

A leak in this codebase has come from each. `scripts/test_diamond.py` →
`PacketPrivacyTests` shows how to pin one shut.
