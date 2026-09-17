/// <reference path="../pb_data/types.d.ts" />

function ipToOuts(ip) {
  if (ip === null || ip === undefined || ip === "") return null;
  if (typeof ip === "number" && Number.isInteger(ip) && ip >= 10) return ip;
  const text = String(ip).trim();
  if (!text) return null;
  if (text.includes(".")) {
    const parts = text.split(".");
    const rem = parseInt(parts[1].charAt(0) || "0", 10);
    if (![0, 1, 2].includes(rem)) {
      throw new Error("invalid IP remainder: " + ip);
    }
    return (parseInt(parts[0] || "0", 10) * 3) + rem;
  }
  return parseInt(text, 10) * 3;
}

function outsToIp(outs) {
  const n = Number(outs || 0);
  return Math.floor(n / 3) + "." + (n % 3);
}

function battingAverage(h, ab) {
  if (!ab) return ".000";
  return (h / ab).toFixed(3).replace(/^0/, "");
}

function contactPct(ab, so) {
  if (!ab) return null;
  return (((ab - so) / ab) * 100).toFixed(1);
}

function era(er, ipOuts) {
  if (!ipOuts) return null;
  return ((er * 7) / (ipOuts / 3)).toFixed(2);
}

function strikePct(strikes, pitches) {
  if (!pitches) return null;
  return ((strikes / pitches) * 100).toFixed(1);
}

function normalizeOpp(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function makeDedupKey(teamId, date, opponent, us, them) {
  return teamId + "|" + date + "|" + normalizeOpp(opponent) + "|" + us + "-" + them;
}

function parsePayload(raw) {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (err) {
      return {};
    }
  }
  if (typeof raw === "object") return raw;
  return {};
}

function findPlayer(app, teamId, nameKey, jersey) {
  const key = String(nameKey || "").trim();
  try {
    return app.findFirstRecordByFilter(
      "players",
      "team = {:team} && name_key = {:key}",
      { team: teamId, key: key },
    );
  } catch (err) {}

  if (jersey !== undefined && jersey !== null && String(jersey) !== "") {
    const matches = app.findRecordsByFilter(
      "players",
      "team = {:team} && jersey = {:j}",
      "",
      5,
      0,
      { team: teamId, j: String(jersey) },
    );
    if (matches.length === 1) return matches[0];
  }

  const loose = key.replace(/#/g, "").toLowerCase();
  const all = app.findRecordsByFilter("players", "team = {:team}", "", 50, 0, { team: teamId });
  const hits = [];
  for (const p of all) {
    const candidate = (p.get("name_key") + " " + p.get("display_name") + " " + p.get("jersey")).toLowerCase();
    if (loose && candidate.indexOf(loose.split(" ")[0]) >= 0 && candidate.indexOf(String(jersey || p.get("jersey"))) >= 0) {
      hits.push(p);
    }
  }
  if (hits.length === 1) return hits[0];
  return null;
}

function rebuildTeamRecord(app, teamId) {
  const games = app.findRecordsByFilter(
    "team_games",
    "team = {:team} && status = 'approved'",
    "",
    500,
    0,
    { team: teamId },
  );
  let w = 0, l = 0, t = 0;
  for (const g of games) {
    const r = g.get("result");
    if (r === "W") w++;
    else if (r === "L") l++;
    else if (r === "T") t++;
  }
  const team = app.findRecordById("teams", teamId);
  team.set("public_record_wins", w);
  team.set("public_record_losses", l);
  team.set("public_record_ties", t);
  app.save(team);
  return { wins: w, losses: l, ties: t };
}

function applyStaging(app, staging) {
  if (staging.get("status") === "approved" && staging.get("applied_game")) {
    return { already: true, gameId: staging.get("applied_game") };
  }
  const payload = parsePayload(staging.get("payload"));
  const teamId = staging.get("team");
  const date = payload.date;
  const opponent = payload.opponent;
  const us = Number(payload.us_runs);
  const them = Number(payload.them_runs);
  if (!date || !opponent || Number.isNaN(us) || Number.isNaN(them)) {
    throw new BadRequestError("staging payload missing date, opponent, or score");
  }
  const key = payload.dedup_key || makeDedupKey(teamId, date, opponent, us, them);
  try {
    const existing = app.findFirstRecordByData("team_games", "dedup_key", key);
    staging.set("status", "approved");
    staging.set("applied_game", existing.id);
    app.save(staging);
    rebuildTeamRecord(app, teamId);
    return { already: true, gameId: existing.id, dedup: true };
  } catch (err) {}

  let result = payload.result;
  if (!result) {
    result = us > them ? "W" : us < them ? "L" : "T";
  }

  const game = new Record(app.findCollectionByNameOrId("team_games"));
  game.set("team", teamId);
  game.set("date", date);
  game.set("opponent", opponent);
  game.set("us_runs", us);
  game.set("them_runs", them);
  game.set("result", result);
  game.set("source", payload.source || "gc");
  game.set("status", "approved");
  game.set("source_ref", payload.source_ref || key);
  game.set("dedup_key", key);
  game.set("staging", staging.id);
  app.save(game);

  const unmatched = [];
  for (const line of (payload.hitting || [])) {
    if (line.ab === null && line.h === null) continue;
    const player = findPlayer(app, teamId, line.name_key, line.jersey);
    if (!player) {
      unmatched.push({ kind: "hitting", name_key: line.name_key, jersey: line.jersey });
      continue;
    }
    const rec = new Record(app.findCollectionByNameOrId("hitting_game"));
    rec.set("game", game.id);
    rec.set("player", player.id);
    rec.set("ab", line.ab ?? 0);
    rec.set("r", line.r ?? 0);
    rec.set("h", line.h ?? 0);
    rec.set("rbi", line.rbi ?? 0);
    rec.set("bb", line.bb ?? 0);
    rec.set("so", line.so ?? 0);
    rec.set("extra_notes", line.extra_notes || "");
    app.save(rec);
  }
  for (const line of (payload.pitching || [])) {
    const player = findPlayer(app, teamId, line.name_key, line.jersey);
    if (!player) {
      unmatched.push({ kind: "pitching", name_key: line.name_key, jersey: line.jersey });
      continue;
    }
    let outs = line.ip_outs;
    if (outs === undefined || outs === null) outs = ipToOuts(line.ip);
    const rec = new Record(app.findCollectionByNameOrId("pitching_game"));
    rec.set("game", game.id);
    rec.set("player", player.id);
    rec.set("ip_outs", outs ?? 0);
    rec.set("h", line.h ?? 0);
    rec.set("r", line.r ?? 0);
    rec.set("er", line.er ?? 0);
    rec.set("bb", line.bb ?? 0);
    rec.set("so", line.so ?? 0);
    rec.set("pitches", line.pitches ?? 0);
    rec.set("strikes", line.strikes ?? 0);
    app.save(rec);
  }

  staging.set("status", "approved");
  staging.set("applied_game", game.id);
  if (unmatched.length) {
    const notes = staging.get("parser_notes") || "";
    staging.set("parser_notes", (notes ? notes + "\n" : "") + "Unmatched on approve: " + JSON.stringify(unmatched));
  }
  app.save(staging);
  const record = rebuildTeamRecord(app, teamId);
  notifyBotB(app, { type: "game_approved", teamId: teamId, gameId: game.id, record: record });
  return { already: false, gameId: game.id, unmatched: unmatched, record: record };
}

function notifyBotB(app, body) {
  const url = $os.getenv("BOT_B_WEBHOOK_URL");
  if (!url) return;
  try {
    $http.send({
      url: url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + ($os.getenv("BOT_B_WEBHOOK_KEY") || ""),
      },
      body: JSON.stringify(body),
      timeout: 8,
    });
  } catch (err) {
    console.log("Bot B webhook failed", err);
  }
}

function seasonTables(app, teamId) {
  const hittingRows = app.findRecordsByFilter(
    "hitting_game",
    "game.team = {:team} && game.status = 'approved'",
    "",
    1000,
    0,
    { team: teamId },
  );
  const pitchingRows = app.findRecordsByFilter(
    "pitching_game",
    "game.team = {:team} && game.status = 'approved'",
    "",
    1000,
    0,
    { team: teamId },
  );
  const hit = {};
  for (const row of hittingRows) {
    const pid = row.get("player");
    if (!hit[pid]) hit[pid] = { player: pid, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 };
    hit[pid].ab += Number(row.get("ab") || 0);
    hit[pid].r += Number(row.get("r") || 0);
    hit[pid].h += Number(row.get("h") || 0);
    hit[pid].rbi += Number(row.get("rbi") || 0);
    hit[pid].bb += Number(row.get("bb") || 0);
    hit[pid].so += Number(row.get("so") || 0);
  }
  const hitting = Object.values(hit).map((r) => {
    r.ba = battingAverage(r.h, r.ab);
    r.contact_pct = contactPct(r.ab, r.so);
    try {
      const p = app.findRecordById("players", r.player);
      r.name_key = p.get("name_key");
      r.display_name = p.get("display_name");
      r.jersey = p.get("jersey");
    } catch (err) {}
    return r;
  });
  const pit = {};
  for (const row of pitchingRows) {
    const pid = row.get("player");
    if (!pit[pid]) pit[pid] = { player: pid, ip_outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, pitches: 0, strikes: 0 };
    pit[pid].ip_outs += Number(row.get("ip_outs") || 0);
    pit[pid].h += Number(row.get("h") || 0);
    pit[pid].r += Number(row.get("r") || 0);
    pit[pid].er += Number(row.get("er") || 0);
    pit[pid].bb += Number(row.get("bb") || 0);
    pit[pid].so += Number(row.get("so") || 0);
    pit[pid].pitches += Number(row.get("pitches") || 0);
    pit[pid].strikes += Number(row.get("strikes") || 0);
  }
  const pitching = Object.values(pit).map((r) => {
    r.ip = outsToIp(r.ip_outs);
    r.era = era(r.er, r.ip_outs);
    r.strike_pct = strikePct(r.strikes, r.pitches);
    try {
      const p = app.findRecordById("players", r.player);
      r.name_key = p.get("name_key");
      r.display_name = p.get("display_name");
      r.jersey = p.get("jersey");
    } catch (err) {}
    return r;
  });
  return { hitting, pitching, record: rebuildTeamRecord(app, teamId) };
}

function requireRole(e, roles) {
  const auth = e.auth;
  if (!auth) throw new UnauthorizedError("login required");
  if (auth.isSuperuser()) return auth;
  if (roles.indexOf(auth.get("role")) === -1) {
    throw new ForbiddenError("role not allowed");
  }
  return auth;
}

routerAdd("GET", "/api/health", (e) => {
  return e.json(200, { ok: true, app: "region-softball" });
});

routerAdd("GET", "/api/metrics/preview", (e) => {
  const ipOutsA = ipToOuts("2.1");
  const ipOutsB = ipToOuts("1.2");
  return e.json(200, {
    ip_2_1_plus_1_2: outsToIp(ipOutsA + ipOutsB),
    era_example: era(2, 12),
    ba_example: battingAverage(5, 16),
  });
});

routerAdd("POST", "/api/bot/ingest", (e) => {
  const auth = requireRole(e, ["bot", "region_admin"]);
  const body = e.requestInfo().body || {};
  const slug = body.team_slug;
  if (!slug) throw new BadRequestError("team_slug required");
  const team = e.app.findFirstRecordByData("teams", "slug", slug);
  const payload = body.payload || body;
  payload.team_slug = slug;
  if (!payload.dedup_key && payload.date && payload.opponent != null && payload.us_runs != null) {
    payload.dedup_key = makeDedupKey(team.id, payload.date, payload.opponent, payload.us_runs, payload.them_runs);
  }
  const unmatched = [];
  for (const line of (payload.hitting || []).concat(payload.pitching || [])) {
    if (!findPlayer(e.app, team.id, line.name_key, line.jersey)) {
      unmatched.push({ name_key: line.name_key, jersey: line.jersey, needs_player_link: true });
    }
  }
  payload.unmatched = unmatched;
  const status = (body.status || (payload.qc_needs_review ? "needs_review" : "staged"));
  const rec = new Record(e.app.findCollectionByNameOrId("staging_games"));
  rec.set("team", team.id);
  rec.set("payload", payload);
  rec.set("parser_notes", body.parser_notes || payload.parser_notes || "");
  rec.set("status", status);
  e.app.save(rec);
  return e.json(200, {
    id: rec.id,
    status: rec.get("status"),
    unmatched: unmatched,
    preview: payload,
    actor: auth.email(),
  });
}, $apis.requireAuth());

routerAdd("POST", "/api/coach/staging/{id}/decision", (e) => {
  const auth = requireRole(e, ["team_coach", "region_admin"]);
  const id = e.request.pathValue("id");
  const body = e.requestInfo().body || {};
  const decision = body.decision;
  const staging = e.app.findRecordById("staging_games", id);
  if (auth.get("role") === "team_coach" && staging.get("team") !== auth.get("team")) {
    throw new ForbiddenError("not your team");
  }
  if (decision === "reject") {
    staging.set("status", "rejected");
    e.app.save(staging);
    return e.json(200, { id: staging.id, status: "rejected" });
  }
  if (decision !== "approve") throw new BadRequestError("decision must be approve or reject");
  const result = e.app.runInTransaction((txApp) => applyStaging(txApp, txApp.findRecordById("staging_games", id)));
  return e.json(200, result);
}, $apis.requireAuth());

routerAdd("POST", "/api/bot/publish", (e) => {
  requireRole(e, ["bot", "region_admin"]);
  const body = e.requestInfo().body || {};
  const slug = body.team_slug;
  if (!slug) throw new BadRequestError("team_slug required");
  const team = e.app.findFirstRecordByData("teams", "slug", slug);
  const tables = seasonTables(e.app, team.id);
  const pending = e.app.findRecordsByFilter(
    "staging_games",
    "team = {:team} && (status = 'staged' || status = 'needs_review')",
    "-created",
    50,
    0,
    { team: team.id },
  );
  const games = e.app.findRecordsByFilter(
    "team_games",
    "team = {:team} && status = 'approved'",
    "-date",
    20,
    0,
    { team: team.id },
  );
  let recap = null;
  if (body.draft_recap !== false && games.length) {
    const last = games[0];
    const title = team.get("name") + " recap — " + last.get("date");
    let existing = null;
    try {
      existing = e.app.findFirstRecordByData("posts", "title", title);
    } catch (err) {}
    if (!existing) {
      const post = new Record(e.app.findCollectionByNameOrId("posts"));
      const wl = tables.record.wins + "-" + tables.record.losses;
      post.set("title", title);
      post.set("body",
        team.get("name") + " is " + wl + " after a " + last.get("result") +
        " against " + last.get("opponent") + " (" + last.get("us_runs") + "-" + last.get("them_runs") + "). " +
        "Season hitting and pitching tables were rebuilt from approved games only. " +
        pending.length + " game(s) remain in the review queue. " +
        "This recap is unpublished until the owner says so."
      );
      post.set("public", false);
      post.set("team", team.id);
      e.app.save(post);
      recap = { id: post.id, title: title, public: false };
    } else {
      recap = { id: existing.id, title: title, public: existing.get("public"), already: true };
    }
  }
  return e.json(200, {
    team: slug,
    record: tables.record,
    hitting: tables.hitting,
    pitching: tables.pitching,
    staging_open: pending.map((p) => ({ id: p.id, status: p.get("status") })),
    recap: recap,
  });
}, $apis.requireAuth());

routerAdd("POST", "/api/bot/event-update", (e) => {
  requireRole(e, ["bot", "region_admin", "event_td"]);
  const body = e.requestInfo().body || {};
  const event = e.app.findFirstRecordByData("events", "slug", body.event_slug);
  if (body.schedule_id) {
    const row = e.app.findRecordById("event_schedule", body.schedule_id);
    if (body.home_runs != null) row.set("home_runs", body.home_runs);
    if (body.away_runs != null) row.set("away_runs", body.away_runs);
    if (body.status) row.set("status", body.status);
    e.app.save(row);
    if (body.box) {
      const box = new Record(e.app.findCollectionByNameOrId("event_boxes"));
      box.set("schedule_row", row.id);
      box.set("hitting", body.box.hitting || []);
      box.set("pitching", body.box.pitching || []);
      box.set("source", body.box.source || "gc");
      e.app.save(box);
    }
  }
  if (body.bracket_id && body.winner_id) {
    const bg = e.app.findRecordById("bracket_games", body.bracket_id);
    if (bg.getString("status") === "locked") {
      throw new BadRequestError("cannot change locked bracket");
    }
    bg.set("winner", body.winner_id);
    bg.set("status", "final");
    if (body.home_runs != null) bg.set("home_runs", body.home_runs);
    if (body.away_runs != null) bg.set("away_runs", body.away_runs);
    e.app.save(bg);
  }
  return e.json(200, { ok: true, event: event.get("slug") });
}, $apis.requireAuth());

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const auth = e.auth;
  if (auth && auth.get("role") === "bot") {
    throw new ForbiddenError("bot cannot update staging (cannot approve its own work)");
  }
  e.next();
}, "staging_games");
