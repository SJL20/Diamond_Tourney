# Contributing

Welcome. This repo runs **Diamond Tourney** (public tournament boards) and the
region **season books** (behind a coach login) off a single PocketBase box.

Read these first, in this order:

1. `docs/PROGRESS.md` — where the project actually is, and what is broken.
2. `AGENTS.md` — the rules. They bind people as well as agents.
3. `SOFTBALL-PLATFORM-BOT-OUTLINE.md` — the spec, especially §1, §5, and §15.

## Get it running

You need Python 3.12+, `curl`, and `unzip`. No Node, no build step — the
frontend is plain ES modules served straight out of `pb/pb_public/`.

```bash
git clone https://github.com/SJL20/Diamond_Tourney.git
cd Diamond_Tourney
bash scripts/install-pocketbase.sh   # downloads the PocketBase binary
bash scripts/local-server.sh         # serves http://127.0.0.1:8097
```

`local-server.sh` is safe to re-run. It will not kill a healthy listener, and it
prints the URLs worth opening. Local logins are in
`scripts/local-accounts.txt` — dev only, never production.

The PocketBase admin UI is at http://127.0.0.1:8097/_/.

## Run the tests

```bash
bash scripts/ci.sh
```

That is exactly what CI runs: it brings PocketBase up, runs
`scripts/test_metrics.py` and `scripts/test_diamond.py`, then
`scripts/acceptance_test.py`. Expect 42 cases and 13 acceptance checks.

Narrower loops while you work:

```bash
python3 -m unittest scripts.test_metrics -v                       # formulas, no server needed
python3 -m unittest scripts.test_diamond.PacketPrivacyTests -v    # one class
python3 scripts/acceptance_test.py                                # outline §15 only
PB_PORT=8099 bash scripts/ci.sh                                   # a throwaway port
```

A red suite is never "probably fine." Two of the tests exist because a real
privacy leak shipped to a public repo.

## How the pieces fit

| Path | What lives there |
|---|---|
| `pb/pb_hooks/` | All server logic. `main.pb.js` holds the route table; the rest are libraries it requires |
| `pb/pb_migrations/` | Schema and API rules. Numbered, applied in order, never edited once merged |
| `pb/pb_public/` | The browser app. `app.js` routes and owns season books, `event.js` owns tournaments, `chrome.js` draws the nav bars |
| `lib/` | Python formulas and standings, shared by bots and tests |
| `scripts/` | Server lifecycle, the bots, and the test suite |

Two rules that are easy to get wrong:

- **Migrations are append-only.** Add `1700000017_....js`; do not edit an
  already-merged migration. It has run on the production volume and will not
  run again.
- **Hooks bypass API rules.** Code in `pb/pb_hooks/` queries with app context,
  so a collection's `listRule` does not protect it. If a hook returns a field,
  it is published. Both are true and you need both to be right.

## The non-negotiables

`AGENTS.md` has the full list. The ones that actually get violated:

- **Never invent a stat.** An unreadable or absent value is `null` plus a QC
  note. Not `0`. A stored zero looks exactly like a real zero forever.
- **Never change a metric formula.** Youth ERA is `(ER * 7) / IP`. BA is three
  decimals. IP is summed in outs, then converted.
- **Player identity is `Firstname LastInitial #jersey`** — `Evelynn M #17`.
  Never the batting-order row.
- **Never publish a family email, address, or birthdate.** A birth certificate
  is all three. Anything reachable without a login is published, including raw
  `/api/collections/...` endpoints, not just the pages you wrote.
- **A bot never approves its own staging**, and never deletes an approved row.
- **Dedup on `team_id + date + opponent + score`.** Never double-count a game.

## Branches, commits, and pull requests

- Branch off `main`. Agents use `cursor/<description>-<suffix>`; humans can use
  anything descriptive.
- One logical change per commit. Explain *why* in the body — what was broken and
  how you know it is fixed. The subject line is not enough.
- Open a pull request against `main` and fill in the template. Say how you
  verified it; "tests pass" on its own is not a verification.
- Do not commit `pb/pb_data/` or `tools/` (both gitignored). Never commit a
  production credential — this repo is public.
- CI must be green before merge.

## Touching privacy or authorization

If your change affects who can read what, add a test that fails without the fix
and say in the PR that you watched it fail. `PacketPrivacyTests` in
`scripts/test_diamond.py` is the pattern to copy.

One PocketBase trap worth memorizing: for an unauthenticated request,
`@request.auth.id` is the empty string. A rule like
`uploaded_by = @request.auth.id` therefore compares `"" = ""` and **matches**
every row with an empty `uploaded_by`. Always guard the clause:

```
@request.auth.id != '' && (  ...your ownership checks...  )
```

Also: `@request.auth.role = 'event_td'` is **not** an authorization check.
`/api/account/register` is public and hands that role to anyone who signs up.
Check ownership — `events.created_by`, `event_co_owners`, `event_teams.account` — instead.
Co-owner emails stay off public `eventJson` (board / Find / year). Only `/plan`
and owner setup routes include the list.

## Reporting something sensitive

Do not open a public issue for a data-exposure bug. See `SECURITY.md`.
