/// <reference path="../pb_data/types.d.ts" />

// Public board should only show Keystone Clash plus one FAKE practice weekend.
// Central Saturday and leftover test events (packet-classic, privacy-*, etc.)
// go away. Harbor Eight is eight labeled-FAKE clubs, two pools, a Saturday
// round-robin with no scores, and an empty Sunday bracket. No player lines —
// outline §1, do not invent stats.
//
// Each club has a team_coach login. event_teams.account is that coach, so they
// can post a result for their own games. No family emails are stored.
migrate((app) => {
  const KEEP = { "keystone-clash-2026": true, "harbor-eight": true };

  function deleteWhere(collection, filter, params) {
    try {
      const rows = app.findRecordsByFilter(collection, filter, "", 500, 0, params || {});
      for (let i = 0; i < rows.length; i++) app.delete(rows[i]);
    } catch (err) {}
  }

  function wipeEvent(event) {
    const kids = [
      "event_hitting", "event_pitching", "event_boxes", "event_schedule",
      "bracket_games", "pools", "team_docs", "sync_log", "fields",
    ];
    for (let i = 0; i < kids.length; i++) {
      deleteWhere(kids[i], "event = {:e}", { e: event.id });
    }
    let teams = [];
    try {
      teams = app.findRecordsByFilter("event_teams", "event = {:e}", "", 200, 0, { e: event.id });
    } catch (err) {}
    for (let i = 0; i < teams.length; i++) {
      deleteWhere("event_players", "event_team = {:t}", { t: teams[i].id });
      app.delete(teams[i]);
    }
    app.delete(event);
  }

  const events = app.findRecordsByFilter("events", "", "", 200, 0);
  for (let i = 0; i < events.length; i++) {
    if (!KEEP[events[i].get("slug")]) wipeEvent(events[i]);
  }

  try {
    const keystone = app.findFirstRecordByData("events", "slug", "keystone-clash-2026");
    keystone.set("signup_open", false);
    app.save(keystone);
  } catch (err) {}

  function upsertBy(collectionName, field, value, data) {
    let rec;
    try {
      rec = app.findFirstRecordByData(collectionName, field, value);
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId(collectionName));
      rec.set(field, value);
    }
    const keys = Object.keys(data);
    for (let i = 0; i < keys.length; i++) rec.set(keys[i], data[keys[i]]);
    app.save(rec);
    return rec;
  }

  let td;
  try { td = app.findAuthRecordByEmail("users", "td@local.test"); }
  catch (err) {
    td = new Record(app.findCollectionByNameOrId("users"));
    td.set("email", "td@local.test");
    td.set("password", "EventTd1!");
    td.set("role", "event_td");
    td.set("verified", true);
    td.set("display_name", "Event Director");
    app.save(td);
  }

  const event = upsertBy("events", "slug", "harbor-eight", {
    name: "Harbor Eight (FAKE)",
    start: "2026-10-03 00:00:00.000Z",
    end: "2026-10-04 00:00:00.000Z",
    venue: "Harbor Sports Complex",
    address: "200 Harbor Road, Testville, PA",
    ages: "10U",
    public: true,
    status: "live",
    format: "pool-to-bracket",
    source: "native",
    signup_open: false,
    auto_sync: false,
    pitch_limit_ip: 6,
    pitch_limit_mode: "ip",
    rain_status: "clear",
    hours_start: "08:00",
    hours_end: "18:00",
    created_by: td.id,
    packet_notes: "FAKE practice weekend. Eight made-up clubs so a director can walk the board. No real players.",
  });

  function upsertPool(name) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter("pools", "event = {:e} && name = {:n}", { e: event.id, n: name });
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("pools"));
      rec.set("event", event.id);
      rec.set("name", name);
    }
    rec.set("tiebreak_notes", "W-L, then H2H, then RA, then RS");
    app.save(rec);
    return rec;
  }
  upsertPool("A");
  upsertPool("B");

  function upsertField(name) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter("fields", "event = {:e} && name = {:n}", { e: event.id, n: name });
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("fields"));
      rec.set("event", event.id);
      rec.set("name", name);
    }
    rec.set("status", "open");
    rec.set("surface", "turf");
    rec.set("lights", true);
    rec.set("address", "200 Harbor Road, Testville, PA");
    rec.set("availability", [
      { date: "2026-10-03", available: true, start: "08:00", end: "18:00" },
      { date: "2026-10-04", available: true, start: "08:00", end: "18:00" },
    ]);
    app.save(rec);
    return rec;
  }
  const f1 = upsertField("Harbor 1");
  const f2 = upsertField("Harbor 2");

  const clubs = [
    { name: "Harbor Oaks 10U (FAKE)", pool: "A", seed: 1, email: "coach.oaks@local.test", pass: "CoachOaks1!", coach: "Coach Oaks" },
    { name: "River City 10U (FAKE)", pool: "A", seed: 2, email: "coach.river@local.test", pass: "CoachRiver1!", coach: "Coach River" },
    { name: "Maple Ridge 10U (FAKE)", pool: "A", seed: 3, email: "coach.maple@local.test", pass: "CoachMaple1!", coach: "Coach Maple" },
    { name: "Lakeview 10U (FAKE)", pool: "A", seed: 4, email: "coach.lake@local.test", pass: "CoachLake1!", coach: "Coach Lake" },
    { name: "Iron Bridge 10U (FAKE)", pool: "B", seed: 1, email: "coach.iron@local.test", pass: "CoachIron1!", coach: "Coach Iron" },
    { name: "Pine Hollow 10U (FAKE)", pool: "B", seed: 2, email: "coach.pine@local.test", pass: "CoachPine1!", coach: "Coach Pine" },
    { name: "Cedar Falls 10U (FAKE)", pool: "B", seed: 3, email: "coach.cedar@local.test", pass: "CoachCedar1!", coach: "Coach Cedar" },
    { name: "Westfield 10U (FAKE)", pool: "B", seed: 4, email: "coach.west@local.test", pass: "CoachWest1!", coach: "Coach West" },
  ];

  function upsertUser(email, password, display) {
    let user;
    try {
      user = app.findAuthRecordByEmail("users", email);
    } catch (err) {
      user = new Record(app.findCollectionByNameOrId("users"));
      user.set("email", email);
    }
    user.set("password", password);
    user.set("role", "team_coach");
    user.set("verified", true);
    user.set("display_name", display + " (FAKE)");
    app.save(user);
    return user;
  }

  const bySlug = {};
  for (let i = 0; i < clubs.length; i++) {
    const c = clubs[i];
    const slug = c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const user = upsertUser(c.email, c.pass, c.coach);
    let rec;
    try {
      rec = app.findFirstRecordByFilter("event_teams", "event = {:e} && slug = {:s}", { e: event.id, s: slug });
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_teams"));
      rec.set("event", event.id);
      rec.set("slug", slug);
    }
    rec.set("name", c.name);
    rec.set("pool", c.pool);
    rec.set("seed", c.seed);
    rec.set("account", user.id);
    rec.set("signed_up_by", "director");
    rec.set("gc_sync_status", "unlinked");
    rec.set("packet_status", "incomplete");
    app.save(rec);
    bySlug[slug] = rec;
  }

  function team(shortName) {
    const keys = Object.keys(bySlug);
    for (let i = 0; i < keys.length; i++) {
      if (bySlug[keys[i]].get("name").indexOf(shortName) === 0) return bySlug[keys[i]];
    }
    throw new Error("missing team " + shortName);
  }

  const oaks = team("Harbor Oaks");
  const river = team("River City");
  const maple = team("Maple Ridge");
  const lake = team("Lakeview");
  const iron = team("Iron Bridge");
  const pine = team("Pine Hollow");
  const cedar = team("Cedar Falls");
  const west = team("Westfield");

  function game(time, fieldRec, home, away, pool) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "event_schedule",
        "event = {:e} && date = {:d} && time = {:t} && field_name = {:f}",
        { e: event.id, d: "2026-10-03", t: time, f: fieldRec.get("name") },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_schedule"));
      rec.set("event", event.id);
    }
    rec.set("date", "2026-10-03");
    rec.set("time", time);
    rec.set("field", fieldRec.id);
    rec.set("field_name", fieldRec.get("name"));
    rec.set("home", home.id);
    rec.set("away", away.id);
    rec.set("pool", pool);
    rec.set("status", "scheduled");
    rec.set("home_runs", 0);
    rec.set("away_runs", 0);
    app.save(rec);
  }

  // Pool A and B each play a 4-team round-robin. No scores.
  game("08:00", f1, oaks, river, "A");
  game("08:00", f2, maple, lake, "A");
  game("09:45", f1, iron, pine, "B");
  game("09:45", f2, cedar, west, "B");
  game("11:30", f1, oaks, maple, "A");
  game("11:30", f2, river, lake, "A");
  game("13:15", f1, iron, cedar, "B");
  game("13:15", f2, pine, west, "B");
  game("15:00", f1, oaks, lake, "A");
  game("15:00", f2, river, maple, "A");
  game("16:45", f1, iron, west, "B");
  game("16:45", f2, pine, cedar, "B");

  function bracket(round, slot, side, date, time, fieldName) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "bracket_games",
        "event = {:e} && round = {:r} && slot = {:s}",
        { e: event.id, r: round, s: slot },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("bracket_games"));
      rec.set("event", event.id);
      rec.set("round", round);
      rec.set("slot", slot);
    }
    rec.set("side", side);
    rec.set("status", "scheduled");
    rec.set("date", date);
    rec.set("time", time);
    rec.set("field_name", fieldName);
    rec.set("home_runs", 0);
    rec.set("away_runs", 0);
    app.save(rec);
  }

  // Empty Sunday tree — director draws from standings after pool play.
  bracket("QF", 1, "championship", "2026-10-04", "09:00", "Harbor 1");
  bracket("QF", 2, "championship", "2026-10-04", "09:00", "Harbor 2");
  bracket("QF", 3, "championship", "2026-10-04", "10:45", "Harbor 1");
  bracket("QF", 4, "championship", "2026-10-04", "10:45", "Harbor 2");
  bracket("SF", 1, "championship", "2026-10-04", "13:15", "Harbor 1");
  bracket("SF", 2, "championship", "2026-10-04", "13:15", "Harbor 2");
  bracket("F", 1, "championship", "2026-10-04", "16:00", "Harbor 1");
  bracket("5TH", 1, "consolation", "2026-10-04", "13:15", "Harbor 1");
  bracket("3RD", 1, "consolation", "2026-10-04", "15:00", "Harbor 2");
  bracket("7TH", 1, "consolation", "2026-10-04", "15:00", "Harbor 1");
}, (app) => {
  try {
    const event = app.findFirstRecordByData("events", "slug", "harbor-eight");
    const kids = [
      "event_hitting", "event_pitching", "event_boxes", "event_schedule",
      "bracket_games", "pools", "team_docs", "sync_log", "fields",
    ];
    for (let i = 0; i < kids.length; i++) {
      try {
        const rows = app.findRecordsByFilter(kids[i], "event = {:e}", "", 200, 0, { e: event.id });
        for (let j = 0; j < rows.length; j++) app.delete(rows[j]);
      } catch (err) {}
    }
    const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "", 40, 0, { e: event.id });
    for (let i = 0; i < teams.length; i++) app.delete(teams[i]);
    app.delete(event);
  } catch (err) {}
});
