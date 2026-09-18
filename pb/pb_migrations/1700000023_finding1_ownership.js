/// <reference path="../pb_data/types.d.ts" />

// Finding 1: event_td is handed out at registration. It is a label, not a
// trust boundary. Director writes go through /api/* hooks that check
// events.created_by (or site admin). Collection write rules must match.
//
// Seeded weekends with an empty owner are assigned to td@local.test so the
// local director desk and CI keep working. One owner per event is enough;
// site admin (region_admin / PocketBase superuser) can still run any weekend.
migrate((app) => {
  let td = null;
  try { td = app.findAuthRecordByEmail("users", "td@local.test"); } catch (err) {}
  const rows = app.findRecordsByFilter("events", "", "", 400, 0);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].get("created_by")) continue;
    if (!td) continue;
    rows[i].set("created_by", td.id);
    app.save(rows[i]);
  }

  function ownerOn(eventRel) {
    return "@request.auth.id != '' && (@request.auth.role = 'region_admin' || " + eventRel + "created_by = @request.auth.id)";
  }

  function lockWrites(name, eventRel, opts) {
    const col = app.findCollectionByNameOrId(name);
    const write = ownerOn(eventRel);
    if (!opts || opts.create !== false) col.createRule = write;
    if (!opts || opts.update !== false) col.updateRule = write;
    if (!opts || opts.delete !== false) col.deleteRule = write;
    app.save(col);
  }

  const events = app.findCollectionByNameOrId("events");
  events.updateRule = ownerOn("");
  events.deleteRule = "@request.auth.role = 'region_admin'";
  app.save(events);

  lockWrites("event_teams", "event.");
  lockWrites("pools", "event.");
  lockWrites("fields", "event.");
  lockWrites("event_schedule", "event.");
  lockWrites("bracket_games", "event.");
  lockWrites("event_hitting", "event.");
  lockWrites("event_pitching", "event.");
  try { lockWrites("venue_photos", "event."); } catch (err) {}
  try { lockWrites("sync_log", "event.", { create: false }); } catch (err) {}

  const boxes = app.findCollectionByNameOrId("event_boxes");
  boxes.createRule = ownerOn("schedule_row.event.");
  boxes.updateRule = ownerOn("schedule_row.event.");
  boxes.deleteRule = ownerOn("schedule_row.event.");
  app.save(boxes);

  const players = app.findCollectionByNameOrId("event_players");
  players.createRule = ownerOn("event_team.event.");
  players.updateRule = ownerOn("event_team.event.");
  players.deleteRule = ownerOn("event_team.event.");
  app.save(players);

  const clubs = app.findCollectionByNameOrId("club_teams");
  clubs.createRule = "@request.auth.role = 'region_admin'";
  clubs.updateRule = "@request.auth.role = 'region_admin'";
  clubs.deleteRule = "@request.auth.role = 'region_admin'";
  app.save(clubs);
}, (app) => {
  const anyDirector = "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'";
  function restore(name, create, update, del) {
    const col = app.findCollectionByNameOrId(name);
    col.createRule = create;
    col.updateRule = update;
    col.deleteRule = del;
    app.save(col);
  }
  restore("events", anyDirector, anyDirector, "@request.auth.role = 'region_admin'");
  restore("event_teams", anyDirector, anyDirector, "@request.auth.role = 'region_admin'");
  restore("pools", anyDirector, anyDirector, "@request.auth.role = 'region_admin'");
  restore("fields", anyDirector, anyDirector, anyDirector);
  restore("event_schedule", anyDirector + " || @request.auth.role = 'bot'", anyDirector + " || @request.auth.role = 'bot'", "@request.auth.role = 'region_admin'");
  restore("bracket_games", anyDirector + " || @request.auth.role = 'bot'", anyDirector + " || @request.auth.role = 'bot'", "@request.auth.role = 'region_admin'");
  restore("event_boxes", "@request.auth.id != ''", anyDirector + " || @request.auth.id != ''", "@request.auth.role = 'region_admin'");
});
