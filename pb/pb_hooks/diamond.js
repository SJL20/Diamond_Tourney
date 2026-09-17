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

function headToHead(aId, bId, games) {
  let aWins = 0, bWins = 0;
  for (const g of games) {
    const home = g.get("home");
    const away = g.get("away");
    if (!((home === aId && away === bId) || (home === bId && away === aId))) continue;
    const hr = Number(g.get("home_runs") || 0);
    const ar = Number(g.get("away_runs") || 0);
    const aRuns = home === aId ? hr : ar;
    const bRuns = home === aId ? ar : hr;
    if (aRuns > bRuns) aWins++;
    else if (bRuns > aRuns) bWins++;
  }
  if (aWins === bWins) return 0;
  return aWins > bWins ? -1 : 1;
}

function compareTeams(a, b, games) {
  if (a.w !== b.w) return b.w - a.w;
  if (a.l !== b.l) return a.l - b.l;
  const h2h = headToHead(a.id, b.id, games);
  if (h2h) return h2h;
  if (a.ra !== b.ra) return a.ra - b.ra;
  if (a.rs !== b.rs) return b.rs - a.rs;
  return a.name < b.name ? -1 : 1;
}

function poolStandings(app, eventId) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: eventId });
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
    const ranked = pools[name].slice();
    ranked.sort(function (a, b) { return compareTeams(a, b, games); });
    ranked.forEach(function (r, i) { r.seed = i + 1; r.diff = r.rs - r.ra; });
    out.push({ name: name, teams: ranked });
  }
  return out;
}

function importSchedule(app, event, csv) {
  const rows = parseCsv(csv);
  const created = [];
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
    app.save(rec);
    created.push(rec.id);
  }
  return { imported: created.length, standings: poolStandings(app, event.id) };
}

function advanceBracket(app, eventId) {
  const games = app.findRecordsByFilter("bracket_games", "event = {:e}", "slot", 40, 0, { e: eventId });
  const s1 = games.find(function (g) { return g.get("round") === "SF" && Number(g.get("slot")) === 1; });
  const s2 = games.find(function (g) { return g.get("round") === "SF" && Number(g.get("slot")) === 2; });
  const fin = games.find(function (g) { return g.get("round") === "F"; });
  if (!fin) return;
  if (s1 && s1.get("status") === "final" && s1.get("winner")) fin.set("home_team", s1.get("winner"));
  if (s2 && s2.get("status") === "final" && s2.get("winner")) fin.set("away_team", s2.get("winner"));
  app.save(fin);
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

function publicBoard(app, event) {
  const eventId = event.id;
  const schedule = app.findRecordsByFilter("event_schedule", "event = {:e}", "date,time", 200, 0, { e: eventId });
  const bracket = app.findRecordsByFilter("bracket_games", "event = {:e}", "round,slot", 40, 0, { e: eventId });
  function teamName(id) {
    if (!id) return "";
    try { return app.findRecordById("event_teams", id).get("name"); } catch (err) { return ""; }
  }
  return {
    event: {
      name: event.get("name"),
      slug: event.get("slug"),
      venue: event.get("venue"),
      ages: event.get("ages"),
      status: event.get("status"),
      pitch_limit_ip: event.get("pitch_limit_ip") || 6,
    },
    standings: poolStandings(app, eventId),
    schedule: schedule.map(function (g) {
      return {
        id: g.id,
        date: g.get("date"),
        time: g.get("time"),
        home: teamName(g.get("home")),
        away: teamName(g.get("away")),
        home_runs: g.get("home_runs"),
        away_runs: g.get("away_runs"),
        status: g.get("status"),
      };
    }),
    bracket: bracket.map(function (g) {
      return {
        id: g.id,
        round: g.get("round"),
        slot: g.get("slot"),
        home: teamName(g.get("home_team")),
        away: teamName(g.get("away_team")),
        home_runs: g.get("home_runs"),
        away_runs: g.get("away_runs"),
        winner: teamName(g.get("winner")),
        status: g.get("status"),
      };
    }),
    leaders: eventLeaders(app, eventId),
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
  upsertEventTeam: upsertEventTeam,
};
