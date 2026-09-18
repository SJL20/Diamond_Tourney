/// <reference path="../pb_data/types.d.ts" />

// Outline §1: do not publish family emails, addresses, or birthdates.
//
// Three rules broke that promise.
//
// 1. team_docs list/view ended in `@request.auth.id != ''`, so any account
//    could list every event's packet, including `birth_certs` — a child's
//    birthdate and address. `/api/account/register` is open, so "any account"
//    meant anyone.
// 2. event_teams list/view were public (""), so an anonymous
//    `GET /api/collections/event_teams/records` returned `contact_email` for
//    every team. `teamJson` withholds it; the raw REST collection did not.
// 3. club_teams had the same public `contact_email`.
//
// `event_td` cannot appear in these rules. Registration hands that role out,
// so it is a label, not a trust boundary. Scope by ownership instead: the
// region admin, the director who created the event, the uploader, or the
// account that signed the team up.
//
// The public board keeps working because every public read goes through an
// /api/* hook, and hooks query with app context rather than API rules.
//
// Every rule below is wrapped in `@request.auth.id != '' && (...)`. Without
// that guard an anonymous caller compares `"" = ""` against an empty
// `uploaded_by` or `account`, which matches — a team that signs itself up has
// no account, so its birth certificates would stay world-readable.
migrate((app) => {
  function ownerOnly(clauses) {
    return "@request.auth.id != '' && (" + clauses.join(" || ") + ")";
  }

  const docs = app.findCollectionByNameOrId("team_docs");
  docs.listRule = docs.viewRule = ownerOnly([
    "@request.auth.role = 'region_admin'",
    "event.created_by = @request.auth.id",
    "uploaded_by = @request.auth.id",
    "event_team.account = @request.auth.id",
  ]);
  // A packet URL that escapes into a screenshot or a browser history should
  // stop working. Protected files require a short-lived file token, which
  // PocketBase only mints for a caller the view rule already allows.
  const file = docs.fields.getByName("file");
  if (file) {
    file.protected = true;
    app.save(docs);
  } else {
    app.save(docs);
  }

  const eventTeams = app.findCollectionByNameOrId("event_teams");
  eventTeams.listRule = eventTeams.viewRule = ownerOnly([
    "@request.auth.role = 'region_admin'",
    "event.created_by = @request.auth.id",
    "account = @request.auth.id",
    "contact_email = @request.auth.email",
  ]);
  app.save(eventTeams);

  const clubs = app.findCollectionByNameOrId("club_teams");
  clubs.listRule = clubs.viewRule = ownerOnly([
    "@request.auth.role = 'region_admin'",
    "contact_email = @request.auth.email",
  ]);
  app.save(clubs);
}, (app) => {
  const docs = app.findCollectionByNameOrId("team_docs");
  const anyAccount = "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.id != ''";
  docs.listRule = anyAccount;
  docs.viewRule = anyAccount;
  const file = docs.fields.getByName("file");
  if (file) file.protected = false;
  app.save(docs);

  const eventTeams = app.findCollectionByNameOrId("event_teams");
  eventTeams.listRule = "";
  eventTeams.viewRule = "";
  app.save(eventTeams);

  const clubs = app.findCollectionByNameOrId("club_teams");
  clubs.listRule = "";
  clubs.viewRule = "";
  app.save(clubs);
});
