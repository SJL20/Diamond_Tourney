function ipToOuts(ip) {
  if (ip === null || ip === undefined || ip === "") return null;
  if (typeof ip === "number" && Number.isInteger(ip) && ip >= 10) return ip;
  const text = String(ip).trim();
  if (!text) return null;
  if (text.includes(".")) {
    const parts = text.split(".");
    const rem = parseInt(parts[1].charAt(0) || "0", 10);
    if ([0, 1, 2].indexOf(rem) === -1) {
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

function bytesToString(raw) {
  let s = "";
  for (let i = 0; i < raw.length; i++) {
    s += String.fromCharCode(raw[i]);
  }
  return s;
}

function parsePayload(raw) {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (err) {
      return {};
    }
  }
  if (typeof raw === "object") {
    if (raw.date || raw.opponent || raw.hitting) return raw;
    if (raw.length !== undefined && typeof raw[0] === "number") {
      try {
        return JSON.parse(bytesToString(raw));
      } catch (err) {
        return {};
      }
    }
  }
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

function notifyBotB(body) {
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
    rec.set("ab", line.ab == null ? 0 : line.ab);
    rec.set("r", line.r == null ? 0 : line.r);
    rec.set("h", line.h == null ? 0 : line.h);
    rec.set("rbi", line.rbi == null ? 0 : line.rbi);
    rec.set("bb", line.bb == null ? 0 : line.bb);
    rec.set("so", line.so == null ? 0 : line.so);
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
    rec.set("ip_outs", outs == null ? 0 : outs);
    rec.set("h", line.h == null ? 0 : line.h);
    rec.set("r", line.r == null ? 0 : line.r);
    rec.set("er", line.er == null ? 0 : line.er);
    rec.set("bb", line.bb == null ? 0 : line.bb);
    rec.set("so", line.so == null ? 0 : line.so);
    rec.set("pitches", line.pitches == null ? 0 : line.pitches);
    rec.set("strikes", line.strikes == null ? 0 : line.strikes);
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
  return { already: false, gameId: game.id, unmatched: unmatched, record: record, teamId: teamId };
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
  return { hitting: hitting, pitching: pitching, record: rebuildTeamRecord(app, teamId) };
}

function isSiteAdmin(auth) {
  if (!auth) return false;
  try { if (auth.isSuperuser()) return true; } catch (err) {}
  return auth.get("role") === "region_admin";
}

// Registration hands out event_td. That role lets someone create a weekend.
// It is not permission to run someone else's.
function isEventOwner(event, auth) {
  if (!auth || !event) return false;
  const creator = event.get("created_by");
  return !!(creator && creator === auth.id);
}

function isEventAdmin(event, auth) {
  return isSiteAdmin(auth) || isEventOwner(event, auth);
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

function requireEventAdmin(e, event) {
  const auth = e.auth;
  if (!auth) throw new UnauthorizedError("login required");
  if (isEventAdmin(event, auth)) return auth;
  throw new ForbiddenError("Only the director who created this tournament or a site admin can do that.");
}

function requireEventAdminOrBot(e, event) {
  const auth = e.auth;
  if (!auth) throw new UnauthorizedError("login required");
  if (auth.get("role") === "bot" || isEventAdmin(event, auth)) return auth;
  throw new ForbiddenError("Only a bot, the director who created this tournament, or a site admin can do that.");
}

module.exports = {
  ipToOuts: ipToOuts,
  outsToIp: outsToIp,
  battingAverage: battingAverage,
  era: era,
  bytesToString: bytesToString,
  parsePayload: parsePayload,
  makeDedupKey: makeDedupKey,
  findPlayer: findPlayer,
  applyStaging: applyStaging,
  seasonTables: seasonTables,
  isSiteAdmin: isSiteAdmin,
  isEventOwner: isEventOwner,
  isEventAdmin: isEventAdmin,
  requireRole: requireRole,
  requireEventAdmin: requireEventAdmin,
  requireEventAdminOrBot: requireEventAdminOrBot,
  notifyBotB: notifyBotB,
  rebuildTeamRecord: rebuildTeamRecord,
};
