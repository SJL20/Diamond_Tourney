function slugify(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
}

function parseHost(url) {
  const m = String(url || "").match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].replace(/^www\./i, "").toLowerCase() : "";
}

function uniqueSlug(app, base) {
  let slug = base;
  let n = 2;
  while (true) {
    try {
      app.findFirstRecordByData("events", "slug", slug);
      slug = base + "-" + n;
      n++;
    } catch (err) {
      return slug;
    }
  }
}

function parseTmId(url) {
  const m = String(url || "").match(/IDTournament=([a-zA-Z0-9]+)/i);
  return m ? m[1] : "";
}

function isGameChangerUrl(url) {
  const host = parseHost(url);
  return host === "gc.com" || host === "web.gc.com" || host === "gamechanger.io";
}

function gcRef(url) {
  const m = String(url || "").match(/^https?:\/\/([^?#]+)/i);
  return m ? m[1].replace(/\/+$/, "") : "";
}

function isTourneyMachineUrl(url) {
  return parseHost(url) === "tourneymachine.com";
}

function eventJson(rec) {
  return {
    id: rec.id,
    name: rec.get("name"),
    slug: rec.get("slug"),
    venue: rec.get("venue") || "",
    ages: rec.get("ages") || "",
    status: rec.get("status") || "",
    source: rec.get("source") || "native",
    tm_url: rec.get("tm_url") || "",
    tm_id: rec.get("tm_id") || "",
    signup_open: !!rec.get("signup_open"),
    auto_sync: !!rec.get("auto_sync"),
    pitch_limit_ip: rec.get("pitch_limit_ip") || 6,
    public: !!rec.get("public"),
    created_by: rec.get("created_by") || "",
  };
}

function teamJson(rec) {
  return {
    id: rec.id,
    name: rec.get("name"),
    slug: rec.get("slug"),
    club: rec.get("club") || "",
    pool: rec.get("pool") || "",
    gamechanger_url: rec.get("gamechanger_url") || "",
    gc_linked: isGameChangerUrl(rec.get("gamechanger_url")),
    gc_sync_status: rec.get("gc_sync_status") || (rec.get("gamechanger_url") ? "linked" : "unlinked"),
    signed_up_by: rec.get("signed_up_by") || "",
    gc_last_error: rec.get("gc_last_error") || "",
  };
}

function stripTags(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function fetchPublicPage(url) {
  const res = $http.send({
    url: url,
    method: "GET",
    headers: { "User-Agent": "DiamondTourney/1.0 (tournament host; public page)" },
    timeout: 12,
  });
  return res;
}

function titleFromHtml(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i);
  if (og) return og[1].trim();
  const t = html.match(/<title[^>]*>([^<]+)/i);
  if (t) return t[1].replace(/\s*\|\s*SportsEngine.*$/i, "").trim();
  return "";
}

function importTourneyMachine(app, url) {
  if (!isTourneyMachineUrl(url)) {
    throw new BadRequestError("Link a tourneymachine.com public tournament URL");
  }
  const tmId = parseTmId(url);
  let name = "";
  let note = "";
  let ok = false;
  try {
    const res = fetchPublicPage(url);
    if (res.statusCode >= 200 && res.statusCode < 400 && res.body) {
      const html = String(res.body);
      name = titleFromHtml(html);
      ok = true;
      note = "Linked public Tourney Machine page. Schedule refresh runs on the host.";
    } else {
      note = "Tourney Machine returned " + res.statusCode + ". Event created; refresh later.";
    }
  } catch (err) {
    note = "Could not fetch Tourney Machine right now. Event created with the link saved.";
  }
  return { tmId: tmId, name: name, note: note, ok: ok };
}

function writeLog(app, eventId, kind, ok, detail) {
  const rec = new Record(app.findCollectionByNameOrId("sync_log"));
  rec.set("event", eventId);
  rec.set("kind", kind);
  rec.set("ok", !!ok);
  rec.set("detail", String(detail || "").slice(0, 2000));
  app.save(rec);
}

function upsertEventTeam(app, event, data) {
  const slug = slugify(data.name);
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
  rec.set("name", data.name);
  if (data.pool) rec.set("pool", data.pool);
  rec.set("gamechanger_url", data.gamechanger_url || "");
  rec.set("gc_team_ref", gcRef(data.gamechanger_url));
  rec.set("contact_name", data.contact_name || "");
  rec.set("contact_email", data.contact_email || "");
  rec.set("signed_up_by", data.signed_up_by || "team");
  rec.set("gc_sync_status", isGameChangerUrl(data.gamechanger_url) ? "linked" : "unlinked");
  if (data.account) rec.set("account", data.account);
  try {
    const year = require(__hooks + "/year.js");
    const club = year.upsertClub(app, {
      name: data.name,
      gamechanger_url: data.gamechanger_url,
    });
    if (club) rec.set("club", club.id);
  } catch (err) {}
  app.save(rec);
  return rec;
}

function createEvent(app, body, auth) {
  const source = body.source === "tourneymachine" ? "tourneymachine" : "native";
  let name = (body.name || "").trim();
  let tm = { tmId: "", note: "", ok: false };
  if (source === "tourneymachine") {
    tm = importTourneyMachine(app, body.tm_url);
    if (!name) name = tm.name || "Tourney Machine event";
  }
  if (!name) throw new BadRequestError("Tournament name is required");
  const slug = uniqueSlug(app, slugify(body.slug || name));
  const rec = new Record(app.findCollectionByNameOrId("events"));
  rec.set("name", name);
  rec.set("slug", slug);
  rec.set("venue", body.venue || "");
  rec.set("ages", body.ages || "10U");
  rec.set("public", true);
  rec.set("status", "live");
  rec.set("format", body.format || "imported");
  rec.set("source", source);
  rec.set("signup_open", body.signup_open !== false);
  rec.set("auto_sync", true);
  rec.set("pitch_limit_ip", Number(body.pitch_limit_ip || 6));
  if (body.start) rec.set("start", body.start);
  if (body.end) rec.set("end", body.end);
  if (source === "tourneymachine") {
    rec.set("tm_url", body.tm_url);
    rec.set("tm_id", tm.tmId);
  }
  if (auth) rec.set("created_by", auth.id);
  app.save(rec);
  writeLog(app, rec.id, "event", true, source === "tourneymachine" ? tm.note : "Native tournament opened");
  return { event: eventJson(rec), note: tm.note || "Tournament is live. Teams can join with or without GameChanger." };
}

function signupTeam(app, event, body, auth) {
  if (!event.get("signup_open")) throw new BadRequestError("Signup is closed for this event");
  const name = (body.team_name || body.name || "").trim();
  if (!name) throw new BadRequestError("Team name is required");
  const gcUrl = (body.gamechanger_url || "").trim();
  if (gcUrl && !isGameChangerUrl(gcUrl)) {
    throw new BadRequestError("If you link a stats page, it must be a GameChanger URL (gc.com or web.gc.com).");
  }
  const director = auth && (auth.get("role") === "event_td" || auth.get("role") === "region_admin");
  const team = upsertEventTeam(app, event, {
    name: name,
    pool: body.pool || "",
    gamechanger_url: gcUrl,
    contact_name: body.contact_name || (auth ? auth.email() : ""),
    contact_email: body.contact_email || (auth ? auth.email() : ""),
    signed_up_by: director && (body.as_director === true || body.as_director === "true" || body.as_director === "director") ? "director" : "team",
    account: auth ? auth.id : "",
  });
  return teamJson(team);
}

function registerAccount(app, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.display_name || body.name || "").trim();
  if (!email || password.length < 8) {
    throw new BadRequestError("Email and a password of at least 8 characters are required");
  }
  const intent = body.intent === "team" ? "team_coach" : "event_td";
  const rec = new Record(app.findCollectionByNameOrId("users"));
  rec.set("email", email);
  rec.set("password", password);
  rec.set("passwordConfirm", password);
  rec.set("role", intent);
  rec.set("display_name", name);
  rec.set("verified", true);
  app.save(rec);
  return { id: rec.id, email: rec.email(), role: rec.get("role"), display_name: rec.get("display_name") || "" };
}

function searchEvents(app, q) {
  const rows = app.findRecordsByFilter("events", "public = true", "-start", 80, 0);
  const needle = String(q || "").trim().toLowerCase();
  return rows.map(eventJson).filter(function (ev) {
    if (!needle) return true;
    return (ev.name + " " + ev.venue + " " + ev.ages + " " + ev.slug).toLowerCase().indexOf(needle) !== -1;
  });
}

function accountHome(app, auth) {
  let created = [];
  try {
    created = app.findRecordsByFilter("events", "created_by = {:u}", "-id", 80, 0, { u: auth.id }).map(eventJson);
  } catch (err) {}
  const joined = [];
  const seen = {};
  try {
    const teams = app.findRecordsByFilter(
      "event_teams",
      "account = {:u} || contact_email = {:e}",
      "name",
      80,
      0,
      { u: auth.id, e: auth.email() },
    );
    for (const t of teams) {
      const evId = t.get("event");
      if (!evId || seen[evId]) continue;
      seen[evId] = true;
      try {
        const row = eventJson(app.findRecordById("events", evId));
        row.team_name = t.get("name");
        row.gc_linked = isGameChangerUrl(t.get("gamechanger_url"));
        joined.push(row);
      } catch (err) {}
    }
  } catch (err) {}
  return {
    user: {
      id: auth.id,
      email: auth.email(),
      role: auth.get("role"),
      display_name: auth.get("display_name") || "",
    },
    created: created,
    joined: joined,
  };
}

function syncGameChangerTeam(app, team) {
  const url = team.get("gamechanger_url");
  if (!isGameChangerUrl(url)) {
    team.set("gc_sync_status", "unlinked");
    team.set("gc_last_error", "Missing GameChanger URL");
    app.save(team);
    return { ok: false, status: "unlinked" };
  }
  try {
    const res = fetchPublicPage(url);
    team.set("gc_last_sync", new DateTime());
    if (res.statusCode >= 200 && res.statusCode < 400) {
      const html = String(res.body || "");
      const title = titleFromHtml(html);
      team.set("gc_sync_status", "linked");
      team.set("gc_last_error", title ? ("Reached GameChanger: " + title) : "Reached GameChanger. Box JSON sync uses the hosted job when the public page exposes it.");
      app.save(team);
      return { ok: true, status: "linked", title: title };
    }
    team.set("gc_sync_status", "error");
    team.set("gc_last_error", "GameChanger HTTP " + res.statusCode);
    app.save(team);
    return { ok: false, status: "error" };
  } catch (err) {
    team.set("gc_sync_status", "error");
    team.set("gc_last_error", String(err));
    team.set("gc_last_sync", new DateTime());
    app.save(team);
    return { ok: false, status: "error" };
  }
}

function syncEvent(app, event) {
  const results = [];
  if (event.get("source") === "tourneymachine" && event.get("tm_url")) {
    const tm = importTourneyMachine(app, event.get("tm_url"));
    writeLog(app, event.id, "tourneymachine", tm.ok, tm.note);
    results.push({ kind: "tourneymachine", ok: tm.ok, detail: tm.note });
  }
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 200, 0, { e: event.id });
  for (const team of teams) {
    const r = syncGameChangerTeam(app, team);
    results.push({ kind: "gamechanger", team: team.get("name"), ok: r.ok, status: r.status });
  }
  writeLog(app, event.id, "gamechanger", results.every(function (r) { return r.kind !== "gamechanger" || r.ok; }), "Synced " + teams.length + " GameChanger links");
  return results;
}

function publicRoster(app, event) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 200, 0, { e: event.id });
  return teams.map(teamJson);
}

function clubJson(rec) {
  return {
    id: rec.id,
    name: rec.get("name"),
    slug: rec.get("slug"),
    ages: rec.get("ages") || "",
    gamechanger_url: rec.get("gamechanger_url") || "",
    gc_linked: isGameChangerUrl(rec.get("gamechanger_url")),
    gc_team_ref: rec.get("gc_team_ref") || "",
    notes: rec.get("notes") || "",
    contact_email: rec.get("contact_email") || "",
  };
}

function listClubs(app) {
  return app.findRecordsByFilter("club_teams", "", "name", 200, 0).map(clubJson);
}

function saveClub(app, body, id) {
  const name = (body.name || "").trim();
  if (!name && !id) throw new BadRequestError("Team name is required");
  const gcUrl = (body.gamechanger_url || "").trim();
  if (gcUrl && !isGameChangerUrl(gcUrl)) {
    throw new BadRequestError("GameChanger URL must be gc.com or web.gc.com, or leave it blank.");
  }
  const year = require(__hooks + "/year.js");
  let rec;
  if (id) rec = app.findRecordById("club_teams", id);
  else rec = year.upsertClub(app, { name: name, gamechanger_url: gcUrl, ages: body.ages || "" });
  if (name) rec.set("name", name);
  if (body.ages != null) rec.set("ages", body.ages);
  rec.set("gamechanger_url", gcUrl);
  if (gcUrl) rec.set("gc_team_ref", gcRef(gcUrl));
  if (body.notes != null) rec.set("notes", body.notes);
  if (body.contact_email != null) rec.set("contact_email", body.contact_email);
  app.save(rec);
  return clubJson(rec);
}

function applySettings(app, event, body) {
  if (body.signup_open != null) event.set("signup_open", !!body.signup_open);
  if (body.auto_sync != null) event.set("auto_sync", !!body.auto_sync);
  if (body.venue != null) event.set("venue", body.venue);
  if (body.ages != null) event.set("ages", body.ages);
  app.save(event);
  return eventJson(event);
}

module.exports = {
  slugify: slugify,
  isGameChangerUrl: isGameChangerUrl,
  isTourneyMachineUrl: isTourneyMachineUrl,
  eventJson: eventJson,
  teamJson: teamJson,
  createEvent: createEvent,
  signupTeam: signupTeam,
  syncEvent: syncEvent,
  publicRoster: publicRoster,
  applySettings: applySettings,
  registerAccount: registerAccount,
  searchEvents: searchEvents,
  accountHome: accountHome,
  listClubs: listClubs,
  saveClub: saveClub,
};
