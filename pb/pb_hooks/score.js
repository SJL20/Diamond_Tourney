function isDirector(auth) {
  return !!(auth && (auth.get("role") === "region_admin" || auth.get("role") === "event_td"));
}

function canScore(app, event, rec, auth) {
  if (!auth) return false;
  if (isDirector(auth)) return true;
  if (event.get("created_by") && event.get("created_by") === auth.id) return true;
  const home = rec.get("home") || rec.get("home_team");
  const away = rec.get("away") || rec.get("away_team");
  const mine = {};
  try {
    const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "", 80, 0, { e: event.id });
    for (const t of teams) {
      if (t.get("account") === auth.id) mine[t.id] = true;
      if (t.get("contact_email") && t.get("contact_email") === auth.email()) mine[t.id] = true;
    }
  } catch (err) {}
  return !!(mine[home] || mine[away]);
}

function requireScore(app, event, rec, auth) {
  if (!auth) throw new UnauthorizedError("Log in to post a result");
  if (!canScore(app, event, rec, auth)) {
    throw new ForbiddenError("Only the director or a manager of a team in this game can post a result.");
  }
}

function fileUrl(app, collectionName, rec, field) {
  const name = rec.get(field);
  if (!name) return "";
  const file = Array.isArray(name) ? name[0] : name;
  if (!file) return "";
  try {
    const col = app.findCollectionByNameOrId(collectionName);
    return "/api/files/" + col.id + "/" + rec.id + "/" + encodeURIComponent(file);
  } catch (err) {
    return "";
  }
}

function asList(raw) {
  if (!raw) return [];
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return [];
    try { return JSON.parse(text); } catch (err) {}
    const rows = [];
    const lines = text.split(/\r?\n/).filter(function (l) { return l.trim() && l.indexOf(",") !== -1; });
    for (const line of lines) {
      if (/^side,|^kind,|^jersey,/i.test(line)) continue;
      const cols = line.split(",").map(function (c) { return c.trim(); });
      if (cols[0] === "home" || cols[0] === "away" || cols[0] === "hit" || cols[0] === "pit") {
        if (cols[1] === "hit" || cols[1] === "hitting") {
          rows.push({ kind: "hit", side: cols[0], jersey: cols[2], name: cols[3], ab: cols[4], r: cols[5], h: cols[6], rbi: cols[7], bb: cols[8], so: cols[9] });
        } else if (cols[1] === "pit" || cols[1] === "pitching") {
          rows.push({ kind: "pit", side: cols[0], jersey: cols[2], name: cols[3], ip: cols[4], h: cols[5], r: cols[6], er: cols[7], bb: cols[8], so: cols[9] });
        } else if (cols[0] === "hit" || cols[0] === "hitting") {
          rows.push({ kind: "hit", side: cols[1], jersey: cols[2], name: cols[3], ab: cols[4], r: cols[5], h: cols[6], rbi: cols[7], bb: cols[8], so: cols[9] });
        } else {
          rows.push({ kind: "pit", side: cols[1], jersey: cols[2], name: cols[3], ip: cols[4], h: cols[5], r: cols[6], er: cols[7], bb: cols[8], so: cols[9] });
        }
        continue;
      }
      rows.push({ kind: "hit", jersey: cols[0], name: cols[1], ab: cols[2], r: cols[3], h: cols[4], rbi: cols[5], bb: cols[6], so: cols[7] });
    }
    return rows;
  }
  if (typeof raw === "object" && raw.length !== undefined) return raw;
  return [];
}

function upsertPlayer(app, teamId, name, jersey) {
  const nameKey = jersey ? (String(name || "").trim() + " #" + String(jersey).trim()) : String(name || "").trim();
  if (!nameKey) return null;
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "event_players",
      "event_team = {:t} && name_key = {:k}",
      { t: teamId, k: nameKey },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("event_players"));
    rec.set("event_team", teamId);
    rec.set("name_key", nameKey);
  }
  rec.set("jersey", jersey ? String(jersey) : "");
  app.save(rec);
  return rec;
}

function applyBoxLines(app, event, game, hitting, pitching) {
  const sb = require(__hooks + "/softball.js");
  function teamId(side) {
    if (side === "away") return game.get("away");
    return game.get("home");
  }
  for (const row of hitting || []) {
    const player = upsertPlayer(app, teamId(row.side) || game.get("home"), row.name || row.name_key, row.jersey);
    if (!player) continue;
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "event_hitting",
        "event = {:e} && event_player = {:p} && schedule_row = {:s}",
        { e: event.id, p: player.id, s: game.id },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_hitting"));
      rec.set("event", event.id);
      rec.set("event_player", player.id);
      rec.set("schedule_row", game.id);
    }
    rec.set("ab", Number(row.ab || 0));
    rec.set("r", Number(row.r || 0));
    rec.set("h", Number(row.h || 0));
    rec.set("rbi", Number(row.rbi || 0));
    rec.set("bb", Number(row.bb || 0));
    rec.set("so", Number(row.so || 0));
    app.save(rec);
  }
  for (const row of pitching || []) {
    const player = upsertPlayer(app, teamId(row.side) || game.get("home"), row.name || row.name_key, row.jersey);
    if (!player) continue;
    const outs = sb.ipToOuts(row.ip != null ? row.ip : row.ip_outs);
    if (outs == null) continue;
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "event_pitching",
        "event = {:e} && event_player = {:p} && schedule_row = {:s}",
        { e: event.id, p: player.id, s: game.id },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_pitching"));
      rec.set("event", event.id);
      rec.set("event_player", player.id);
      rec.set("schedule_row", game.id);
    }
    rec.set("ip_outs", outs);
    rec.set("h", Number(row.h || 0));
    rec.set("r", Number(row.r || 0));
    rec.set("er", Number(row.er || 0));
    rec.set("bb", Number(row.bb || 0));
    rec.set("so", Number(row.so || row.k || 0));
    if (row.pitches != null) rec.set("pitches", Number(row.pitches));
    app.save(rec);
  }
}

function boxJson(app, rec) {
  return {
    id: rec.id,
    hitting: rec.get("hitting") || [],
    pitching: rec.get("pitching") || [],
    source: rec.get("source") || "",
    status: rec.get("status") || "submitted",
    note: rec.get("note") || "",
    original_name: rec.get("original_name") || "",
    url: fileUrl(app, "event_boxes", rec, "file"),
  };
}

function postScore(app, event, id, body, auth) {
  const rec = app.findRecordById("event_schedule", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  requireScore(app, event, rec, auth);
  if (body.home_runs != null && body.home_runs !== "") rec.set("home_runs", Number(body.home_runs));
  if (body.away_runs != null && body.away_runs !== "") rec.set("away_runs", Number(body.away_runs));
  const director = isDirector(auth) || (event.get("created_by") && event.get("created_by") === auth.id);
  if (body.status) {
    if (!director && body.status === "final") rec.set("status", "submitted");
    else rec.set("status", body.status);
  } else if (body.home_runs != null && body.home_runs !== "" && body.away_runs != null && body.away_runs !== "") {
    rec.set("status", director ? "final" : "submitted");
  }
  if (director && body.confirm === true) rec.set("status", "final");
  if (body.notes != null) rec.set("notes", body.notes);
  rec.set("scored_by", auth.id);
  app.save(rec);
  const schedule = require(__hooks + "/schedule.js");
  return schedule.scheduleRow(app, rec, { can_score: true });
}

function saveBox(app, event, id, body, files, auth) {
  const rec = app.findRecordById("event_schedule", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  requireScore(app, event, rec, auth);
  const hitting = asList(body.hitting);
  const pitching = asList(body.pitching);
  let box;
  try {
    box = app.findFirstRecordByFilter("event_boxes", "schedule_row = {:s}", { s: rec.id });
  } catch (err) {
    box = new Record(app.findCollectionByNameOrId("event_boxes"));
    box.set("schedule_row", rec.id);
  }
  box.set("event", event.id);
  box.set("schedule_row", rec.id);
  if (files && files.length) {
    box.set("file", files);
    box.set("original_name", body.original_name || "box-score");
  }
  if (hitting.length) box.set("hitting", hitting);
  if (pitching.length) box.set("pitching", pitching);
  box.set("source", body.source || (isDirector(auth) ? "director" : "team"));
  box.set("status", isDirector(auth) ? "approved" : "submitted");
  box.set("submitted_by", auth.id);
  if (body.note != null) box.set("note", body.note);
  app.save(box);
  if (hitting.length || pitching.length) applyBoxLines(app, event, rec, hitting, pitching);
  if (body.home_runs != null || body.away_runs != null) {
    postScore(app, event, id, body, auth);
  }
  return boxJson(app, box);
}

function gameDetail(app, event, id, auth) {
  const rec = app.findRecordById("event_schedule", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  const schedule = require(__hooks + "/schedule.js");
  let box = null;
  try { box = app.findFirstRecordByFilter("event_boxes", "schedule_row = {:s}", { s: rec.id }); } catch (err) {}
  return {
    event: { id: event.id, slug: event.get("slug"), name: event.get("name") },
    game: schedule.scheduleRow(app, rec, {
      can_score: canScore(app, event, rec, auth),
      has_box: !!box,
    }),
    box: box ? boxJson(app, box) : null,
    director: isDirector(auth),
  };
}

function postBracketScore(app, event, id, body, auth) {
  const rec = app.findRecordById("bracket_games", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  requireScore(app, event, rec, auth);
  if (!isDirector(auth) && event.get("created_by") !== auth.id) {
    throw new ForbiddenError("Only the director can finalize a bracket game.");
  }
  if (body.home_runs != null) rec.set("home_runs", Number(body.home_runs));
  if (body.away_runs != null) rec.set("away_runs", Number(body.away_runs));
  rec.set("status", "final");
  const hr = Number(rec.get("home_runs") || 0);
  const ar = Number(rec.get("away_runs") || 0);
  if (hr > ar) rec.set("winner", rec.get("home_team"));
  else if (ar > hr) rec.set("winner", rec.get("away_team"));
  app.save(rec);
  const diamond = require(__hooks + "/diamond.js");
  diamond.advanceBracket(app, event.id);
  return { ok: true };
}

module.exports = {
  isDirector: isDirector,
  canScore: canScore,
  postScore: postScore,
  saveBox: saveBox,
  gameDetail: gameDetail,
  postBracketScore: postBracketScore,
};
