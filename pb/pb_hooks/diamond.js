function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(function (l) { return l.trim(); });
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(function (h) { return h.trim().toLowerCase(); });
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(function (c) { return c.trim(); });
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j] || "";
    rows.push(row);
  }
  return rows;
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

function sortPool(teams, games, order) {
  const criteria = (order && order.length !== undefined && typeof order !== "string" && !order.order)
    ? (order.length ? order.slice() : parseTiebreak(null))
    : parseTiebreak(order);
  const reasons = {};
  const ranked = sortGroup(teams.slice(), games, criteria, reasons, "");
  for (let i = 0; i < ranked.length; i++) {
    const row = ranked[i];
    row.seed = i + 1;
    row.diff = Number(row.rs || 0) - Number(row.ra || 0);
    row.win_pct = Math.round(winPct(row) * 1000) / 1000;
    let reason = reasons[row.id] || "";
    if (!reason) {
      if (ranked.length === 1) reason = "only team in the pool";
      else if (i === 0) reason = reasons[ranked[1].id] || TIEBREAK_LABELS[criteria[0]];
      else reason = "name order";
    }
    row.seed_reason = reason;
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
  return { imported: created.length, standings: poolStandings(app, event.id) };
}

function inferSide(round, side) {
  if (side) return side;
  const r = String(round || "").toUpperCase();
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

function advanceBracket(app, eventId) {
  const games = app.findRecordsByFilter("bracket_games", "event = {:e}", "slot", 40, 0, { e: eventId });
  const champ = games.filter(function (g) {
    return inferSide(g.get("round"), g.get("side")) === "championship";
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

function ba(h, ab) {
  if (!ab) return 0;
  return h / ab;
}

function era(er, ipOuts) {
  if (!ipOuts) return null;
  return (er * 7) / (ipOuts / 3);
}

function eventLeaders(app, eventId) {
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
    return r;
  }).filter(function (r) { return r.ab >= 8; }).sort(function (a, b) { return b.avg - a.avg; });

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
    return r;
  });
  const gatedPitch = pitching.filter(function (r) { return r.ip_outs >= 9; }).sort(function (a, b) {
    if (a.era == null) return 1;
    if (b.era == null) return -1;
    return a.era - b.era;
  });
  return {
    hitting: hitting,
    pitching: gatedPitch,
    pitch_counts: pitching.sort(function (a, b) { return b.ip_outs - a.ip_outs; }),
    all_tournament: {
      hitters: hitting.slice(0, 8),
      pitchers: gatedPitch.slice(0, 2),
    },
  };
}

function overallRowKey(row) {
  return [row.date || "9999-99-99", row.time || "99:99", row.field || "zzz", row.kind || "", row.round || "", row.home || ""].join("|");
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
      home_runs: g.home_runs,
      away_runs: g.away_runs,
      status: g.status,
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
      home_runs: g.home_runs,
      away_runs: g.away_runs,
      status: g.status,
      protest_note: g.protest_note || "",
    });
  }
  rows.sort(function (a, b) {
    const ka = overallRowKey(a);
    const kb = overallRowKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
  return rows;
}

function publicBoard(app, event, auth) {
  const eventId = event.id;
  const bracketRecs = app.findRecordsByFilter("bracket_games", "event = {:e}", "round,slot", 40, 0, { e: eventId });
  function teamName(id) {
    if (!id) return "";
    try { return app.findRecordById("event_teams", id).get("name"); } catch (err) { return ""; }
  }
  const host = require(__hooks + "/host.js");
  const scheduleMod = require(__hooks + "/schedule.js");
  const packet = host.parsePacket(event.get("packet"));
  const schedule = scheduleMod.listSchedule(app, eventId, auth);
  const bracket = bracketRecs.map(function (g) {
      const round = g.get("round");
      const hr = Number(g.get("home_runs") || 0);
      const ar = Number(g.get("away_runs") || 0);
      return {
        id: g.id,
        game_id: g.get("game_id") || "",
        game_number: Number(g.get("game_number") || 0) || 0,
        round: round,
        slot: g.get("slot"),
        side: inferSide(round, g.get("side")),
        home: teamName(g.get("home_team")),
        away: teamName(g.get("away_team")),
        home_id: g.get("home_team") || "",
        away_id: g.get("away_team") || "",
        home_runs: g.get("home_runs"),
        away_runs: g.get("away_runs"),
        winner: teamName(g.get("winner")),
        winner_id: g.get("winner") || "",
        protest_note: g.get("protest_note") || "",
        status: g.get("status"),
        field: g.get("field_name") || "",
        time: g.get("time") || "",
        date: g.get("date") || "",
        tie: g.get("status") === "final" && hr === ar,
      };
    });
  return {
    event: host.eventJson(event, app),
    fields: scheduleMod.eventFields(app, eventId),
    standings: poolStandings(app, eventId),
    schedule: schedule,
    bracket: bracket,
    overall: listOverall(schedule, bracket),
    leaders: (function () {
      const computed = eventLeaders(app, eventId);
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
      computed.stats_note = packet.stats_note || "";
      computed.min_ab = packet.min_ab || 8;
      computed.min_ip = packet.min_ip || 5;
      computed.full_hitting = packet.stats_hitting || [];
      computed.full_pitching = packet.stats_pitching || [];
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
        const director = require(__hooks + "/softball.js").isEventAdmin(event, auth);
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
  advanceBracket: advanceBracket,
  eventLeaders: eventLeaders,
  publicBoard: publicBoard,
  listOverall: listOverall,
  upsertEventTeam: upsertEventTeam,
  parseTiebreak: parseTiebreak,
  saveTiebreak: saveTiebreak,
  savePoolTiebreaks: savePoolTiebreaks,
  poolTiebreak: poolTiebreak,
  tiebreakLabel: tiebreakLabel,
  sortPool: sortPool,
  DEFAULT_TIEBREAK: DEFAULT_TIEBREAK,
};
