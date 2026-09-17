migrate((app) => {
  const settings = app.settings();
  settings.meta.appName = "Region Softball";
  settings.meta.appURL = "http://127.0.0.1:8097";
  app.save(settings);

  const adminEmail = $os.getenv("PB_ADMIN_EMAIL") || "admin@local.test";
  const adminPass = $os.getenv("PB_ADMIN_PASSWORD") || "SoftballAdmin1!";
  try {
    app.findAuthRecordByEmail("_superusers", adminEmail);
  } catch (err) {
    const supers = app.findCollectionByNameOrId("_superusers");
    const su = new Record(supers);
    su.set("email", adminEmail);
    su.set("password", adminPass);
    app.save(su);
  }

  function upsertBy(collectionName, field, value, data) {
    try {
      const existing = app.findFirstRecordByData(collectionName, field, value);
      for (const [k, v] of Object.entries(data)) {
        existing.set(k, v);
      }
      app.save(existing);
      return existing;
    } catch (err) {
      const col = app.findCollectionByNameOrId(collectionName);
      const rec = new Record(col);
      rec.set(field, value);
      for (const [k, v] of Object.entries(data)) {
        rec.set(k, v);
      }
      app.save(rec);
      return rec;
    }
  }

  const org = upsertBy("orgs", "slug", "region", {
    name: "Region Softball",
    season_label: "2026 Summer",
  });

  const season = upsertBy("seasons", "label", "2026 Summer", {
    start: "2026-05-01 00:00:00.000Z",
    end: "2026-08-15 00:00:00.000Z",
    org: org.id,
  });

  upsertBy("fields", "name", "Central Park Complex", {
    address: "100 Diamond Way",
    surface: "turf",
    lights: true,
    notes: "Park in the north lot. No metal cleats on turf.",
    status: "open",
  });

  const demo = upsertBy("teams", "slug", "demo", {
    name: "Demo 10U (FAKE)",
    age_group: "10U",
    season: season.id,
    coach_name: "Coach Demo",
    coach_note: "FAKE team for Phase 0. Replace with a real roster before publishing.",
    public_record_wins: 1,
    public_record_losses: 0,
    public_record_ties: 0,
  });

  const hawks = upsertBy("teams", "slug", "hawks-10u", {
    name: "Hawks 10U",
    age_group: "10U",
    season: season.id,
    coach_name: "Coach Rivera",
    coach_note: "Weeknight practice Tuesday/Thursday. Saturday games.",
    public_record_wins: 0,
    public_record_losses: 0,
    public_record_ties: 0,
  });

  const rivals = upsertBy("teams", "slug", "rivals-10u", {
    name: "Rivals 10U",
    age_group: "10U",
    season: season.id,
    coach_name: "Coach Nguyen",
    coach_note: "ACL fixture team — coaches cannot open another team's book.",
    public_record_wins: 0,
    public_record_losses: 0,
    public_record_ties: 0,
  });

  function upsertUser(email, password, role, teamId) {
    let user;
    try {
      user = app.findAuthRecordByEmail("users", email);
    } catch (err) {
      const users = app.findCollectionByNameOrId("users");
      user = new Record(users);
      user.set("email", email);
      user.set("password", password);
    }
    user.set("password", password);
    user.set("role", role);
    if (teamId) user.set("team", teamId);
    user.set("verified", true);
    app.save(user);
    return user;
  }

  upsertUser("owner@local.test", "RegionAdmin1!", "region_admin", "");
  upsertUser("bot@local.test", "BotStaging1!", "bot", "");
  upsertUser("coach.demo@local.test", "CoachDemo1!", "team_coach", demo.id);
  upsertUser("coach.hawks@local.test", "CoachHawks1!", "team_coach", hawks.id);
  upsertUser("coach.rivals@local.test", "CoachRivals1!", "team_coach", rivals.id);

  function upsertPlayer(team, display, jersey, positions, bats, throws) {
    const last = display.split(" ").pop();
    const first = display.slice(0, display.length - last.length).trim();
    const key = first + " " + last.charAt(0).toUpperCase() + " #" + jersey;
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "players",
        "team = {:team} && name_key = {:key}",
        { team: team.id, key: key },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("players"));
    }
    rec.set("team", team.id);
    rec.set("display_name", display);
    rec.set("name_key", key);
    rec.set("jersey", String(jersey));
    rec.set("positions", positions);
    rec.set("bats", bats);
    rec.set("throws", throws);
    rec.set("grad_year", 2034);
    rec.set("active", true);
    app.save(rec);
    return rec;
  }

  const fakeA = upsertPlayer(demo, "Avery FAKE", "4", "SS", "R", "R");
  const fakeB = upsertPlayer(demo, "Blake FAKE", "11", "P, 1B", "L", "L");
  const fakeC = upsertPlayer(demo, "Casey FAKE", "22", "C", "R", "R");

  const hawksRoster = [
    ["Mia Alvarez", "3", "2B", "R", "R"],
    ["Evelynn Moore", "17", "SS", "R", "R"],
    ["Ava Brooks", "8", "P, 1B", "L", "L"],
    ["Sofia Patel", "5", "C", "R", "R"],
    ["Harper Quinn", "12", "OF", "L", "R"],
    ["Zoe Nguyen", "21", "3B", "R", "R"],
    ["Lily Chen", "7", "OF", "R", "R"],
    ["Nora Diaz", "14", "P, OF", "R", "R"],
    ["Ruby Santos", "2", "1B", "L", "L"],
    ["Chloe Bennett", "9", "OF", "R", "R"],
    ["Isla Romero", "18", "2B", "R", "R"],
    ["Paisley Hart", "24", "C, OF", "R", "R"],
  ];
  const hawksPlayers = {};
  for (const row of hawksRoster) {
    hawksPlayers[row[1]] = upsertPlayer(hawks, row[0], row[1], row[2], row[3], row[4]);
  }

  upsertPlayer(rivals, "Jordan Lee", "1", "SS", "R", "R");

  let demoGame;
  try {
    demoGame = app.findFirstRecordByData("team_games", "source_ref", "seed:demo:fake-1");
  } catch (err) {
    demoGame = new Record(app.findCollectionByNameOrId("team_games"));
  }
  demoGame.set("team", demo.id);
  demoGame.set("date", "2026-06-01");
  demoGame.set("opponent", "Practice Squad");
  demoGame.set("us_runs", 7);
  demoGame.set("them_runs", 3);
  demoGame.set("result", "W");
  demoGame.set("source", "manual");
  demoGame.set("status", "approved");
  demoGame.set("source_ref", "seed:demo:fake-1");
  demoGame.set("dedup_key", demo.id + "|2026-06-01|practice squad|7-3");
  app.save(demoGame);

  function upsertHit(game, player, ab, r, h, rbi, bb, so) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "hitting_game",
        "game = {:g} && player = {:p}",
        { g: game.id, p: player.id },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("hitting_game"));
    }
    rec.set("game", game.id);
    rec.set("player", player.id);
    rec.set("ab", ab);
    rec.set("r", r);
    rec.set("h", h);
    rec.set("rbi", rbi);
    rec.set("bb", bb);
    rec.set("so", so);
    app.save(rec);
  }

  function upsertPitch(game, player, ipOuts, h, r, er, bb, so, pitches, strikes) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "pitching_game",
        "game = {:g} && player = {:p}",
        { g: game.id, p: player.id },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("pitching_game"));
    }
    rec.set("game", game.id);
    rec.set("player", player.id);
    rec.set("ip_outs", ipOuts);
    rec.set("h", h);
    rec.set("r", r);
    rec.set("er", er);
    rec.set("bb", bb);
    rec.set("so", so);
    rec.set("pitches", pitches);
    rec.set("strikes", strikes);
    app.save(rec);
  }

  upsertHit(demoGame, fakeA, 3, 2, 2, 1, 0, 0);
  upsertHit(demoGame, fakeB, 2, 1, 1, 2, 1, 0);
  upsertHit(demoGame, fakeC, 3, 0, 0, 0, 0, 1);
  upsertPitch(demoGame, fakeB, 12, 4, 3, 2, 1, 5, 58, 38);
}, (app) => {
  // keep seed data on down
});
