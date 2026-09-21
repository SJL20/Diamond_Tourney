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

routerAdd("POST", "/api/account/register", (e) => {
  const host = require(__hooks + "/host.js");
  const body = e.requestInfo().body || {};
  return e.json(200, host.registerAccount(e.app, body));
});

routerAdd("GET", "/api/account/verify", (e) => {
  const host = require(__hooks + "/host.js");
  const q = e.requestInfo().query || {};
  return e.json(200, host.verifyAccount(e.app, q.token || ""));
});

routerAdd("POST", "/api/account/verify", (e) => {
  const host = require(__hooks + "/host.js");
  const body = e.requestInfo().body || {};
  const q = e.requestInfo().query || {};
  return e.json(200, host.verifyAccount(e.app, body.token || q.token || ""));
});

routerAdd("GET", "/api/geo/lookup", (e) => {
  const sb = require(__hooks + "/softball.js");
  sb.requireRole(e, ["region_admin", "event_td"]);
  const q = (e.requestInfo().query || {}).q || "";
  const hit = require(__hooks + "/geo.js").geocodeAddress(q);
  return e.json(200, hit ? { found: true, lat: hit.lat, lng: hit.lng, label: hit.label } : { found: false });
}, $apis.requireAuth());

routerAdd("GET", "/api/account/home", (e) => {
  const host = require(__hooks + "/host.js");
  if (!e.auth) throw new UnauthorizedError("login required");
  return e.json(200, host.accountHome(e.app, e.auth));
}, $apis.requireAuth());

routerAdd("POST", "/api/account/forgot", (e) => {
  const host = require(__hooks + "/host.js");
  const body = e.requestInfo().body || {};
  return e.json(200, host.requestPasswordReset(e.app, body.email));
});

routerAdd("POST", "/api/account/reset", (e) => {
  const host = require(__hooks + "/host.js");
  const body = e.requestInfo().body || {};
  return e.json(200, host.confirmPasswordReset(e.app, body.token, body.password));
});

routerAdd("GET", "/api/admin/events", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  sb.requireRole(e, ["region_admin"]);
  return e.json(200, { events: host.listAdminEvents(e.app) });
}, $apis.requireAuth());

routerAdd("POST", "/api/admin/events/{slug}/archive", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  sb.requireRole(e, ["region_admin"]);
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  return e.json(200, { event: host.archiveEvent(e.app, event) });
}, $apis.requireAuth());

routerAdd("POST", "/api/admin/events/{slug}/delete", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  sb.requireRole(e, ["region_admin"]);
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  return e.json(200, host.deleteEvent(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("GET", "/api/admin/clubs", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  sb.requireRole(e, ["region_admin"]);
  return e.json(200, { clubs: host.listClubs(e.app) });
}, $apis.requireAuth());

routerAdd("POST", "/api/admin/clubs", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  sb.requireRole(e, ["region_admin"]);
  return e.json(200, { club: host.saveClub(e.app, e.requestInfo().body || {}) });
}, $apis.requireAuth());

routerAdd("POST", "/api/admin/clubs/{id}", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  sb.requireRole(e, ["region_admin"]);
  return e.json(200, { club: host.saveClub(e.app, e.requestInfo().body || {}, e.request.pathValue("id")) });
}, $apis.requireAuth());

routerAdd("GET", "/api/year/{year}/board", (e) => {
  const year = require(__hooks + "/year.js");
  return e.json(200, year.yearBoard(e.app, e.request.pathValue("year")));
});

routerAdd("GET", "/api/events/search", (e) => {
  const host = require(__hooks + "/host.js");
  const q = (e.requestInfo().query || {}).q || "";
  return e.json(200, { events: host.searchEvents(e.app, q) });
});

routerAdd("POST", "/api/events/create", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const auth = sb.requireRole(e, ["region_admin", "event_td", "team_coach", "public"]);
  const body = e.requestInfo().body || {};
  const result = host.createEvent(e.app, body, auth);
  const rules = host.uploaded(e, "rules_file");
  if (rules) {
    const rec = e.app.findRecordById("events", result.event.id);
    rec.set("rules_file", rules);
    e.app.save(rec);
    result.event = host.eventJson(rec, e.app, e.auth);
  }
  return e.json(200, result);
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/duplicate", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const auth = sb.requireRole(e, ["region_admin", "event_td"]);
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (!(event.get("public") && event.get("status") !== "archived")) {
    sb.requireEventAdmin(e, event);
  }
  const result = host.duplicateEvent(e.app, event, e.requestInfo().body || {}, auth);
  return e.json(200, result);
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/signup", (e) => {
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  const body = e.requestInfo().body || {};
  const team = host.signupTeam(e.app, event, body, e.auth);
  const rec = e.app.findRecordById("event_teams", team.id);
  const kinds = host.DOC_KINDS || ["insurance", "roster", "birth_certs", "waiver", "coach_cert", "other"];
  for (const kind of kinds) {
    const files = host.uploaded(e, kind);
    if (files) {
      host.saveTeamDoc(e.app, event, rec, { kind: kind, original_name: kind }, files, e.auth);
    }
  }
  const packet = host.refreshPacketStatus(e.app, event, rec);
  const sb = require(__hooks + "/softball.js");
  const director = sb.isEventAdmin(event, e.auth, e.app) && (body.as_director === true || body.as_director === "true" || body.as_director === "director");
  if (!packet.complete && packet.required.length && !director) {
    throw new BadRequestError("Upload the required team documents: " + packet.required_labels.join(", "));
  }
  const out = host.teamJson(rec);
    out.packet = host.packetSummary(e.app, event, rec, host.canSeeTeamPacket(event, rec, e.auth, e.app));
    if (team.mail) out.mail = team.mail;
    if (team.contact && host.canSeeTeamPacket(event, rec, e.auth, e.app)) out.contact = team.contact;
  return e.json(200, { team: out, event: event.get("slug") });
});

routerAdd("POST", "/api/events/{slug}/teams/{id}", (e) => {
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  const team = e.app.findRecordById("event_teams", e.request.pathValue("id"));
  if (team.get("event") !== event.id) throw new BadRequestError("Team is not on this tournament");
  if (!e.auth) throw new UnauthorizedError("login required");
  const row = host.updateEventTeam(e.app, event, team, e.requestInfo().body || {}, e.auth);
  return e.json(200, { team: row });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/teams/{id}/remove", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const team = e.app.findRecordById("event_teams", e.request.pathValue("id"));
  if (team.get("event") !== event.id) throw new BadRequestError("Team is not on this tournament");
  return e.json(200, host.removeEventTeam(e.app, event, team, e.auth));
}, $apis.requireAuth());

routerAdd("DELETE", "/api/events/{slug}/teams/{id}", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const team = e.app.findRecordById("event_teams", e.request.pathValue("id"));
  if (team.get("event") !== event.id) throw new BadRequestError("Team is not on this tournament");
  return e.json(200, host.removeEventTeam(e.app, event, team, e.auth));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/import-teams/preview", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  try {
    return e.json(200, require(__hooks + "/import_teams.js").preview(e.app, event, body, e.auth));
  } catch (err) {
    throw new BadRequestError(String(err && err.message ? err.message : err));
  }
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/import-bracket/preview", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  try {
    return e.json(200, require(__hooks + "/import_bracket.js").preview(e.app, event, body, e.auth));
  } catch (err) {
    throw new BadRequestError(String(err && err.message ? err.message : err));
  }
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/import-bracket", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  try {
    return e.json(200, require(__hooks + "/import_bracket.js").commit(e.app, event, body, e.auth));
  } catch (err) {
    throw new BadRequestError(String(err && err.message ? err.message : err));
  }
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/import-teams", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  try {
    return e.json(200, require(__hooks + "/import_teams.js").commit(e.app, event, body, e.auth));
  } catch (err) {
    throw new BadRequestError(String(err && err.message ? err.message : err));
  }
}, $apis.requireAuth());

routerAdd("GET", "/api/admin/season-teams/{slug}/contact", (e) => {
  const contacts = require(__hooks + "/contacts.js");
  if (!e.auth) throw new UnauthorizedError("login required");
  const team = e.app.findFirstRecordByData("teams", "slug", e.request.pathValue("slug"));
  if (!contacts.canSeeSeasonContact(team, e.auth)) {
    throw new ForbiddenError("Only that team's coach or a site admin can read this contact.");
  }
  return e.json(200, { contact: contacts.contactJson(contacts.findForSeasonTeam(e.app, team.id)), age_group: team.get("age_group") || "" });
}, $apis.requireAuth());

routerAdd("POST", "/api/admin/season-teams/{slug}/contact", (e) => {
  const sb = require(__hooks + "/softball.js");
  const contacts = require(__hooks + "/contacts.js");
  if (!e.auth) throw new UnauthorizedError("login required");
  const team = e.app.findFirstRecordByData("teams", "slug", e.request.pathValue("slug"));
  if (!contacts.canSeeSeasonContact(team, e.auth)) {
    throw new ForbiddenError("Only that team's coach or a site admin can edit this contact.");
  }
  const body = e.requestInfo().body || {};
  const rec = contacts.upsertForSeasonTeam(e.app, team, body);
  if (sb.isSiteAdmin(e.auth) && body.age_group) {
    const allowed = { "6U": 1, "8U": 1, "10U": 1, "12U": 1, "14U": 1, "16U": 1, "18U": 1 };
    const age = String(body.age_group || "").toUpperCase();
    if (allowed[age]) {
      team.set("age_group", age);
      e.app.save(team);
    }
  }
  return e.json(200, { contact: contacts.contactJson(rec), age_group: team.get("age_group") || "" });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/docs", (e) => {
  const host = require(__hooks + "/host.js");
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  const body = e.requestInfo().body || {};
  const team = e.app.findRecordById("event_teams", body.team_id || body.event_team);
  const self = !!(e.auth && team && (
    (team.get("account") && team.get("account") === e.auth.id)
    || (team.get("contact_email") && team.get("contact_email") === e.auth.email())
  ));
  if (!event.get("signup_open") && !sb.isEventAdmin(event, e.auth, e.app) && !self) {
    throw new BadRequestError("Signup is closed. Ask the director to take a replacement file.");
  }
  const files = host.uploaded(e, "file") || host.uploaded(e, body.kind);
  const doc = host.saveTeamDoc(e.app, event, team, body, files, e.auth);
  return e.json(200, {
    doc: doc,
    packet: host.packetSummary(e.app, event, team, host.canSeeTeamPacket(event, team, e.auth, e.app)),
  });
});

routerAdd("POST", "/api/events/{slug}/docs/{id}/review", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const doc = e.app.findRecordById("team_docs", e.request.pathValue("id"));
  return e.json(200, { doc: host.reviewDoc(e.app, event, doc, e.requestInfo().body || {}) });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/sync", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const results = host.syncEvent(e.app, event);
  return e.json(200, { event: event.get("slug"), results: results });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/settings", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const updated = host.applySettings(e.app, event, e.requestInfo().body || {}, e.auth);
  const rules = host.uploaded(e, "rules_file");
  if (rules) {
    const rec = e.app.findRecordById("events", event.id);
    rec.set("rules_file", rules);
    e.app.save(rec);
    return e.json(200, { event: host.eventJson(rec, e.app, e.auth, { owners: true }) });
  }
  return e.json(200, { event: updated });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/co-owners", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  const row = sb.addCoOwner(e.app, event, body.email, e.auth);
  return e.json(200, { co_owner: row, event: host.eventJson(event, e.app, e.auth, { owners: true }) });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/co-owners/remove", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  const out = sb.removeCoOwner(e.app, event, body.email, e.auth);
  return e.json(200, { removed: out.removed, event: host.eventJson(event, e.app, e.auth, { owners: true }) });
}, $apis.requireAuth());

routerAdd("GET", "/api/events/{slug}/roster", (e) => {
  const host = require(__hooks + "/host.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (!event.get("public") && !e.auth) throw new ForbiddenError("event is not public");
  return e.json(200, {
    event: host.eventJson(event, e.app),
    teams: host.publicRoster(e.app, event, e.auth),
  });
});

routerAdd("GET", "/api/event/{slug}/board", (e) => {
  const diamond = require(__hooks + "/diamond.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (!event.get("public") && !e.auth) throw new ForbiddenError("event is not public");
  return e.json(200, diamond.publicBoard(e.app, event, e.auth));
});

routerAdd("GET", "/api/events/{slug}/plan", (e) => {
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (!event.get("public") && !e.auth) throw new ForbiddenError("event is not public");
  return e.json(200, schedule.plan(e.app, event, e.auth));
});

routerAdd("POST", "/api/events/{slug}/fields", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  const saved = body.name
    ? [schedule.saveField(e.app, event, body)]
    : schedule.saveEventFields(e.app, event, body);
  return e.json(200, { fields: saved.length ? saved : schedule.eventFields(e.app, event.id) });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/schedule/import", (e) => {
  const sb = require(__hooks + "/softball.js");
  const diamond = require(__hooks + "/diamond.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  if (!body.csv) throw new BadRequestError("csv required");
  const result = diamond.importIntoEvent(e.app, event, body.csv, body.replace);
  return e.json(200, { event: event.get("slug"), imported: result.imported, standings: result.standings, created: false });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/schedule/auto", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.autoSchedule(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/schedule/game", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, { game: schedule.addGame(e.app, event, e.requestInfo().body || {}) });
}, $apis.requireAuth());

routerAdd("GET", "/api/events/{slug}/schedule/{id}", (e) => {
  const score = require(__hooks + "/score.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (!event.get("public") && !e.auth) throw new ForbiddenError("event is not public");
  return e.json(200, score.gameDetail(e.app, event, e.request.pathValue("id"), e.auth));
});

routerAdd("POST", "/api/events/{slug}/schedule/{id}/score", (e) => {
  const score = require(__hooks + "/score.js");
  if (!e.auth) throw new UnauthorizedError("login required");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  const game = score.postScore(e.app, event, e.request.pathValue("id"), e.requestInfo().body || {}, e.auth);
  return e.json(200, { game: game });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/schedule/{id}/box", (e) => {
  const host = require(__hooks + "/host.js");
  const score = require(__hooks + "/score.js");
  if (!e.auth) throw new UnauthorizedError("login required");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  const body = e.requestInfo().body || {};
  const files = host.uploaded(e, "file") || host.uploaded(e, "box");
  return e.json(200, { box: score.saveBox(e.app, event, e.request.pathValue("id"), body, files, e.auth) });
}, $apis.requireAuth());

routerAdd("GET", "/api/events/{slug}/boxes", (e) => {
  const sb = require(__hooks + "/softball.js");
  const score = require(__hooks + "/score.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdminOrBot(e, event);
  return e.json(200, { boxes: score.listPendingBoxes(e.app, event.id) });
}, $apis.requireAuth());

routerAdd("GET", "/api/bot/event-boxes", (e) => {
  const sb = require(__hooks + "/softball.js");
  const score = require(__hooks + "/score.js");
  const auth = sb.requireRole(e, ["bot", "region_admin", "event_td"]);
  const q = (e.requestInfo().query || {}).event || "";
  let eventId = "";
  if (q) {
    const event = e.app.findFirstRecordByData("events", "slug", q);
    sb.requireEventAdminOrBot(e, event);
    eventId = event.id;
  } else if (!(sb.isSiteAdmin(auth) || auth.get("role") === "bot")) {
    throw new ForbiddenError("Only a bot or site admin can list every event's inbox.");
  }
  return e.json(200, { boxes: score.listPendingBoxes(e.app, eventId) });
}, $apis.requireAuth());

routerAdd("GET", "/api/bot/gc-monitor", (e) => {
  const sb = require(__hooks + "/softball.js");
  const monitor = require(__hooks + "/gc_monitor.js");
  sb.requireRole(e, ["bot", "region_admin"]);
  return e.json(200, monitor.listGcMonitor(e.app));
}, $apis.requireAuth());

routerAdd("POST", "/api/bot/event-box", (e) => {
  const sb = require(__hooks + "/softball.js");
  const score = require(__hooks + "/score.js");
  const auth = sb.requireRole(e, ["bot", "region_admin", "event_td"]);
  const body = e.requestInfo().body || {};
  const event = e.app.findFirstRecordByData("events", "slug", body.event_slug || body.slug);
  sb.requireEventAdminOrBot(e, event);
  return e.json(200, score.botApply(e.app, body, auth));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/schedule/{id}/delete", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.deleteGame(e.app, event, e.request.pathValue("id")));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/{id}/score", (e) => {
  const score = require(__hooks + "/score.js");
  if (!e.auth) throw new UnauthorizedError("login required");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  return e.json(200, score.postBracketScore(e.app, event, e.request.pathValue("id"), e.requestInfo().body || {}, e.auth));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/schedule/{id}", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, { game: schedule.updateGame(e.app, event, e.request.pathValue("id"), e.requestInfo().body || {}) });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/rain", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.rainUpdate(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/photos", (e) => {
  const sb = require(__hooks + "/softball.js");
  const host = require(__hooks + "/host.js");
  const photos = require(__hooks + "/photos.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const files = host.uploaded(e, "image") || host.uploaded(e, "file") || host.uploaded(e, "photo");
  return e.json(200, { photo: photos.savePhoto(e.app, event, e.requestInfo().body || {}, files, e.auth) });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/photos/{id}/publish", (e) => {
  const sb = require(__hooks + "/softball.js");
  const photos = require(__hooks + "/photos.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  return e.json(200, { photo: photos.publishPhoto(e.app, event, e.request.pathValue("id"), body.public) });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/photos/reorder", (e) => {
  const sb = require(__hooks + "/softball.js");
  const photos = require(__hooks + "/photos.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  return e.json(200, { photos: photos.reorderPhotos(e.app, event, body.ids || body.order) });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/swap", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.swapBracketSeats(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/reorder", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.saveBracketDesk(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/build", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  const prefs = schedule.saveScheduler(e.app, event, body);
  if (body.format) {
    event.set("format", body.format);
    e.app.save(event);
  }
  return e.json(200, schedule.buildBracket(e.app, event, {
    consolation: body.consolation === true || body.consolation === "true" || body.consolation === "on",
    replace: body.replace !== false,
    empty: body.empty || body.draw_empty,
    confirm: body.confirm,
    format: body.format || event.get("format"),
    bracket_flights: body.bracket_flights != null ? body.bracket_flights : event.get("bracket_flights"),
  }));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/preview", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  body.preview = true;
  return e.json(200, schedule.buildBracket(e.app, event, body));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/clear", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.clearBracket(e.app, event));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/schedule/clear", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.clearSchedule(e.app, event));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/custom", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, schedule.saveCustomBracket(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/bracket/{id}", (e) => {
  const sb = require(__hooks + "/softball.js");
  const schedule = require(__hooks + "/schedule.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  schedule.editBracketGame(e.app, event, e.request.pathValue("id"), e.requestInfo().body || {});
  const diamond = require(__hooks + "/diamond.js");
  return e.json(200, { ok: true, bracket: diamond.publicBoard(e.app, event, e.auth).bracket });
}, $apis.requireAuth());

routerAdd("POST", "/api/events/import-popup", (e) => {
  const sb = require(__hooks + "/softball.js");
  const keystone = require(__hooks + "/keystone.js");
  sb.requireRole(e, ["region_admin", "event_td"]);
  const body = e.requestInfo().body || {};
  const url = body.url || keystone.DEFAULT_POPUP;
  if (url && !keystone.isKeystonePopupUrl(url) && url !== keystone.DEFAULT_POPUP && url !== keystone.DEFAULT_POPUP + "/") {
    throw new BadRequestError("Only the public Keystone Clash popup can be imported.");
  }
  let existing;
  try { existing = e.app.findFirstRecordByData("events", "slug", "keystone-clash-2026"); }
  catch (err) { existing = null; }
  if (existing) sb.requireEventAdmin(e, existing);
  const result = keystone.importPopup(e.app, url || keystone.DEFAULT_POPUP);
  return e.json(200, result);
}, $apis.requireAuth());

routerAdd("POST", "/api/event/import-schedule", (e) => {
  const sb = require(__hooks + "/softball.js");
  const diamond = require(__hooks + "/diamond.js");
  const host = require(__hooks + "/host.js");
  sb.requireRole(e, ["region_admin", "event_td"]);
  const body = e.requestInfo().body || {};
  if (!body.csv) throw new BadRequestError("csv required");
  const into = String(body.into || body.event_slug || body.slug || "").trim();
  let event = null;
  if (into) {
    try { event = e.app.findFirstRecordByData("events", "slug", into); } catch (err) { event = null; }
  }
  if (event) {
    sb.requireEventAdmin(e, event);
    const result = diamond.importIntoEvent(e.app, event, body.csv, body.replace);
    return e.json(200, { event: event.get("slug"), imported: result.imported, standings: result.standings, created: false });
  }
  if (!diamond.wantsCreateEvent(body)) {
    throw new BadRequestError("This tournament does not exist. Import from that weekend's Admin, or type a new name and choose Create a new tournament.");
  }
  const name = String(body.event_name || "").trim();
  if (!name || diamond.isPlaceholderWeekend(body)) {
    throw new BadRequestError("Name this weekend to create it. The sample Clipboard Open name is not used.");
  }
  const slug = host.uniqueSlug(e.app, host.slugify(body.event_slug || name));
  event = new Record(e.app.findCollectionByNameOrId("events"));
  event.set("name", name);
  event.set("slug", slug);
  event.set("public", true);
  event.set("status", "live");
  event.set("format", "pool-to-bracket");
  event.set("source", "native");
  event.set("signup_open", true);
  event.set("auto_sync", true);
  event.set("venue", body.venue || "");
  event.set("ages", body.ages || "10U");
  event.set("pitch_limit_ip", Number(body.pitch_limit_ip || 0));
  event.set("pitch_limit_mode", body.pitch_limit_mode || "none");
  if (e.auth) event.set("created_by", e.auth.id);
  e.app.save(event);
  const result = diamond.importIntoEvent(e.app, event, body.csv, body.replace);
  return e.json(200, { event: event.get("slug"), imported: result.imported, standings: result.standings, created: true });
}, $apis.requireAuth());

routerAdd("POST", "/api/bot/event-update", (e) => {
  const sb = require(__hooks + "/softball.js");
  const score = require(__hooks + "/score.js");
  sb.requireRole(e, ["bot", "region_admin", "event_td"]);
  const body = e.requestInfo().body || {};
  const event = e.app.findFirstRecordByData("events", "slug", body.event_slug);
  sb.requireEventAdminOrBot(e, event);
  if (body.schedule_id) {
    const row = e.app.findRecordById("event_schedule", body.schedule_id);
    if (row.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
    if (body.home_runs != null) row.set("home_runs", body.home_runs);
    if (body.away_runs != null) row.set("away_runs", body.away_runs);
    if (body.status) row.set("status", body.status);
    if (e.auth) {
      try {
        require(__hooks + "/score.js").setUserRel(e.app, row, "scored_by", e.auth);
      } catch (err) {}
    }
    e.app.save(row);
    if (body.box) score.attachUpdateBox(e.app, event, row, body, e.auth);
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

// Reachability ping for linked GC / Tourney Machine pages. Live score and box
// numbers come from Grok bots polling GET /api/bot/gc-monitor (~5 min when live).
routerAdd("GET", "/api/box/{token}", (e) => {
  const boxmail = require(__hooks + "/boxmail.js");
  const rec = boxmail.findByToken(e.app, e.request.pathValue("token"));
  return e.json(200, boxmail.publicInvite(e.app, rec));
});

routerAdd("POST", "/api/box/{token}", (e) => {
  const host = require(__hooks + "/host.js");
  const boxmail = require(__hooks + "/boxmail.js");
  const files = host.uploaded(e, "file") || host.uploaded(e, "box");
  return e.json(200, boxmail.submitToken(e.app, e.request.pathValue("token"), e.requestInfo().body || {}, files));
});

routerAdd("POST", "/api/box/{token}/unsubscribe", (e) => {
  const boxmail = require(__hooks + "/boxmail.js");
  return e.json(200, boxmail.unsubscribeToken(e.app, e.request.pathValue("token")));
});

routerAdd("GET", "/api/event/{slug}/team/{team}", (e) => {
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (!event.get("public") && !e.auth) throw new ForbiddenError("event is not public");
  const page = require(__hooks + "/teampage.js");
  return e.json(200, page.publicTeam(e.app, event, e.request.pathValue("team"), e.auth));
});

routerAdd("GET", "/api/events/{slug}/assist", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const q = e.requestInfo().query || {};
  return e.json(200, require(__hooks + "/assist.js").answer(e.app, event, q));
}, $apis.requireAuth());

routerAdd("GET", "/api/events/{slug}/boxes/desk", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, require(__hooks + "/boxmail.js").directorDesk(e.app, event));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/boxes/run", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  const body = e.requestInfo().body || {};
  return e.json(200, require(__hooks + "/boxmail.js").runBoxMail(e.app, { event: event, now: body.now }));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/boxes/resend", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, require(__hooks + "/boxmail.js").resendOne(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/boxes/resolve", (e) => {
  const sb = require(__hooks + "/softball.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  sb.requireEventAdmin(e, event);
  return e.json(200, require(__hooks + "/boxmail.js").resolveConflict(e.app, event, e.requestInfo().body || {}));
}, $apis.requireAuth());

routerAdd("POST", "/api/events/{slug}/boxes/{id}/review", (e) => {
  const sb = require(__hooks + "/softball.js");
  const score = require(__hooks + "/score.js");
  const event = e.app.findFirstRecordByData("events", "slug", e.request.pathValue("slug"));
  if (e.auth && e.auth.get("role") === "bot") {
    throw new ForbiddenError("bot cannot approve or reject event boxes");
  }
  sb.requireEventAdmin(e, event);
  return e.json(200, score.reviewBox(e.app, event, e.request.pathValue("id"), e.requestInfo().body || {}, e.auth));
}, $apis.requireAuth());

cronAdd("box-score-ask", "*/15 * * * *", () => {
  try { require(__hooks + "/boxmail.js").runBoxMail($app); } catch (err) {}
});

cronAdd("hosted-gc-tm-sync", "15 */2 * * *", () => {
  const host = require(__hooks + "/host.js");
  const events = $app.findRecordsByFilter("events", "auto_sync = true && status = 'live'", "", 80, 0);
  for (const ev of events) {
    try { host.syncEvent($app, ev); } catch (err) {}
  }
});

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const role = e.record.get("role");
  if (role === "region_admin" || role === "bot" || !role) e.record.set("role", "event_td");
  e.next();
}, "users");

onRecordCreateRequest((e) => {
  if (!e.record.get("created_by") && e.auth) e.record.set("created_by", e.auth.id);
  e.next();
}, "events");

onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) e.record.set("public", false);
  e.next();
}, "venue_photos");

onRecordAfterCreateSuccess((e) => {
  try { require(__hooks + "/photos.js").stripSavedImage(e.app, e.record); } catch (err) {}
  if (e.next) e.next();
}, "venue_photos");

onRecordUpdateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();
  const auth = e.auth;
  if (auth && auth.get("role") === "bot") {
    throw new ForbiddenError("bot cannot update staging (cannot approve its own work)");
  }
  e.next();
}, "staging_games");
