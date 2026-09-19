function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseCsv(text) {
  return require(__hooks + "/csv.js").parseCsv(text);
}

function upsertEventTeam(app, eventId, name, pool) {
  const slug = slugify(name);
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "event_teams",
      "event = {:e} && slug = {:s}",
      { e: eventId, s: slug },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("event_teams"));
    rec.set("event", eventId);
    rec.set("slug", slug);
  }
  rec.set("name", name);
  if (pool) rec.set("pool", pool);
  app.save(rec);
  return rec;
}

const DEFAULT_TIEBREAK = ["record", "h2h", "ra", "diff", "rs"];

const TIEBREAK_ALIASES = {
  winpct: "record", "win%": "record", pct: "record", wl: "record", "w-l": "record",
  w_l: "record", wins: "record", "head-to-head": "h2h", headtohead: "h2h",
  head_to_head: "h2h", runs_allowed: "ra", "runs-allowed": "ra", run_diff: "diff",
  "run-diff": "diff", rundiff: "diff", rd: "diff", runs_scored: "rs", "runs-scored": "rs",
};

const TIEBREAK_LABELS = {
  record: "better record (tie counts as half a win)",
  h2h: "won head-to-head",
  ra: "fewest runs allowed",
  diff: "better run differential",
  rs: "more runs scored",
};

function decodeJsonField(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.charAt(0) === "{" || trimmed.charAt(0) === "[") {
      try { return JSON.parse(trimmed); } catch (err) { return raw; }
    }
    // Director CSV ("record,ra,h2h") is not JSON. Keep the string so parseTiebreak can split it.
    return raw;
  }
  if (typeof raw === "object" && raw.length !== undefined && typeof raw[0] === "number") {
    try {
      return decodeJsonField(require(__hooks + "/softball.js").bytesToString(raw));
    } catch (err) { return null; }
  }
  return raw;
}

function parseTiebreak(raw) {
  let data = decodeJsonField(raw);
  let explicit = false;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    explicit = data.explicit === true;
    data = data.order || data.tiebreak || data.criteria || data;
  }
  if (typeof data === "string") {
    data = data.split(/[,|]/).map(function (part) { return part.trim(); }).filter(Boolean);
  }
  const seen = {};
  const out = [];
  const list = Array.isArray(data) ? data : [];
  for (let i = 0; i < list.length; i++) {
    const key = TIEBREAK_ALIASES[String(list[i]).toLowerCase()] || String(list[i]).toLowerCase();
    if (DEFAULT_TIEBREAK.indexOf(key) !== -1 && !seen[key]) {
      out.push(key);
      seen[key] = true;
    }
  }
  if (!explicit) {
    for (let i = 0; i < DEFAULT_TIEBREAK.length; i++) {
      if (!seen[DEFAULT_TIEBREAK[i]]) out.push(DEFAULT_TIEBREAK[i]);
    }
  }
  return out.length ? out : DEFAULT_TIEBREAK.slice();
}

function tiebreakKeys(order) {
  if (order && order.length !== undefined && typeof order !== "string" && !order.order) {
    return order.length ? order : DEFAULT_TIEBREAK.slice();
  }
  return parseTiebreak(order);
}

function tiebreakLabel(order) {
  const names = {
    record: "record (tie = half)",
    h2h: "head-to-head",
    ra: "fewest runs allowed",
    diff: "run differential",
    rs: "most runs scored",
  };
  return tiebreakKeys(order).map(function (key) { return names[key]; }).join(", then ");
}

function saveTiebreak(event, body) {
  if (!event || !body) return;
  if (body.tiebreak_order == null && body.tiebreak == null) return;
  const raw = body.tiebreak_order != null ? body.tiebreak_order : body.tiebreak;
  const forceExplicit = body.tiebreak_explicit === true || body.tiebreak_explicit === "true" || body.tiebreak_explicit === "1";
  // Wrap CSV so decodeJsonField keeps the string and parseTiebreak can split it.
  const order = parseTiebreak(forceExplicit ? { order: raw, explicit: true } : { order: raw });
  event.set("tiebreak", { order: order, explicit: true });
}

function savePoolTiebreaks(app, event, body) {
  if (!app || !event || !body) return;
  const keys = Object.keys(body);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].indexOf("pool_tiebreak_") !== 0) continue;
    const name = String(keys[i].slice("pool_tiebreak_".length) || "").trim();
    if (!name) continue;
    let rec;
    try {
      rec = app.findFirstRecordByFilter("pools", "event = {:e} && name = {:n}", { e: event.id, n: name });
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("pools"));
      rec.set("event", event.id);
      rec.set("name", name);
    }
    rec.set("tiebreak", { order: parseTiebreak({ order: body[keys[i]], explicit: true }), explicit: true });
    app.save(rec);
  }
}

function poolTiebreak(app, eventId, poolName, fallback) {
  try {
    const pool = app.findFirstRecordByFilter("pools", "event = {:e} && name = {:n}", { e: eventId, n: poolName });
    if (pool.get("tiebreak")) return parseTiebreak(pool.get("tiebreak"));
  } catch (err) {}
  return fallback || eventTiebreak(app, eventId);
}

function gGet(game, key) {
  if (game && typeof game.get === "function") return game.get(key);
  return game ? game[key] : undefined;
}

function gRuns(game, key) {
  const value = gGet(game, key);
  if (value === "" || value == null) return null;
  return Number(value);
}

function decidedGames(games) {
  const out = [];
  for (let i = 0; i < (games || []).length; i++) {
    if (gRuns(games[i], "home_runs") == null || gRuns(games[i], "away_runs") == null) continue;
    out.push(games[i]);
  }
  return out;
}

function pairGames(aId, bId, games) {
  const out = [];
  const rows = decidedGames(games);
  for (let i = 0; i < rows.length; i++) {
    const home = gGet(rows[i], "home");
    const away = gGet(rows[i], "away");
    if ((home === aId && away === bId) || (home === bId && away === aId)) out.push(rows[i]);
  }
  return out;
}

function pairwiseH2H(aId, bId, games) {
  let aWins = 0, bWins = 0;
  const rows = pairGames(aId, bId, games);
  for (let i = 0; i < rows.length; i++) {
    const home = gGet(rows[i], "home");
    const hr = gRuns(rows[i], "home_runs");
    const ar = gRuns(rows[i], "away_runs");
    const aRuns = home === aId ? hr : ar;
    const bRuns = home === aId ? ar : hr;
    if (aRuns > bRuns) aWins++;
    else if (bRuns > aRuns) bWins++;
  }
  if (aWins === bWins) return 0;
  return aWins > bWins ? -1 : 1;
}

function completeRoundRobin(ids, games) {
  if (ids.length < 2) return false;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!pairGames(ids[i], ids[j], games).length) return false;
    }
  }
  return true;
}

function intraWins(teamId, groupIds, games) {
  let wins = 0;
  const rows = decidedGames(games);
  for (let i = 0; i < rows.length; i++) {
    const home = gGet(rows[i], "home");
    const away = gGet(rows[i], "away");
    if (!groupIds[home] || !groupIds[away]) continue;
    if (teamId !== home && teamId !== away) continue;
    const hr = gRuns(rows[i], "home_runs");
    const ar = gRuns(rows[i], "away_runs");
    if (home === teamId && hr > ar) wins++;
    else if (away === teamId && ar > hr) wins++;
  }
  return wins;
}

function winPct(team) {
  const w = Number(team.w || 0);
  const l = Number(team.l || 0);
  const t = Number(team.t || 0);
  const games = w + l + t;
  if (games <= 0) return 0;
  return (w + 0.5 * t) / games;
}

function h2hMode(group, games) {
  if (group.length === 2) return pairGames(group[0].id, group[1].id, games).length ? "pair" : "";
  if (group.length >= 3 && completeRoundRobin(group.map(function (t) { return t.id; }), games)) return "rr";
  return "";
}

function criterionValue(team, crit, group, games, mode) {
  if (crit === "record") return winPct(team);
  if (crit === "ra") return -Number(team.ra || 0);
  if (crit === "diff") return Number(team.rs || 0) - Number(team.ra || 0);
  if (crit === "rs") return Number(team.rs || 0);
  if (crit === "h2h" && mode === "pair") {
    let other = group[0];
    for (let i = 0; i < group.length; i++) {
      if (group[i].id !== team.id) { other = group[i]; break; }
    }
    return -pairwiseH2H(team.id, other.id, games);
  }
  if (crit === "h2h" && mode === "rr") {
    const ids = {};
    for (let i = 0; i < group.length; i++) ids[group[i].id] = true;
    return intraWins(team.id, ids, games);
  }
  return 0;
}

function reasonLabel(crit, mode, suffix) {
  let label = (crit === "h2h" && mode === "rr") ? "more wins inside the tied group" : (TIEBREAK_LABELS[crit] || crit);
  if (suffix) return label + " after " + suffix;
  return label;
}

function sortGroup(teams, games, order, reasons, suffix) {
  if (teams.length <= 1) return teams.slice();
  if (!order.length) {
    return teams.slice().sort(function (a, b) {
      const an = String(a.name || "").toLowerCase();
      const bn = String(b.name || "").toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
  }
  const crit = order[0];
  const rest = order.slice(1);
  let mode = "";
  if (crit === "h2h") {
    mode = h2hMode(teams, games);
    if (!mode) {
      return sortGroup(teams, games, rest, reasons, suffix || (teams.length + "-team tie; not every pair has played"));
    }
    if (mode === "rr") {
      const ids = {};
      for (let i = 0; i < teams.length; i++) ids[teams[i].id] = true;
      const seen = {};
      let unique = 0;
      for (let i = 0; i < teams.length; i++) {
        const w = intraWins(teams[i].id, ids, games);
        if (seen[w] == null) { seen[w] = true; unique++; }
      }
      if (unique <= 1) {
        return sortGroup(teams, games, rest, reasons, suffix || (teams.length + "-team cycle"));
      }
    }
    if (mode === "pair" && pairwiseH2H(teams[0].id, teams[1].id, games) === 0) {
      return sortGroup(teams, games, rest, reasons, suffix);
    }
  }
  const buckets = {};
  const keys = [];
  for (let i = 0; i < teams.length; i++) {
    const value = criterionValue(teams[i], crit, teams, games, mode);
    const key = String(value);
    if (!buckets[key]) { buckets[key] = { value: value, teams: [] }; keys.push(key); }
    buckets[key].teams.push(teams[i]);
  }
  keys.sort(function (a, b) { return buckets[b].value - buckets[a].value; });
  const split = keys.length > 1;
  const ranked = [];
  for (let i = 0; i < keys.length; i++) {
    const bucket = buckets[keys[i]].teams;
    if (reasons && split && bucket.length === 1 && !reasons[bucket[0].id]) {
      reasons[bucket[0].id] = reasonLabel(crit, mode, suffix);
    }
    ranked.push.apply(ranked, sortGroup(bucket, games, rest, reasons, split ? "" : suffix));
  }
  return ranked;
}

function gamesHaveFinals(games) {
  if (!games || !games.length) return false;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const status = g && g.get ? g.get("status") : (g && g.status);
    if (status === "final") return true;
  }
  return false;
}

function sortPool(teams, games, order) {
  const criteria = (order && order.length !== undefined && typeof order !== "string" && !order.order)
    ? (order.length ? order.slice() : parseTiebreak(null))
    : parseTiebreak(order);
  const listed = teams.slice();
  if (!gamesHaveFinals(games)) {
    listed.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    for (let i = 0; i < listed.length; i++) {
      listed[i].seed = null;
      listed[i].diff = Number(listed[i].rs || 0) - Number(listed[i].ra || 0);
      listed[i].win_pct = Math.round(winPct(listed[i]) * 1000) / 1000;
      listed[i].seed_reason = "";
      listed[i].tied = true;
    }
    return listed;
  }
  const reasons = {};
  const ranked = sortGroup(listed, games, criteria, reasons, "");
  let prevKey = "";
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i];
    row.diff = Number(row.rs || 0) - Number(row.ra || 0);
    row.win_pct = Math.round(winPct(row) * 1000) / 1000;
    const reason = reasons[row.id] || "";
    const tieKey = [winPct(row), Number(row.ra || 0), row.diff, Number(row.rs || 0)].join("|");
    if (i > 0 && !reason && tieKey === prevKey) {
      row.seed = ranked[i - 1].seed;
      row.tied = true;
      ranked[i - 1].tied = true;
      row.seed_reason = "";
    } else {
      row.seed = i + 1;
      row.seed_reason = reason;
      if (ranked.length === 1 && !reason) row.seed_reason = "only team in the pool";
    }
    prevKey = tieKey;
  }
  return ranked;
}

function headToHead(aId, bId, games) {
  return pairwiseH2H(aId, bId, games);
}

function compareTeams(a, b, games, order) {
  const ranked = sortPool([a, b], games, order);
  if (ranked[0].id === a.id && ranked[1].id === b.id) return -1;
  if (ranked[0].id === b.id && ranked[1].id === a.id) return 1;
  return 0;
}

function eventTiebreak(app, eventId) {
  try {
    return parseTiebreak(app.findRecordById("events", eventId).get("tiebreak"));
  } catch (err) {
    return parseTiebreak(null);
  }
}

function poolStandings(app, eventId) {
  const eventOrder = eventTiebreak(app, eventId);
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: eventId });
  const published = teams.some(function (t) {
    return Number(t.get("published_w") || 0) + Number(t.get("published_l") || 0) + Number(t.get("published_t") || 0) > 0;
  });
  if (published) {
    try {
      const rows = require(__hooks + "/keystone.js").publishedStandings(teams);
      return rows.map(function (pool) {
        pool.tiebreak_label = pool.tiebreak_label || "official Tourney Machine seeds";
        (pool.teams || []).forEach(function (t) {
          if (!t.seed_reason) t.seed_reason = "Official Tourney Machine seed";
        });
        return pool;
      });
    } catch (err) {}
  }
  const games = app.findRecordsByFilter(
    "event_schedule",
    "event = {:e} && status = 'final'",
    "",
    400,
    0,
    { e: eventId },
  );
  const byId = {};
  for (const t of teams) {
    byId[t.id] = {
      id: t.id,
      name: t.get("name"),
      slug: t.get("slug"),
      pool: t.get("pool") || "",
      w: 0, l: 0, t: 0, rs: 0, ra: 0,
    };
  }
  for (const g of games) {
    const hid = g.get("home");
    const aid = g.get("away");
    if (!byId[hid] || !byId[aid]) continue;
    const hr = Number(g.get("home_runs") || 0);
    const ar = Number(g.get("away_runs") || 0);
    byId[hid].rs += hr; byId[hid].ra += ar;
    byId[aid].rs += ar; byId[aid].ra += hr;
    if (hr > ar) { byId[hid].w++; byId[aid].l++; }
    else if (ar > hr) { byId[aid].w++; byId[hid].l++; }
    else { byId[hid].t++; byId[aid].t++; }
  }
  const pools = {};
  for (const row of Object.values(byId)) {
    const key = row.pool || "Open";
    if (!pools[key]) pools[key] = [];
    pools[key].push(row);
  }
  const out = [];
  const names = Object.keys(pools).sort();
  for (const name of names) {
    const order = poolTiebreak(app, eventId, name, eventOrder);
    const ranked = sortPool(pools[name], games, order);
    out.push({ name: name, teams: ranked, tiebreak_label: tiebreakLabel(order), tiebreak: { order: order, label: tiebreakLabel(order) } });
  }
  return out;
}

function importSchedule(app, event, csv) {
  const rows = parseCsv(csv);
  const created = [];
  const schedule = require(__hooks + "/schedule.js");
  for (const row of rows) {
    const home = upsertEventTeam(app, event.id, row.home || row.home_team, row.pool || row.home_pool);
    const away = upsertEventTeam(app, event.id, row.away || row.away_team, row.pool || row.away_pool);
    const rec = new Record(app.findCollectionByNameOrId("event_schedule"));
    rec.set("event", event.id);
    rec.set("date", row.date || "");
    rec.set("time", row.time || "");
    rec.set("home", home.id);
    rec.set("away", away.id);
    if (row.home_runs !== "" && row.home_runs != null) rec.set("home_runs", Number(row.home_runs));
    if (row.away_runs !== "" && row.away_runs != null) rec.set("away_runs", Number(row.away_runs));
    rec.set("status", row.status || (row.home_runs !== "" && row.home_runs != null ? "final" : "scheduled"));
    if (row.notes) rec.set("notes", row.notes);
    if (row.pool) rec.set("pool", row.pool);
    if (row.field || row.field_name) {
      try {
        const field = schedule.resolveField(app, event, { field: row.field || row.field_name });
        if (field) {
          rec.set("field", field.id);
          rec.set("field_name", field.get("name"));
        }
      } catch (err) {
        rec.set("field_name", row.field || row.field_name);
      }
    }
    if (row.game || row.game_number) rec.set("game_number", Number(row.game || row.game_number));
    schedule.assignGameNumber(app, rec);
    app.save(rec);
    created.push(rec.id);
  }
  const prefs = schedule.parseScheduler(event.get("scheduler"));
  prefs.origin = "imported";
  event.set("scheduler", prefs);
  if (!event.get("format") || event.get("format") === "imported") event.set("format", "pool-to-bracket");
  app.save(event);
  return { imported: created.length, standings: poolStandings(app, event.id) };
}

function importIntoEvent(app, event, csv, replace) {
  if (replace === true || replace === "true" || replace === "on" || replace === "1") {
    const old = app.findRecordsByFilter("event_schedule", "event = {:e}", "", 400, 0, { e: event.id });
    for (let i = 0; i < old.length; i++) app.delete(old[i]);
  }
  return importSchedule(app, event, csv);
}

function wantsCreateEvent(body) {
  return body.create === true || body.create === "true" || body.create === "1" || body.create === 1;
}

function isPlaceholderWeekend(body) {
  const slug = String(body.event_slug || "").trim().toLowerCase();
  const name = String(body.event_name || "").trim().toLowerCase();
  return slug === "clipboard-open" || name === "clipboard open";
}

function inferSide(round, side) {
  if (side === "losers" || side === "winners" || side === "championship" || side === "consolation") return side;
  if (side) return side;
  const r = String(round || "").toUpperCase();
  if (r === "LF" || /^L(\d|QF|SF)/.test(r)) return "losers";
  if (/^(C|3RD|5TH|7TH|CONS)/.test(r)) return "consolation";
  return "championship";
}

function loserId(g) {
  const w = g.get("winner");
  if (!w || g.get("status") !== "final") return "";
  const home = g.get("home_team");
  const away = g.get("away_team");
  if (w === home) return away || "";
  if (w === away) return home || "";
  return "";
}

function advanceFlight(app, games) {
  const champ = games.filter(function (g) {
    const kind = g.get("bracket_kind") || "";
    if (kind === "losers") return false;
    const side = inferSide(g.get("round"), g.get("side"));
    return side === "championship" || side === "winners" || kind === "winners" || !kind;
  });
  const s1 = champ.find(function (g) { return g.get("round") === "SF" && Number(g.get("slot")) === 1; });
  const s2 = champ.find(function (g) { return g.get("round") === "SF" && Number(g.get("slot")) === 2; });
  const fin = champ.find(function (g) { return g.get("round") === "F"; });
  if (fin) {
    if (s1 && s1.get("status") === "final" && s1.get("winner")) fin.set("home_team", s1.get("winner"));
    if (s2 && s2.get("status") === "final" && s2.get("winner")) fin.set("away_team", s2.get("winner"));
    app.save(fin);
  }
  const third = games.find(function (g) { return g.get("round") === "3RD"; });
  if (third) {
    const l1 = s1 ? loserId(s1) : "";
    const l2 = s2 ? loserId(s2) : "";
    if (l1) third.set("home_team", l1);
    if (l2) third.set("away_team", l2);
    app.save(third);
  }
}

function fillSeat(rec, teamId) {
  if (!teamId) return false;
  if (!rec.get("home_team")) {
    rec.set("home_team", teamId);
    return true;
  }
  if (!rec.get("away_team") && rec.get("home_team") !== teamId) {
    rec.set("away_team", teamId);
    return true;
  }
  return false;
}

function normGameLabel(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

function applyImportedFeeds(app, event, games) {
  let feeds = {};
  try {
    feeds = require(__hooks + "/schedule.js").parseScheduler(event.get("scheduler")).bracket_feeds || {};
  } catch (err) {
    feeds = {};
  }
  const keys = Object.keys(feeds);
  if (!keys.length) return;
  const byLabel = {};
  for (let i = 0; i < games.length; i++) {
    const label = normGameLabel(games[i].get("game_id"));
    if (label) byLabel[label] = games[i];
  }
  for (let i = 0; i < keys.length; i++) {
    const from = byLabel[normGameLabel(keys[i])];
    const feed = feeds[keys[i]] || {};
    if (!from || from.get("status") !== "final") continue;
    const winner = from.get("winner") || "";
    const loser = loserId(from);
    if (feed.winner_to && byLabel[normGameLabel(feed.winner_to)] && byLabel[normGameLabel(feed.winner_to)].get("status") !== "final") {
      if (fillSeat(byLabel[normGameLabel(feed.winner_to)], winner)) app.save(byLabel[normGameLabel(feed.winner_to)]);
    }
    if (feed.loser_to && byLabel[normGameLabel(feed.loser_to)] && byLabel[normGameLabel(feed.loser_to)].get("status") !== "final") {
      if (fillSeat(byLabel[normGameLabel(feed.loser_to)], loser)) app.save(byLabel[normGameLabel(feed.loser_to)]);
    }
  }
}

function advanceBracket(app, eventId) {
  const games = app.findRecordsByFilter("bracket_games", "event = {:e}", "slot", 400, 0, { e: eventId });
  const byFlight = {};
  for (let i = 0; i < games.length; i++) {
    const fl = games[i].get("flight") || "";
    if (!byFlight[fl]) byFlight[fl] = [];
    byFlight[fl].push(games[i]);
  }
  const names = Object.keys(byFlight);
  for (let i = 0; i < names.length; i++) advanceFlight(app, byFlight[names[i]]);
  let event = null;
  try { event = app.findRecordById("events", eventId); } catch (err) { event = null; }
  if (event) applyImportedFeeds(app, event, games);
}

function ba(h, ab) {
  if (!ab) return 0;
  return h / ab;
}

function era(er, ipOuts) {
  if (!ipOuts) return null;
  return (er * 7) / (ipOuts / 3);
}

const WEEKEND_MIN_AB = 8;
const WEEKEND_MIN_IP = 3;

function maxFinalsPerTeam(schedule, bracket) {
  const counts = {};
  function bump(name) {
    if (!name) return;
    counts[name] = (counts[name] || 0) + 1;
  }
  const rows = (schedule || []).concat(bracket || []);
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i];
    if ((g.status || "") !== "final") continue;
    bump(g.home);
    bump(g.away);
  }
  let max = 0;
  const keys = Object.keys(counts);
  for (let i = 0; i < keys.length; i++) {
    if (counts[keys[i]] > max) max = counts[keys[i]];
  }
  return max;
}

function dynamicLeaderMins(gamesPlayed, packet) {
  if (packet && packet.min_ab != null && packet.min_ab !== "") {
    return {
      min_ab: Number(packet.min_ab),
      min_ip: packet.min_ip != null && packet.min_ip !== "" ? Number(packet.min_ip) : WEEKEND_MIN_IP,
      source: "packet",
      games_played: Number(gamesPlayed) || 0,
    };
  }
  const g = Math.max(0, Number(gamesPlayed) || 0);
  return {
    min_ab: Math.min(WEEKEND_MIN_AB, Math.max(2, g * 2)),
    min_ip: Math.min(WEEKEND_MIN_IP, Math.max(1, g)),
    source: "dynamic",
    games_played: g,
  };
}

function pitchIpCapOuts(eventLike) {
  if (!eventLike) return null;
  const mode = eventLike.pitch_limit_mode || "none";
  if (mode !== "ip" && mode !== "both") return null;
  const ip = Number(eventLike.pitch_limit_ip || 0);
  if (!(ip > 0)) return null;
  return ip * 3;
}

function liveStatsNote(mins, packetNote) {
  if (mins && mins.source === "packet") return packetNote || "";
  const g = (mins && mins.games_played) || 0;
  const ab = mins && mins.min_ab != null ? mins.min_ab : 2;
  const ip = mins && mins.min_ip != null ? mins.min_ip : 1;
  const ipText = Number(ip).toFixed(1);
  if (g < 1) {
    return "Qualifying line starts at 2 AB / 1.0 IP after the first final, then rises with games played (cap 8 AB / 3.0 IP). Lines come from each team’s published scorebook.";
  }
  return "Qualifying line is " + ab + " AB / " + ipText + " IP after " + g + " game" + (g === 1 ? "" : "s") + " played (scales up to 8 AB / 3.0 IP). Lines come from each team’s published scorebook.";
}

function sortHitLeaders(a, b) {
  return (b.avg || 0) - (a.avg || 0);
}

function sortPitLeaders(a, b) {
  if (a.era == null) return 1;
  if (b.era == null) return -1;
  return a.era - b.era;
}

function eventLeaders(app, eventId, opts) {
  opts = opts || {};
  const minAb = opts.min_ab != null ? Number(opts.min_ab) : WEEKEND_MIN_AB;
  const minIp = opts.min_ip != null ? Number(opts.min_ip) : WEEKEND_MIN_IP;
  const minIpOuts = Math.round(minIp * 3);
  const hitRows = app.findRecordsByFilter("event_hitting", "event = {:e}", "", 800, 0, { e: eventId });
  const pitRows = app.findRecordsByFilter("event_pitching", "event = {:e}", "", 800, 0, { e: eventId });
  const hit = {};
  for (const row of hitRows) {
    const id = row.get("event_player");
    if (!hit[id]) hit[id] = { event_player: id, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 };
    hit[id].ab += Number(row.get("ab") || 0);
    hit[id].r += Number(row.get("r") || 0);
    hit[id].h += Number(row.get("h") || 0);
    hit[id].rbi += Number(row.get("rbi") || 0);
    hit[id].bb += Number(row.get("bb") || 0);
    hit[id].so += Number(row.get("so") || 0);
  }
  const hitting = Object.values(hit).map(function (r) {
    try {
      const p = app.findRecordById("event_players", r.event_player);
      r.name_key = p.get("name_key");
      r.jersey = p.get("jersey");
      const team = app.findRecordById("event_teams", p.get("event_team"));
      r.team = team.get("name");
    } catch (err) {}
    r.avg = r.ab ? (r.h / r.ab) : 0;
    r.avg_display = r.ab ? (r.h / r.ab).toFixed(3).replace(/^0/, "") : ".000";
    r.q = r.ab >= minAb;
    return r;
  });
  const gatedHit = hitting.filter(function (r) { return r.q; }).sort(sortHitLeaders);

  const pit = {};
  for (const row of pitRows) {
    const id = row.get("event_player");
    if (!pit[id]) pit[id] = { event_player: id, ip_outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0 };
    pit[id].ip_outs += Number(row.get("ip_outs") || 0);
    pit[id].h += Number(row.get("h") || 0);
    pit[id].r += Number(row.get("r") || 0);
    pit[id].er += Number(row.get("er") || 0);
    pit[id].bb += Number(row.get("bb") || 0);
    pit[id].so += Number(row.get("so") || 0);
  }
  const pitching = Object.values(pit).map(function (r) {
    try {
      const p = app.findRecordById("event_players", r.event_player);
      r.name_key = p.get("name_key");
      r.jersey = p.get("jersey");
      const team = app.findRecordById("event_teams", p.get("event_team"));
      r.team = team.get("name");
    } catch (err) {}
    r.ip = Math.floor(r.ip_outs / 3) + "." + (r.ip_outs % 3);
    r.era = era(r.er, r.ip_outs);
    r.era_display = r.era == null ? "—" : r.era.toFixed(2);
    r.q = r.ip_outs >= minIpOuts;
    return r;
  });
  const gatedPitch = pitching.filter(function (r) { return r.q; }).sort(sortPitLeaders);
  return {
    hitting: gatedHit,
    pitching: gatedPitch,
    all_hitting: hitting,
    all_pitching: pitching,
    pitch_counts: pitching.slice().sort(function (a, b) { return b.ip_outs - a.ip_outs; }),
    all_tournament: {
      hitters: hitting.filter(function (r) { return r.ab >= WEEKEND_MIN_AB; }).sort(sortHitLeaders).slice(0, 8),
      pitchers: pitching.filter(function (r) { return r.ip_outs >= WEEKEND_MIN_IP * 3; }).sort(sortPitLeaders).slice(0, 2),
    },
  };
}

function fieldSortParts(name) {
  const text = String(name || "");
  const m = text.match(/(\d+)/);
  return {
    n: m ? Number(m[1]) : 1000000,
    text: text.toLowerCase(),
  };
}

function compareWeekendGames(a, b) {
  const dateA = String(a.date || "9999-99-99");
  const dateB = String(b.date || "9999-99-99");
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  const timeA = String(a.time || "99:99");
  const timeB = String(b.time || "99:99");
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  const ga = Number(a.game_number || 0);
  const gb = Number(b.game_number || 0);
  if (ga && gb && ga !== gb) return ga - gb;
  if (ga && !gb) return -1;
  if (!ga && gb) return 1;
  const fa = fieldSortParts(a.field || a.field_name);
  const fb = fieldSortParts(b.field || b.field_name);
  if (fa.n !== fb.n) return fa.n - fb.n;
  if (fa.text !== fb.text) return fa.text < fb.text ? -1 : 1;
  return String(a.home || "").localeCompare(String(b.home || ""));
}

function listOverall(schedule, bracket) {
  const rows = [];
  for (let i = 0; i < schedule.length; i++) {
    const g = schedule[i];
    if (!g.home || !g.away) continue;
    rows.push({
      kind: "pool",
      id: g.id,
      game_number: g.game_number || 0,
      date: g.date || "",
      time: g.time || "",
      field: g.field || "",
      round: g.pool ? "Pool " + g.pool : "Pool",
      home: g.home,
      away: g.away,
      home_id: g.home_id,
      away_id: g.away_id,
      home_slug: g.home_slug || "",
      away_slug: g.away_slug || "",
      home_runs: g.home_runs,
      away_runs: g.away_runs,
      status: g.status,
      score_source: g.score_source || "",
      book_state: g.book_state || g.score_source || "",
      delayed_from: g.delayed_from || "",
      can_score: !!g.can_score,
      has_box: !!g.has_box,
    });
  }
  for (let i = 0; i < bracket.length; i++) {
    const g = bracket[i];
    rows.push({
      kind: "bracket",
      id: g.id,
      game_number: g.game_number || 0,
      date: g.date || "",
      time: g.time || "",
      field: g.field || "",
      round: g.round || "",
      home: g.home || "",
      away: g.away || "",
      home_id: g.home_id,
      away_id: g.away_id,
      home_slug: g.home_slug || "",
      away_slug: g.away_slug || "",
      home_runs: g.home_runs,
      away_runs: g.away_runs,
      status: g.status,
      score_source: g.score_source || "",
      book_state: g.book_state || "",
      protest_note: g.protest_note || "",
    });
  }
  rows.sort(compareWeekendGames);
  return rows;
}

function publicBoard(app, event, auth) {
  const eventId = event.id;
  const bracketRecs = app.findRecordsByFilter("bracket_games", "event = {:e}", "flight,round,slot", 400, 0, { e: eventId });
  function teamName(id) {
    if (!id) return "";
    try { return app.findRecordById("event_teams", id).get("name"); } catch (err) { return ""; }
  }
  const host = require(__hooks + "/host.js");
  const scheduleMod = require(__hooks + "/schedule.js");
  const packet = host.parsePacket(event.get("packet"));
  const schedule = scheduleMod.listSchedule(app, eventId, auth);
  let feeds = {};
  try { feeds = scheduleMod.parseScheduler(event.get("scheduler")).bracket_feeds || {}; } catch (err) { feeds = {}; }
  const bracket = bracketRecs.map(function (g) {
      const round = g.get("round");
      const hr = Number(g.get("home_runs") || 0);
      const ar = Number(g.get("away_runs") || 0);
      const label = normGameLabel(g.get("game_id"));
      const feed = feeds[label] || feeds[g.get("game_id")] || {};
      const homeName = teamName(g.get("home_team"));
      const awayName = teamName(g.get("away_team"));
      const source = g.get("score_source") || "";
      const conflict = source === "conflict";
      return {
        id: g.id,
        game_id: g.get("game_id") || "",
        game_number: Number(g.get("game_number") || 0) || 0,
        round: round,
        slot: g.get("slot"),
        flight: g.get("flight") || "",
        bracket_kind: g.get("bracket_kind") || "",
        side: inferSide(round, g.get("side")),
        home: homeName || feed.home_ref || "",
        away: awayName || feed.away_ref || "",
        home_id: g.get("home_team") || "",
        away_id: g.get("away_team") || "",
        home_slug: (function () { try { return app.findRecordById("event_teams", g.get("home_team")).get("slug"); } catch (err) { return ""; } })(),
        away_slug: (function () { try { return app.findRecordById("event_teams", g.get("away_team")).get("slug"); } catch (err) { return ""; } })(),
        home_runs: conflict ? null : g.get("home_runs"),
        away_runs: conflict ? null : g.get("away_runs"),
        score_source: source,
        book_state: source || "",
        winner: teamName(g.get("winner")),
        winner_id: g.get("winner") || "",
        winner_to: feed.winner_to || "",
        loser_to: feed.loser_to || "",
        protest_note: g.get("protest_note") || "",
        status: g.get("status"),
        field: g.get("field_name") || "",
        time: g.get("time") || "",
        date: g.get("date") || "",
        tie: g.get("status") === "final" && hr === ar,
      };
    });
  return {
    event: host.eventJson(event, app, auth),
    fields: scheduleMod.eventFields(app, eventId),
    standings: poolStandings(app, eventId),
    schedule: schedule,
    bracket: bracket,
    overall: listOverall(schedule, bracket),
    leaders: (function () {
      const mins = dynamicLeaderMins(maxFinalsPerTeam(schedule, bracket), packet);
      const computed = eventLeaders(app, eventId, mins);
      computed.min_ab = mins.min_ab;
      computed.min_ip = mins.min_ip;
      computed.games_played = mins.games_played;
      computed.qualify_source = mins.source;
      computed.award_min_ab = WEEKEND_MIN_AB;
      computed.award_min_ip = WEEKEND_MIN_IP;
      computed.stats_note = liveStatsNote(mins, packet && packet.stats_note);
      const capOuts = pitchIpCapOuts({
        pitch_limit_mode: event.get("pitch_limit_mode") || "none",
        pitch_limit_ip: event.get("pitch_limit_ip") || 0,
      });
      computed.has_pitch_ip_cap = capOuts != null;
      computed.pitch_limit_ip = capOuts != null ? capOuts / 3 : null;
      computed.pitch_counts = (computed.pitch_counts || []).map(function (r) {
        r.over = capOuts != null && r.ip_outs > capOuts;
        r.limit_ip = capOuts != null ? capOuts / 3 : null;
        return r;
      });
      function displayHit(r) {
        return {
          player: r.name_key || r.player || "",
          team: r.team || "",
          ab: r.ab, h: r.h, rbi: r.rbi,
          avg: r.avg_display || r.avg || "",
          ops: r.ops || "",
          q: !!r.q,
        };
      }
      function displayPit(r) {
        return {
          player: r.name_key || r.player || "",
          team: r.team || "",
          ip: r.ip, k: r.so || r.k, era: r.era_display || r.era || "",
          q: !!r.q,
        };
      }
      computed.full_hitting = (computed.all_hitting || []).map(displayHit);
      computed.full_pitching = (computed.all_pitching || []).map(displayPit);
      if (!packet) return computed;
      const hit = (packet.leaders && packet.leaders.hitting) || [];
      const pit = (packet.leaders && packet.leaders.pitching) || [];
      if (hit.length) {
        computed.published_hitting = hit;
        computed.all_tournament.hitters = hit.slice(0, 8).map(function (r) {
          return { name_key: r.player, team: r.team, avg_display: r.avg, rbi: r.rbi, ops: r.ops, h: r.h };
        });
      }
      if (pit.length) {
        computed.published_pitching = pit;
        computed.all_tournament.pitchers = pit.slice(0, 5).map(function (r) {
          return { name_key: r.player, team: r.team, ip: r.ip, era_display: r.era, so: r.k };
        });
      }
      if (packet.stats_note) computed.stats_note = packet.stats_note;
      if (packet.stats_hitting && packet.stats_hitting.length) computed.full_hitting = packet.stats_hitting;
      if (packet.stats_pitching && packet.stats_pitching.length) computed.full_pitching = packet.stats_pitching;
      return computed;
    })(),
    packet: packet,
    roster: (function () {
      try {
        return host.publicRoster(app, event, auth);
      } catch (err) {
        return [];
      }
    })(),
    photos: (function () {
      try {
        const director = require(__hooks + "/softball.js").isEventAdmin(event, auth, app);
        return require(__hooks + "/photos.js").listPhotos(app, eventId, !director);
      } catch (err) {
        return [];
      }
    })(),
    header_photo: (function () {
      try { return require(__hooks + "/photos.js").headerPhoto(app, eventId); }
      catch (err) { return null; }
    })(),
  };
}

module.exports = {
  slugify: slugify,
  parseCsv: parseCsv,
  poolStandings: poolStandings,
  importSchedule: importSchedule,
  importIntoEvent: importIntoEvent,
  wantsCreateEvent: wantsCreateEvent,
  isPlaceholderWeekend: isPlaceholderWeekend,
  advanceBracket: advanceBracket,
  eventLeaders: eventLeaders,
  dynamicLeaderMins: dynamicLeaderMins,
  maxFinalsPerTeam: maxFinalsPerTeam,
  pitchIpCapOuts: pitchIpCapOuts,
  publicBoard: publicBoard,
  listOverall: listOverall,
  compareWeekendGames: compareWeekendGames,
  inferSide: inferSide,
  upsertEventTeam: upsertEventTeam,
  parseTiebreak: parseTiebreak,
  saveTiebreak: saveTiebreak,
  savePoolTiebreaks: savePoolTiebreaks,
  poolTiebreak: poolTiebreak,
  tiebreakLabel: tiebreakLabel,
  sortPool: sortPool,
  DEFAULT_TIEBREAK: DEFAULT_TIEBREAK,
};
