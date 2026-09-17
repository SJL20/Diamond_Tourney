/// <reference path="../pb_data/types.d.ts" />

routerAdd("GET", "/api/metrics/preview", (e) => {
  const sb = require(__hooks + "/softball.js");
  return e.json(200, {
    ip_2_1_plus_1_2: sb.outsToIp(sb.ipToOuts("2.1") + sb.ipToOuts("1.2")),
    era_example: sb.era(2, 12),
    ba_example: sb.battingAverage(5, 16),
  });
});

routerAdd("POST", "/api/bot/ingest", (e) => {
  const sb = require(__hooks + "/softball.js");
  const auth = sb.requireRole(e, ["bot", "region_admin"]);
  const body = e.requestInfo().body || {};
  const slug = body.team_slug;
  if (!slug) throw new BadRequestError("team_slug required");
  const team = e.app.findFirstRecordByData("teams", "slug", slug);
  const payload = body.payload || body;
  payload.team_slug = slug;
  if (!payload.dedup_key && payload.date && payload.opponent != null && payload.us_runs != null) {
    payload.dedup_key = sb.makeDedupKey(team.id, payload.date, payload.opponent, payload.us_runs, payload.them_runs);
  }
  const unmatched = [];
  const lines = (payload.hitting || []).concat(payload.pitching || []);
  for (const line of lines) {
    if (!sb.findPlayer(e.app, team.id, line.name_key, line.jersey)) {
      unmatched.push({ name_key: line.name_key, jersey: line.jersey, needs_player_link: true });
    }
  }
  payload.unmatched = unmatched;
  const status = (body.status || (payload.qc_needs_review ? "needs_review" : "staged"));
  const rec = new Record(e.app.findCollectionByNameOrId("staging_games"));
  rec.set("team", team.id);
  rec.set("payload", JSON.stringify(payload));
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
  const sb = require(__hooks + "/softball.js");
  const auth = sb.requireRole(e, ["team_coach", "region_admin"]);
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
  let result = null;
  e.app.runInTransaction((txApp) => {
    const sbTx = require(__hooks + "/softball.js");
    result = sbTx.applyStaging(txApp, txApp.findRecordById("staging_games", id));
  });
  if (result && result.teamId) {
    sb.notifyBotB({ type: "game_approved", teamId: result.teamId, gameId: result.gameId, record: result.record });
  }
  return e.json(200, result);
}, $apis.requireAuth());

routerAdd("POST", "/api/bot/publish", (e) => {
  const sb = require(__hooks + "/softball.js");
  sb.requireRole(e, ["bot", "region_admin"]);
  const body = e.requestInfo().body || {};
  const slug = body.team_slug;
  if (!slug) throw new BadRequestError("team_slug required");
  const team = e.app.findFirstRecordByData("teams", "slug", slug);
  const tables = sb.seasonTables(e.app, team.id);
  const pending = e.app.findRecordsByFilter(
    "staging_games",
    "team = {:team} && (status = 'staged' || status = 'needs_review')",
    "-id",
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

routerAdd("GET", "/api/event/{slug}/board", (e) => {
  const diamond = require(__hooks + "/diamond.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (!event.get("public") && !e.auth) throw new ForbiddenError("event is not public");
  return e.json(200, diamond.publicBoard(e.app, event));
});

routerAdd("POST", "/api/event/import-schedule", (e) => {
  const sb = require(__hooks + "/softball.js");
  const diamond = require(__hooks + "/diamond.js");
  sb.requireRole(e, ["region_admin", "event_td"]);
  const body = e.requestInfo().body || {};
  if (!body.event_slug || !body.csv) throw new BadRequestError("event_slug and csv required");
  let event;
  try {
    event = e.app.findFirstRecordByData("events", "slug", body.event_slug);
  } catch (err) {
    event = new Record(e.app.findCollectionByNameOrId("events"));
    event.set("name", body.event_name || body.event_slug);
    event.set("slug", body.event_slug);
    event.set("public", true);
    event.set("status", "live");
    event.set("format", "imported");
    event.set("venue", body.venue || "");
    event.set("ages", body.ages || "10U");
    event.set("pitch_limit_ip", 6);
    e.app.save(event);
  }
  if (body.replace) {
    const old = e.app.findRecordsByFilter("event_schedule", "event = {:e}", "", 400, 0, { e: event.id });
    for (const row of old) e.app.delete(row);
  }
  const result = diamond.importSchedule(e.app, event, body.csv);
  return e.json(200, { event: event.get("slug"), imported: result.imported, standings: result.standings });
}, $apis.requireAuth());

routerAdd("POST", "/api/bot/event-update", (e) => {
  const sb = require(__hooks + "/softball.js");
  sb.requireRole(e, ["bot", "region_admin", "event_td"]);
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
    bg.set("winner", body.winner_id);
    bg.set("status", "final");
    if (body.home_runs != null) bg.set("home_runs", body.home_runs);
    if (body.away_runs != null) bg.set("away_runs", body.away_runs);
    e.app.save(bg);
  }
  const diamond = require(__hooks + "/diamond.js");
  diamond.advanceBracket(e.app, event.id);
  return e.json(200, { ok: true, event: event.get("slug"), standings: diamond.poolStandings(e.app, event.id) });
}, $apis.requireAuth());

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const auth = e.auth;
  if (auth && auth.get("role") === "bot") {
    throw new ForbiddenError("bot cannot update staging (cannot approve its own work)");
  }
  e.next();
}, "staging_games");
