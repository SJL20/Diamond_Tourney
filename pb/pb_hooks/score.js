function isDirector(auth, event, app) {
  return require(__hooks + "/softball.js").isEventAdmin(event, auth, app);
}

function canScore(app, event, rec, auth) {
  if (!auth) return false;
  if (isDirector(auth, event, app)) return true;
  if (auth.get("role") === "bot") return true;
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
    gc_url: rec.get("gc_url") || "",
    url: fileUrl(app, "event_boxes", rec, "file"),
    schedule_id: rec.get("schedule_row") || "",
    event_id: rec.get("event") || "",
  };
}

function upsertBox(app, event, game) {
  try {
    return app.findFirstRecordByFilter("event_boxes", "schedule_row = {:s}", { s: game.id });
  } catch (err) {
    const rec = new Record(app.findCollectionByNameOrId("event_boxes"));
    rec.set("schedule_row", game.id);
    rec.set("event", event.id);
    return rec;
  }
}

function pendingFilter(status) {
  return status === "queued" || status === "submitted" || status === "needs_review";
}

function boxWithGame(app, rec) {
  const row = boxJson(app, rec);
  try {
    const game = app.findRecordById("event_schedule", rec.get("schedule_row"));
    const schedule = require(__hooks + "/schedule.js");
    row.game = schedule.scheduleRow(app, game);
    try {
      row.event_slug = app.findRecordById("events", rec.get("event") || game.get("event")).get("slug");
    } catch (err) {}
  } catch (err) {}
  return row;
}

function listPendingBoxes(app, eventId) {
  const out = [];
  let rows = [];
  try {
    if (eventId) {
      rows = app.findRecordsByFilter("event_boxes", "event = {:e}", "-id", 120, 0, { e: eventId });
    } else {
      rows = app.findRecordsByFilter("event_boxes", "", "-id", 120, 0);
    }
  } catch (err) {
    return out;
  }
  for (const rec of rows) {
    if (!pendingFilter(rec.get("status"))) continue;
    out.push(boxWithGame(app, rec));
  }
  return out;
}

function postScore(app, event, id, body, auth) {
  const rec = app.findRecordById("event_schedule", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  requireScore(app, event, rec, auth);
  if (body.home_runs != null && body.home_runs !== "") rec.set("home_runs", Number(body.home_runs));
  if (body.away_runs != null && body.away_runs !== "") rec.set("away_runs", Number(body.away_runs));
  const director = isDirector(auth, event, app);
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
  const host = require(__hooks + "/host.js");
  const director = isDirector(auth, event, app);
  const bot = !!(auth && auth.get("role") === "bot");
  const hitting = asList(body.hitting);
  const pitching = asList(body.pitching);
  const gcUrl = String(body.gc_url || "").trim();
  if (gcUrl && !host.isGcBoxUrl(gcUrl)) {
    throw new BadRequestError("Paste a public GameChanger box-score URL (web.gc.com …/schedule/…/box-score).");
  }
  const box = upsertBox(app, event, rec);
  box.set("event", event.id);
  box.set("schedule_row", rec.id);
  if (files && files.length) {
    box.set("file", files);
    box.set("original_name", body.original_name || body.filename || "box-score.pdf");
  }
  if (gcUrl) box.set("gc_url", gcUrl);
  if (hitting.length) box.set("hitting", hitting);
  if (pitching.length) box.set("pitching", pitching);
  let source = body.source || "";
  if (!source) {
    if (bot) source = "bot";
    else if (gcUrl && !(files && files.length)) source = "gc_url";
    else if (director && files && files.length) source = "director_pdf";
    else if (files && files.length) source = "gc_pdf";
    else source = director ? "director" : "team";
  }
  box.set("source", source);
  const hasLines = !!(hitting.length || pitching.length);
  let status = body.status;
  if (!status) {
    if (bot && hasLines) status = "approved";
    else if (hasLines && director) status = "approved";
    else if (hasLines) status = "submitted";
    else status = "queued";
  }
  if (!director && !bot && status === "approved") status = hasLines ? "submitted" : "queued";
  if (director && (body.approve_file === true || body.approve_file === "true")) status = "approved";
  box.set("status", status);
  box.set("submitted_by", auth.id);
  if (body.note != null) box.set("note", body.note);
  app.save(box);
  if (hasLines) applyBoxLines(app, event, rec, hitting, pitching);
  if (body.home_runs != null || body.away_runs != null) {
    postScore(app, event, id, body, auth);
  }
  const out = boxJson(app, box);
  out.queued_for_bot = pendingFilter(box.get("status"));
  return out;
}

function botApply(app, body, auth) {
  const slug = body.event_slug || body.slug;
  if (!slug || !body.schedule_id) throw new BadRequestError("event_slug and schedule_id required");
  const event = app.findFirstRecordByData("events", "slug", slug);
  if (!auth || (auth.get("role") !== "bot" && !isDirector(auth, event, app))) {
    throw new ForbiddenError("Bot or the event director can post extracted stats");
  }
  const rec = app.findRecordById("event_schedule", body.schedule_id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  const hitting = asList(body.hitting);
  const pitching = asList(body.pitching);
  if (!hitting.length && !pitching.length && body.home_runs == null && !body.gc_url && !body.note) {
    throw new BadRequestError("Bot post needs hitting, pitching, a score, or a note");
  }
  const box = upsertBox(app, event, rec);
  box.set("event", event.id);
  box.set("schedule_row", rec.id);
  if (body.gc_url) {
    const host = require(__hooks + "/host.js");
    if (!host.isGcBoxUrl(body.gc_url)) throw new BadRequestError("gc_url must be a public GameChanger box-score page");
    box.set("gc_url", body.gc_url);
  }
  if (hitting.length) box.set("hitting", hitting);
  if (pitching.length) box.set("pitching", pitching);
  box.set("source", body.source || "bot");
  box.set("status", body.status || (body.apply === false ? "needs_review" : "approved"));
  box.set("submitted_by", auth.id);
  if (body.parser_notes != null) box.set("note", body.parser_notes);
  else if (body.note != null) box.set("note", body.note);
  app.save(box);
  if (hitting.length || pitching.length) applyBoxLines(app, event, rec, hitting, pitching);
  if (body.home_runs != null || body.away_runs != null) {
    if (body.home_runs != null) rec.set("home_runs", Number(body.home_runs));
    if (body.away_runs != null) rec.set("away_runs", Number(body.away_runs));
    rec.set("status", body.game_status || "final");
    rec.set("scored_by", auth.id);
    app.save(rec);
  }
  const diamond = require(__hooks + "/diamond.js");
  return {
    box: boxJson(app, box),
    standings: diamond.poolStandings(app, event.id),
  };
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
    director: isDirector(auth, event, app),
    routes: ["gc_pdf", "gc_url", "bot", "director_pdf"],
  };
}

function postBracketScore(app, event, id, body, auth) {
  const rec = app.findRecordById("bracket_games", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  requireScore(app, event, rec, auth);
  if (!isDirector(auth, event, app)) {
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
  botApply: botApply,
  listPendingBoxes: listPendingBoxes,
  gameDetail: gameDetail,
  postBracketScore: postBracketScore,
};
