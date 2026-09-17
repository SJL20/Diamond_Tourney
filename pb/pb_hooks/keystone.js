function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "team";
}

function parseHost(url) {
  const m = String(url || "").match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].replace(/^www\./i, "").toLowerCase() : "";
}

function normalizePopupUrl(url) {
  return String(url || "").trim().replace(/#.*$/, "").replace(/\/+$/, "");
}

function isKeystonePopupUrl(url) {
  const raw = normalizePopupUrl(url);
  if (!raw) return false;
  const host = parseHost(raw);
  const path = raw.replace(/^https?:\/\/[^\/]+/i, "").toLowerCase();
  if (host === "thedr21.github.io") {
    return path === "/keystoneclash" || path === "/keystoneclash/data.json" || path === "/keystoneclash/stats.json" || path === "/keystoneclash/index.html";
  }
  if (host === "raw.githubusercontent.com") {
    return /\/thedr21\/keystoneclash\/[^/]+\/(data|stats)\.json$/i.test(path);
  }
  return false;
}

function dataJsonUrl(url) {
  const raw = normalizePopupUrl(url) || DEFAULT_POPUP;
  if (/data\.json$/i.test(raw)) return raw;
  if (/stats\.json$/i.test(raw)) return raw.replace(/stats\.json$/i, "data.json");
  if (parseHost(raw) === "raw.githubusercontent.com") {
    return raw.replace(/\/[^/]+$/, "/data.json");
  }
  return raw.replace(/\/index\.html$/i, "") + "/data.json";
}

function statsJsonUrl(dataUrl) {
  return String(dataUrl).replace(/data\.json$/i, "stats.json");
}

const DEFAULT_POPUP = "https://thedr21.github.io/KeystoneClash";

const TM_SEEDS = {
  "All American Prady": 1,
  "Lady Dukes WPA 2033": 2,
  "Pittsburgh Passion": 3,
  "Smash Fastpitch Shaffer": 4,
  "FP Select Barringer": 5,
  "Pittsburgh Power Theys": 6,
  "Pittsburgh Spirit Barber": 7,
  "Outlaws 2033 Valore": 8,
};

const BRACKET_MAP = {
  B1: { round: "QF", slot: 1, side: "championship", date: "2026-09-13", time: "14:00" },
  B2: { round: "QF", slot: 2, side: "championship", date: "2026-09-13", time: "14:00" },
  B3: { round: "QF", slot: 3, side: "championship", date: "2026-09-13", time: "14:00" },
  B4: { round: "QF", slot: 4, side: "championship", date: "2026-09-13", time: "14:00" },
  B5: { round: "SF", slot: 1, side: "championship", date: "2026-09-13", time: "16:00" },
  B6: { round: "SF", slot: 2, side: "championship", date: "2026-09-13", time: "16:00" },
  B7: { round: "F", slot: 1, side: "championship", date: "2026-09-13", time: "17:45" },
  B8: { round: "CSF", slot: 1, side: "consolation", date: "2026-09-13", time: "16:00" },
  B9: { round: "CSF", slot: 2, side: "consolation", date: "2026-09-13", time: "16:00" },
  B10: { round: "3RD", slot: 1, side: "consolation", date: "2026-09-13", time: "17:45" },
  B11: { round: "CF", slot: 1, side: "consolation", date: "2026-09-13", time: "17:45" },
  B12: { round: "7TH", slot: 1, side: "consolation", date: "2026-09-13", time: "17:45" },
};

const PACKET_INFO = {
  where: "East End Park, 51 Meadow St, McDonald, PA 15057. Two fields. Sunday bracket moved to No Offseason, 306 Chase Drive, Tarentum, PA 15084 after Saturday rain.",
  parking: "Two small lots at East End, both fill fast. Overflow is on East O’Hara St. Arrive early and keep driveways and outfield access lanes clear. Turf shoes only at No Offseason — no metal cleats.",
  rules: "USA Softball rules. 90 minutes, finish the inning. Two umpires every game. Courtesy runner for the pitcher and catcher. Run rule 12 after 3, 10 after 4, 8 after 5. Teams may bat the whole lineup or follow USA Softball substitution rules — declare at the plate meeting. A game is official after three full innings; if rain stops play mid-inning, the score reverts to the last completed inning.",
  format: "Pool play Friday evening and Saturday morning at East End Park. Seeds posted Saturday. Sunday bracket was single elimination at No Offseason — every team played three games.",
  on_site: "Porta johns and hand sanitizing stations. Concessions by the Fort Cherry Fastpitch Association.",
  questions: "Derek Rocco, Artie Tortorice and Steve LaFever, Tournament Directors. Text both teams’ final scores after every game.",
  pool_note: "The public popup publishes pool W-L, runs scored, and runs allowed. It does not list individual Friday/Saturday pool boxes, so those games are not invented here.",
  full_rules: "https://thedr21.github.io/KeystoneClash/full-rules.html",
  coaches_packet: "https://thedr21.github.io/KeystoneClash/coaches-packet.pdf",
  parking_map: "https://thedr21.github.io/KeystoneClash/parking-map.png",
  raffle_buy: "https://www.zeffy.com/en-US/ticketing/lady-dukes-keystone-clash-tournament-raffle",
};

function addSelectValue(collection, fieldName, value) {
  const field = collection.fields.getByName(fieldName);
  if (!field) return;
  const values = field.values || [];
  if (values.indexOf(value) === -1) {
    values.push(value);
    field.values = values;
  }
}

function parseJersey(name) {
  const m = String(name || "").match(/#(\S+)\s*$/);
  return m ? m[1] : "";
}

function ipToOuts(ip) {
  const sb = require(__hooks + "/softball.js");
  try {
    return sb.ipToOuts(ip);
  } catch (err) {
    return null;
  }
}

function erFromPublished(eraVal, ip) {
  const outs = ipToOuts(ip);
  if (outs == null || eraVal == null || eraVal === "") return null;
  const innings = outs / 3;
  if (!innings) return null;
  return Math.round((Number(eraVal) * innings) / 7);
}

function fetchJson(url) {
  const res = $http.send({
    url: url,
    method: "GET",
    headers: {
      "User-Agent": "DiamondTourney/1.0 (tournament host; public popup JSON)",
      Accept: "application/json",
    },
    timeout: 12,
  });
  if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) {
    throw new Error("GET " + url + " returned " + res.statusCode);
  }
  return JSON.parse(String(res.body));
}

function bundledSnapshot() {
  const bundled = require(__hooks + "/keystone_data.js");
  return { data: bundled.data, stats: bundled.stats || { hitting: [], pitching: [] } };
}

function loadSnapshot(url) {
  if (!url) return bundledSnapshot();
  const dataUrl = dataJsonUrl(url);
  if (!isKeystonePopupUrl(dataUrl) && !isKeystonePopupUrl(url)) {
    throw new BadRequestError("Only the public Keystone Clash popup (thedr21.github.io/KeystoneClash) can be imported.");
  }
  try {
    const data = fetchJson(dataUrl);
    let stats = { hitting: [], pitching: [] };
    try {
      stats = fetchJson(statsJsonUrl(dataUrl));
    } catch (err) {}
    return { data: data, stats: stats };
  } catch (err) {
    const bundled = bundledSnapshot();
    bundled.fallback = String(err);
    return bundled;
  }
}

function upsertEvent(app) {
  let rec;
  try {
    rec = app.findFirstRecordByData("events", "slug", "keystone-clash-2026");
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("events"));
    rec.set("slug", "keystone-clash-2026");
  }
  rec.set("name", "Keystone Clash 2026");
  rec.set("start", "2026-09-11 00:00:00.000Z");
  rec.set("end", "2026-09-13 00:00:00.000Z");
  rec.set("venue", "East End Park, McDonald PA · Sunday at No Offseason, Tarentum");
  rec.set("ages", "11U/12U");
  rec.set("public", true);
  rec.set("status", "live");
  rec.set("format", "pool-to-bracket");
  rec.set("source", "popup");
  rec.set("signup_open", false);
  rec.set("auto_sync", false);
  rec.set("pitch_limit_ip", 6);
  try {
    const td = app.findAuthRecordByEmail("users", "td@local.test");
    rec.set("created_by", td.id);
  } catch (err) {}
  return rec;
}

function upsertTeam(app, event, team) {
  const slug = slugify(team.name);
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "event_teams",
      "event = {:e} && slug = {:s}",
      { e: event.id, s: slug },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("event_teams"));
    rec.set("event", event.id);
    rec.set("slug", slug);
  }
  rec.set("name", team.name);
  rec.set("pool", "All teams");
  rec.set("seed", TM_SEEDS[team.name] || 0);
  rec.set("gamechanger_url", team.gc || "");
  rec.set("gc_team_ref", String(team.gc || "").replace(/^https?:\/\//i, "").replace(/\/+$/, ""));
  rec.set("gc_sync_status", team.gc ? "linked" : "unlinked");
  rec.set("signed_up_by", "director");
  rec.set("published_w", Number(team.w || 0));
  rec.set("published_l", Number(team.l || 0));
  rec.set("published_t", Number(team.t || 0));
  rec.set("published_rf", Number(team.rf || 0));
  rec.set("published_ra", Number(team.ra || 0));
  rec.set("is_host", !!team.host);
  rec.set("contact_name", "Lady Dukes Softball Club");
  try {
    const year = require(__hooks + "/year.js");
    const club = year.upsertClub(app, { name: team.name, gamechanger_url: team.gc || "" });
    if (club) rec.set("club", club.id);
  } catch (err) {}
  app.save(rec);
  return rec;
}

function winnerOf(game, home, away) {
  if (game.as == null || game.bs == null) return null;
  if (Number(game.as) > Number(game.bs)) return home;
  if (Number(game.bs) > Number(game.as)) return away;
  return null;
}

function upsertBracketGame(app, event, teamsByName, game) {
  const meta = BRACKET_MAP[game.id];
  if (!meta) return null;
  const home = teamsByName[game.a];
  const away = teamsByName[game.b];
  if (!home || !away) return null;
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "bracket_games",
      "event = {:e} && round = {:r} && slot = {:s}",
      { e: event.id, r: meta.round, s: meta.slot },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("bracket_games"));
    rec.set("event", event.id);
    rec.set("round", meta.round);
    rec.set("slot", meta.slot);
  }
  rec.set("side", meta.side);
  rec.set("home_team", home.id);
  rec.set("away_team", away.id);
  rec.set("home_runs", Number(game.as || 0));
  rec.set("away_runs", Number(game.bs || 0));
  rec.set("status", "final");
  rec.set("game_id", game.id);
  rec.set("field_name", game.field || "");
  rec.set("time", meta.time);
  rec.set("date", meta.date);
  const winner = winnerOf(game, home, away);
  if (winner) rec.set("winner", winner.id);
  app.save(rec);
  return rec;
}

function upsertPlayer(app, team, nameKey) {
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "event_players",
      "event_team = {:t} && name_key = {:k}",
      { t: team.id, k: nameKey },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("event_players"));
    rec.set("event_team", team.id);
    rec.set("name_key", nameKey);
  }
  rec.set("jersey", parseJersey(nameKey));
  rec.set("roster_locked", true);
  app.save(rec);
  return rec;
}

function upsertHitting(app, event, player, row) {
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "event_hitting",
      "event = {:e} && event_player = {:p}",
      { e: event.id, p: player.id },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("event_hitting"));
    rec.set("event", event.id);
    rec.set("event_player", player.id);
  }
  rec.set("ab", Number(row.ab || 0));
  rec.set("h", Number(row.h || 0));
  rec.set("rbi", Number(row.rbi || 0));
  rec.set("r", 0);
  rec.set("bb", 0);
  rec.set("so", 0);
  app.save(rec);
}

function upsertPitching(app, event, player, row) {
  const outs = ipToOuts(row.ip);
  if (outs == null) return;
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "event_pitching",
      "event = {:e} && event_player = {:p}",
      { e: event.id, p: player.id },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("event_pitching"));
    rec.set("event", event.id);
    rec.set("event_player", player.id);
  }
  rec.set("ip_outs", outs);
  rec.set("so", Number(row.k || 0));
  const er = erFromPublished(row.era, row.ip);
  rec.set("er", er == null ? 0 : er);
  rec.set("h", 0);
  rec.set("r", 0);
  rec.set("bb", 0);
  app.save(rec);
}

function publishedStandings(teams) {
  const rows = teams.map(function (t) {
    const w = Number(t.get("published_w") || 0);
    const l = Number(t.get("published_l") || 0);
    const rf = Number(t.get("published_rf") || 0);
    const ra = Number(t.get("published_ra") || 0);
    return {
      id: t.id,
      name: t.get("name"),
      slug: t.get("slug"),
      pool: t.get("pool") || "All teams",
      w: w,
      l: l,
      t: Number(t.get("published_t") || 0),
      rs: rf,
      ra: ra,
      diff: rf - ra,
      seed: Number(t.get("seed") || 0),
      host: !!t.get("is_host"),
      gamechanger_url: t.get("gamechanger_url") || "",
    };
  });
  rows.sort(function (a, b) {
    if (a.seed && b.seed && a.seed !== b.seed) return a.seed - b.seed;
    return a.name < b.name ? -1 : 1;
  });
  return [{ name: "All teams", note: "Pool play — official Tourney Machine seeds", teams: rows }];
}

function applySnapshot(app, snapshot) {
  const data = snapshot.data;
  const stats = snapshot.stats || { hitting: [], pitching: [] };
  const event = upsertEvent(app);
  event.set("tm_url", data.bracketUrl || "");
  const tmId = String(data.bracketUrl || "").match(/IDTournament=([a-zA-Z0-9]+)/i);
  if (tmId) event.set("tm_id", tmId[1]);
  event.set("source_url", DEFAULT_POPUP + "/");
  const packet = {
    dates: data.dates || "September 11–13, 2026",
    venue: data.venue || "",
    contact: data.contact || PACKET_INFO.questions,
    updated: data.updated || "",
    status: data.status || "",
    bracket_venue: (data.bracket && data.bracket.venue) || "",
    bracket_note: (data.bracket && data.bracket.note) || "",
    champion: (data.bracket && data.bracket.champion) || null,
    runner_up: (data.bracket && data.bracket.runnerUp) || null,
    raffle: data.raffle || null,
    info: PACKET_INFO,
    source: DEFAULT_POPUP + "/",
    tm_url: data.bracketUrl || "",
    min_ab: stats.minAB || 8,
    min_ip: stats.minIP || 5,
    stats_note: stats.note || "Published scorebook lines from the Keystone Clash popup.",
    leaders: data.leaders || { hitting: [], pitching: [] },
    stats_hitting: stats.hitting || [],
    stats_pitching: stats.pitching || [],
  };
  event.set("packet", JSON.stringify(packet));
  event.set("contact", data.contact || "");
  event.set("status_note", data.status || "");
  app.save(event);

  try {
    const pool = app.findFirstRecordByFilter("pools", "event = {:e} && name = 'All teams'", { e: event.id });
    pool.set("tiebreak_notes", "Record, then fewest runs allowed, then run differential. Official seeds follow Tourney Machine (TD may apply head-to-head).");
    app.save(pool);
  } catch (err) {
    const pool = new Record(app.findCollectionByNameOrId("pools"));
    pool.set("event", event.id);
    pool.set("name", "All teams");
    pool.set("tiebreak_notes", "Record, then fewest runs allowed, then run differential. Official seeds follow Tourney Machine (TD may apply head-to-head).");
    app.save(pool);
  }

  const teamsByName = {};
  const listed = ((data.divisions || [])[0] || {}).teams || [];
  for (const team of listed) {
    teamsByName[team.name] = upsertTeam(app, event, team);
  }

  const rounds = (data.bracket && data.bracket.rounds) || [];
  let games = 0;
  for (const round of rounds) {
    for (const game of round.games || []) {
      if (upsertBracketGame(app, event, teamsByName, game)) games += 1;
    }
  }

  const hitLines = (stats.hitting || []).length ? stats.hitting : (data.leaders && data.leaders.hitting) || [];
  const pitLines = (stats.pitching || []).length ? stats.pitching : (data.leaders && data.leaders.pitching) || [];
  let hitters = 0;
  let pitchers = 0;
  for (const row of hitLines) {
    const team = teamsByName[row.team];
    if (!team) continue;
    const player = upsertPlayer(app, team, row.player);
    upsertHitting(app, event, player, row);
    hitters += 1;
  }
  for (const row of pitLines) {
    const team = teamsByName[row.team];
    if (!team) continue;
    const player = upsertPlayer(app, team, row.player);
    upsertPitching(app, event, player, row);
    pitchers += 1;
  }

  try {
    const host = require(__hooks + "/host.js");
    host.writeLog(app, event.id, "popup", true, "Imported Keystone Clash popup · " + listed.length + " teams · " + games + " Sunday games · " + hitters + " published hitters");
  } catch (err) {}

  return {
    event: event.get("slug"),
    teams: listed.length,
    games: games,
    hitters: hitters,
    pitchers: pitchers,
    fallback: snapshot.fallback || "",
  };
}

function importPopup(app, url) {
  const snapshot = loadSnapshot(url || DEFAULT_POPUP);
  return applySnapshot(app, snapshot);
}

function seedBundled(app) {
  return applySnapshot(app, bundledSnapshot());
}

module.exports = {
  DEFAULT_POPUP: DEFAULT_POPUP,
  TM_SEEDS: TM_SEEDS,
  isKeystonePopupUrl: isKeystonePopupUrl,
  addSelectValue: addSelectValue,
  publishedStandings: publishedStandings,
  importPopup: importPopup,
  seedBundled: seedBundled,
  applySnapshot: applySnapshot,
};
