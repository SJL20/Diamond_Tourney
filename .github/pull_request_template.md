## What this changes

<!-- What was wrong or missing, and what it does now. Plain language — the
     owner reads these and does not write code. -->

## How it was verified

<!-- Commands you ran and what came back, or what you clicked and what you saw.
     "Tests pass" on its own is not a verification. If you fixed a bug, say how
     you watched it fail first. -->

```
```

## Checklist

- [ ] `bash scripts/ci.sh` is green locally
- [ ] Any new migration is a **new** numbered file; no merged migration was edited
- [ ] No metric formula changed (youth ERA base 7, BA, Contact%, Strike%, IP thirds)
- [ ] No invented stats — an absent or unreadable value is `null` plus a QC note, not `0`
- [ ] No family email, address, or birthdate is reachable without the right login
- [ ] No credential, `pb/pb_data/`, or `tools/` committed
- [ ] `docs/PROGRESS.md` updated if this changes the state of the project

## If this touches who can read or write what

- [ ] A test fails without this change, and I watched it fail
- [ ] Both surfaces were checked: collection API rules in `pb/pb_migrations/`
      **and** the hook routes in `pb/pb_hooks/` that bypass them
- [ ] Every new API rule is guarded with `@request.auth.id != '' && (...)`, so an
      anonymous caller's empty id cannot match an empty column
- [ ] Authorization is by ownership, not by the `event_td` role — registration
      hands that role to anyone

## Notes for the reviewer

<!-- Anything deliberately left undone, and why. Follow-ups belong in
     docs/PROGRESS.md so they are not lost when this PR is merged. -->
