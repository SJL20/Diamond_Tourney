migrate((app) => {
  const publicReadAdminWrite = {
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin'",
    updateRule: "@request.auth.role = 'region_admin'",
    deleteRule: "@request.auth.role = 'region_admin'",
  };

  const orgs = new Collection({
    name: "orgs",
    type: "base",
    ...publicReadAdminWrite,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "slug", type: "text", required: true },
      { name: "season_label", type: "text" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_orgs_slug ON orgs (slug)"],
  });
  app.save(orgs);

  const seasons = new Collection({
    name: "seasons",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin'",
    updateRule: "@request.auth.role = 'region_admin'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "label", type: "text", required: true },
      { name: "start", type: "date" },
      { name: "end", type: "date" },
      { name: "org", type: "relation", collectionId: orgs.id, maxSelect: 1, cascadeDelete: false },
    ],
  });
  app.save(seasons);

  const fields = new Collection({
    name: "fields",
    type: "base",
    ...publicReadAdminWrite,
    fields: [
      { name: "name", type: "text", required: true },
      { name: "address", type: "text" },
      { name: "surface", type: "text" },
      { name: "lights", type: "bool" },
      { name: "notes", type: "text" },
      { name: "status", type: "select", maxSelect: 1, values: ["open", "closed", "wet"] },
    ],
  });
  app.save(fields);

  const posts = new Collection({
    name: "posts",
    type: "base",
    listRule: "public = true || @request.auth.role = 'region_admin' || @request.auth.role = 'bot'",
    viewRule: "public = true || @request.auth.role = 'region_admin' || @request.auth.role = 'bot'",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot'",
    updateRule: "@request.auth.role = 'region_admin'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "body", type: "editor" },
      { name: "published_at", type: "date" },
      { name: "public", type: "bool" },
      { name: "team", type: "relation", collectionId: "", maxSelect: 1 },
    ],
  });
  app.save(posts);

  const inquiries = new Collection({
    name: "inquiries",
    type: "base",
    listRule: "@request.auth.role = 'region_admin'",
    viewRule: "@request.auth.role = 'region_admin'",
    createRule: "",
    updateRule: "@request.auth.role = 'region_admin'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "email", type: "email", required: true },
      { name: "kind", type: "select", maxSelect: 1, values: ["team", "td", "other"] },
      { name: "message", type: "text", required: true },
    ],
  });
  app.save(inquiries);

  const teams = new Collection({
    name: "teams",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "slug", type: "text", required: true },
      { name: "age_group", type: "select", maxSelect: 1, values: ["10U", "12U", "14U", "16U", "18U"] },
      { name: "season", type: "relation", collectionId: seasons.id, maxSelect: 1 },
      { name: "coach_name", type: "text" },
      { name: "coach_note", type: "text" },
      { name: "public_record_wins", type: "number", min: 0 },
      { name: "public_record_losses", type: "number", min: 0 },
      { name: "public_record_ties", type: "number", min: 0 },
      { name: "logo", type: "file", maxSelect: 1, maxSize: 2097152, mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"] },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_teams_slug ON teams (slug)"],
  });
  app.save(teams);

  const postsFresh = app.findCollectionByNameOrId("posts");
  const teamField = postsFresh.fields.getByName("team");
  teamField.collectionId = teams.id;
  app.save(postsFresh);

  const users = app.findCollectionByNameOrId("users");
  users.listRule = "id = @request.auth.id || @request.auth.role = 'region_admin'";
  users.viewRule = "id = @request.auth.id || @request.auth.role = 'region_admin'";
  users.updateRule = "id = @request.auth.id || @request.auth.role = 'region_admin'";
  users.createRule = "@request.auth.role = 'region_admin'";
  users.fields.add(new SelectField({
    name: "role",
    required: true,
    maxSelect: 1,
    values: ["region_admin", "team_coach", "event_td", "bot", "public"],
  }));
  users.fields.add(new RelationField({
    name: "team",
    collectionId: teams.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  app.save(users);

  const teamBookRead = "@request.auth.role = 'region_admin' || @request.auth.role = 'bot' || (@request.auth.role = 'team_coach' && team = @request.auth.team)";
  const teamBookWriteAdmin = "@request.auth.role = 'region_admin'";

  const players = new Collection({
    name: "players",
    type: "base",
    listRule: teamBookRead,
    viewRule: teamBookRead,
    createRule: teamBookWriteAdmin + " || @request.auth.role = 'team_coach' && team = @request.auth.team",
    updateRule: teamBookWriteAdmin + " || @request.auth.role = 'team_coach' && team = @request.auth.team",
    deleteRule: teamBookWriteAdmin,
    fields: [
      { name: "team", type: "relation", collectionId: teams.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "display_name", type: "text", required: true },
      { name: "name_key", type: "text", required: true },
      { name: "jersey", type: "text", required: true },
      { name: "positions", type: "text" },
      { name: "bats", type: "select", maxSelect: 1, values: ["L", "R", "S"] },
      { name: "throws", type: "select", maxSelect: 1, values: ["L", "R"] },
      { name: "grad_year", type: "number" },
      { name: "active", type: "bool" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_players_team_name_key ON players (team, name_key)"],
  });
  app.save(players);

  const teamGames = new Collection({
    name: "team_games",
    type: "base",
    listRule: teamBookRead,
    viewRule: teamBookRead,
    createRule: teamBookWriteAdmin + " || @request.auth.role = 'bot'",
    updateRule: teamBookWriteAdmin,
    deleteRule: teamBookWriteAdmin,
    fields: [
      { name: "team", type: "relation", collectionId: teams.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "date", type: "text", required: true },
      { name: "opponent", type: "text", required: true },
      { name: "us_runs", type: "number", required: true },
      { name: "them_runs", type: "number", required: true },
      { name: "result", type: "select", maxSelect: 1, values: ["W", "L", "T"] },
      { name: "source", type: "select", maxSelect: 1, values: ["gc", "manual"] },
      { name: "status", type: "select", maxSelect: 1, values: ["staged", "approved", "rejected"] },
      { name: "source_ref", type: "text" },
      { name: "dedup_key", type: "text" },
      { name: "staging", type: "relation", collectionId: "", maxSelect: 1 },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_team_games_dedup ON team_games (dedup_key)"],
  });
  app.save(teamGames);

  const hittingGame = new Collection({
    name: "hitting_game",
    type: "base",
    listRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot' || (@request.auth.role = 'team_coach' && game.team = @request.auth.team)",
    viewRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot' || (@request.auth.role = 'team_coach' && game.team = @request.auth.team)",
    createRule: teamBookWriteAdmin + " || @request.auth.role = 'bot'",
    updateRule: teamBookWriteAdmin,
    deleteRule: teamBookWriteAdmin,
    fields: [
      { name: "game", type: "relation", collectionId: teamGames.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "player", type: "relation", collectionId: players.id, required: true, maxSelect: 1, cascadeDelete: false },
      { name: "ab", type: "number" },
      { name: "r", type: "number" },
      { name: "h", type: "number" },
      { name: "rbi", type: "number" },
      { name: "bb", type: "number" },
      { name: "so", type: "number" },
      { name: "extra_notes", type: "text" },
    ],
  });
  app.save(hittingGame);

  const pitchingGame = new Collection({
    name: "pitching_game",
    type: "base",
    listRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot' || (@request.auth.role = 'team_coach' && game.team = @request.auth.team)",
    viewRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot' || (@request.auth.role = 'team_coach' && game.team = @request.auth.team)",
    createRule: teamBookWriteAdmin + " || @request.auth.role = 'bot'",
    updateRule: teamBookWriteAdmin,
    deleteRule: teamBookWriteAdmin,
    fields: [
      { name: "game", type: "relation", collectionId: teamGames.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "player", type: "relation", collectionId: players.id, required: true, maxSelect: 1, cascadeDelete: false },
      { name: "ip_outs", type: "number" },
      { name: "h", type: "number" },
      { name: "r", type: "number" },
      { name: "er", type: "number" },
      { name: "bb", type: "number" },
      { name: "so", type: "number" },
      { name: "pitches", type: "number" },
      { name: "strikes", type: "number" },
    ],
  });
  app.save(pitchingGame);

  const stagingGames = new Collection({
    name: "staging_games",
    type: "base",
    listRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot' || (@request.auth.role = 'team_coach' && team = @request.auth.team)",
    viewRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'bot' || (@request.auth.role = 'team_coach' && team = @request.auth.team)",
    createRule: "@request.auth.role = 'bot' || @request.auth.role = 'region_admin' || (@request.auth.role = 'team_coach' && team = @request.auth.team)",
    updateRule: "@request.auth.role = 'region_admin' || (@request.auth.role = 'team_coach' && team = @request.auth.team)",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "team", type: "relation", collectionId: teams.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "payload", type: "json" },
      { name: "parser_notes", type: "text" },
      { name: "status", type: "select", maxSelect: 1, values: ["staged", "needs_review", "approved", "rejected"] },
      { name: "images", type: "file", maxSelect: 8, maxSize: 10485760, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      { name: "applied_game", type: "relation", collectionId: teamGames.id, maxSelect: 1 },
    ],
  });
  app.save(stagingGames);

  const tg = app.findCollectionByNameOrId("team_games");
  const stagingRel = tg.fields.getByName("staging");
  stagingRel.collectionId = stagingGames.id;
  app.save(tg);

  const events = new Collection({
    name: "events",
    type: "base",
    listRule: "public = true || @request.auth.id != ''",
    viewRule: "public = true || @request.auth.id != ''",
    createRule: "@request.auth.role = 'region_admin'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "name", type: "text", required: true },
      { name: "slug", type: "text", required: true },
      { name: "start", type: "date" },
      { name: "end", type: "date" },
      { name: "venue", type: "text" },
      { name: "ages", type: "text" },
      { name: "public", type: "bool" },
      { name: "status", type: "select", maxSelect: 1, values: ["draft", "live", "archived"] },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_events_slug ON events (slug)"],
  });
  app.save(events);

  const eventTeams = new Collection({
    name: "event_teams",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "event", type: "relation", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "name", type: "text", required: true },
      { name: "slug", type: "text", required: true },
      { name: "seed", type: "number" },
      { name: "pool", type: "text" },
    ],
  });
  app.save(eventTeams);

  const eventPlayers = new Collection({
    name: "event_players",
    type: "base",
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "event_team", type: "relation", collectionId: eventTeams.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "name_key", type: "text", required: true },
      { name: "jersey", type: "text" },
      { name: "roster_locked", type: "bool" },
    ],
  });
  app.save(eventPlayers);

  const pools = new Collection({
    name: "pools",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "event", type: "relation", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "name", type: "text", required: true },
      { name: "tiebreak_notes", type: "text" },
    ],
  });
  app.save(pools);

  const bracketGames = new Collection({
    name: "bracket_games",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "event", type: "relation", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "round", type: "text" },
      { name: "slot", type: "number" },
      { name: "home_team", type: "relation", collectionId: eventTeams.id, maxSelect: 1 },
      { name: "away_team", type: "relation", collectionId: eventTeams.id, maxSelect: 1 },
      { name: "home_runs", type: "number" },
      { name: "away_runs", type: "number" },
      { name: "winner", type: "relation", collectionId: eventTeams.id, maxSelect: 1 },
      { name: "status", type: "select", maxSelect: 1, values: ["scheduled", "live", "final"] },
    ],
  });
  app.save(bracketGames);

  const eventSchedule = new Collection({
    name: "event_schedule",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "event", type: "relation", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "date", type: "text" },
      { name: "time", type: "text" },
      { name: "field", type: "relation", collectionId: fields.id, maxSelect: 1 },
      { name: "home", type: "relation", collectionId: eventTeams.id, maxSelect: 1 },
      { name: "away", type: "relation", collectionId: eventTeams.id, maxSelect: 1 },
      { name: "home_runs", type: "number" },
      { name: "away_runs", type: "number" },
      { name: "status", type: "select", maxSelect: 1, values: ["scheduled", "live", "final"] },
      { name: "notes", type: "text" },
    ],
  });
  app.save(eventSchedule);

  const eventBoxes = new Collection({
    name: "event_boxes",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "schedule_row", type: "relation", collectionId: eventSchedule.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "hitting", type: "json" },
      { name: "pitching", type: "json" },
      { name: "source", type: "text" },
    ],
  });
  app.save(eventBoxes);

  const eventHitting = new Collection({
    name: "event_hitting",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "event", type: "relation", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "event_player", type: "relation", collectionId: eventPlayers.id, maxSelect: 1 },
      { name: "schedule_row", type: "relation", collectionId: eventSchedule.id, maxSelect: 1 },
      { name: "ab", type: "number" },
      { name: "r", type: "number" },
      { name: "h", type: "number" },
      { name: "rbi", type: "number" },
      { name: "bb", type: "number" },
      { name: "so", type: "number" },
    ],
  });
  app.save(eventHitting);

  const eventPitching = new Collection({
    name: "event_pitching",
    type: "base",
    listRule: "",
    viewRule: "",
    createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.role = 'bot'",
    deleteRule: "@request.auth.role = 'region_admin'",
    fields: [
      { name: "event", type: "relation", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
      { name: "event_player", type: "relation", collectionId: eventPlayers.id, maxSelect: 1 },
      { name: "schedule_row", type: "relation", collectionId: eventSchedule.id, maxSelect: 1 },
      { name: "ip_outs", type: "number" },
      { name: "h", type: "number" },
      { name: "r", type: "number" },
      { name: "er", type: "number" },
      { name: "bb", type: "number" },
      { name: "so", type: "number" },
      { name: "pitches", type: "number" },
      { name: "strikes", type: "number" },
    ],
  });
  app.save(eventPitching);
}, (app) => {
  const names = [
    "event_pitching", "event_hitting", "event_boxes", "event_schedule", "bracket_games",
    "pools", "event_players", "event_teams", "events", "staging_games", "pitching_game",
    "hitting_game", "team_games", "players", "inquiries", "posts", "fields", "seasons",
    "teams", "orgs",
  ];
  for (const name of names) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (err) {}
  }
});
