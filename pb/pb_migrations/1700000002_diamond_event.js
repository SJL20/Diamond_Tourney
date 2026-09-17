migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  if (!events.fields.getByName("pitch_limit_ip")) {
    events.fields.add(new NumberField({ name: "pitch_limit_ip", min: 0 }));
  }
  if (!events.fields.getByName("format")) {
    events.fields.add(new SelectField({
      name: "format",
      maxSelect: 1,
      values: ["imported", "pool-to-bracket", "single-elim"],
    }));
  }
  app.save(events);

  function upsertBy(collectionName, field, value, data) {
    try {
      const existing = app.findFirstRecordByData(collectionName, field, value);
      for (const [k, v] of Object.entries(data)) existing.set(k, v);
      app.save(existing);
      return existing;
    } catch (err) {
      const rec = new Record(app.findCollectionByNameOrId(collectionName));
      rec.set(field, value);
      for (const [k, v] of Object.entries(data)) rec.set(k, v);
      app.save(rec);
      return rec;
    }
  }

  const event = upsertBy("events", "slug", "central-saturday", {
    name: "Central Saturday",
    start: "2026-09-19 00:00:00.000Z",
    end: "2026-09-19 00:00:00.000Z",
    venue: "Central Park Complex",
    ages: "10U",
    public: true,
    status: "live",
    format: "imported",
    pitch_limit_ip: 6,
  });

  try {
    const users = app.findCollectionByNameOrId("users");
    let td;
    try { td = app.findAuthRecordByEmail("users", "td@local.test"); }
    catch (err) { td = new Record(users); td.set("email", "td@local.test"); }
    td.set("password", "EventTd1!");
    td.set("role", "event_td");
    td.set("verified", true);
    app.save(td);
  } catch (err) {}

  function team(name, pool, seed) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    let rec;
    try {
      rec = app.findFirstRecordByFilter("event_teams", "event = {:e} && slug = {:s}", { e: event.id, s: slug });
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_teams"));
    }
    rec.set("event", event.id);
    rec.set("name", name);
    rec.set("slug", slug);
    rec.set("pool", pool);
    rec.set("seed", seed);
    app.save(rec);
    return rec;
  }

  const passion = team("Passion", "A", 1);
  const dukes = team("Lady Dukes", "A", 2);
  const hawks = team("Hawks 10U", "A", 3);
  const outlaws = team("Outlaws", "B", 1);
  const select = team("FP Select", "B", 2);
  const rivals = team("Rivals 10U", "B", 3);

  upsertBy("pools", "name", "A", { event: event.id, tiebreak_notes: "W-L, then H2H, then RA, then RS" });
  try {
    const p = app.findFirstRecordByFilter("pools", "event = {:e} && name = 'B'", { e: event.id });
    p.set("tiebreak_notes", "W-L, then H2H, then RA, then RS");
    app.save(p);
  } catch (err) {
    const p = new Record(app.findCollectionByNameOrId("pools"));
    p.set("event", event.id);
    p.set("name", "B");
    p.set("tiebreak_notes", "W-L, then H2H, then RA, then RS");
    app.save(p);
  }

  function game(date, time, home, away, hr, ar, status) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "event_schedule",
        "event = {:e} && time = {:t} && home = {:h}",
        { e: event.id, t: time, h: home.id },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_schedule"));
    }
    rec.set("event", event.id);
    rec.set("date", date);
    rec.set("time", time);
    rec.set("home", home.id);
    rec.set("away", away.id);
    rec.set("home_runs", hr);
    rec.set("away_runs", ar);
    rec.set("status", status);
    app.save(rec);
    return rec;
  }

  const d = "2026-09-19";
  game(d, "08:00", passion, dukes, 8, 4, "final");
  game(d, "08:00", outlaws, select, 7, 3, "final");
  game(d, "09:30", hawks, passion, 2, 6, "final");
  game(d, "09:30", rivals, outlaws, 1, 9, "final");
  game(d, "11:00", dukes, hawks, 3, 5, "final");
  game(d, "11:00", select, rivals, 8, 4, "final");

  function bracket(round, slot, home, away, hr, ar, winner, status) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "bracket_games",
        "event = {:e} && round = {:r} && slot = {:s}",
        { e: event.id, r: round, s: slot },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("bracket_games"));
    }
    rec.set("event", event.id);
    rec.set("round", round);
    rec.set("slot", slot);
    if (home) rec.set("home_team", home.id);
    if (away) rec.set("away_team", away.id);
    rec.set("home_runs", hr);
    rec.set("away_runs", ar);
    if (winner) rec.set("winner", winner.id);
    rec.set("status", status);
    app.save(rec);
    return rec;
  }

  bracket("SF", 1, passion, select, 7, 3, passion, "final");
  bracket("SF", 2, outlaws, hawks, 0, 0, null, "scheduled");
  bracket("F", 1, passion, null, 0, 0, null, "scheduled");

  function player(team, nameKey, jersey) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "event_players",
        "event_team = {:t} && name_key = {:k}",
        { t: team.id, k: nameKey },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_players"));
    }
    rec.set("event_team", team.id);
    rec.set("name_key", nameKey);
    rec.set("jersey", jersey);
    rec.set("roster_locked", true);
    app.save(rec);
    return rec;
  }

  const doherty = player(passion, "Maeve D #4", "4");
  const calloway = player(dukes, "Riley C #2", "2");
  const vance = player(outlaws, "Jules V #11", "11");
  const reinhart = player(select, "Avery R #6", "6");
  const ava = player(hawks, "Ava B #8", "8");

  function hit(playerRec, ab, r, h, rbi, bb, so) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "event_hitting",
        "event = {:e} && event_player = {:p}",
        { e: event.id, p: playerRec.id },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_hitting"));
    }
    rec.set("event", event.id);
    rec.set("event_player", playerRec.id);
    rec.set("ab", ab); rec.set("r", r); rec.set("h", h);
    rec.set("rbi", rbi); rec.set("bb", bb); rec.set("so", so);
    app.save(rec);
  }

  function pitch(playerRec, ipOuts, h, r, er, bb, so) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "event_pitching",
        "event = {:e} && event_player = {:p}",
        { e: event.id, p: playerRec.id },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_pitching"));
    }
    rec.set("event", event.id);
    rec.set("event_player", playerRec.id);
    rec.set("ip_outs", ipOuts);
    rec.set("h", h); rec.set("r", r); rec.set("er", er);
    rec.set("bb", bb); rec.set("so", so);
    app.save(rec);
  }

  hit(doherty, 9, 6, 6, 7, 1, 0);
  hit(calloway, 8, 4, 5, 4, 0, 1);
  hit(vance, 10, 3, 6, 3, 1, 1);
  hit(reinhart, 9, 4, 5, 6, 2, 0);
  pitch(ava, 12, 5, 3, 2, 1, 6);
  pitch(vance, 10, 7, 4, 3, 2, 4);
}, (app) => {});
