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

function isGcBoxUrl(url) {
  if (!isGameChangerUrl(url)) return false;
  return /\/box-score\/?(\?|#|$)|\/schedule\/[a-zA-Z0-9-]+/i.test(String(url || ""));
}

function gcRef(url) {
  const m = String(url || "").match(/^https?:\/\/([^?#]+)/i);
  return m ? m[1].replace(/\/+$/, "") : "";
}

function isTourneyMachineUrl(url) {
  return parseHost(url) === "tourneymachine.com";
}

function parsePacket(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (err) { return null; }
  }
  if (typeof raw === "object") {
    if (raw.dates || raw.status || raw.info) return raw;
    if (raw.length !== undefined && typeof raw[0] === "number") {
      try {
        return JSON.parse(require(__hooks + "/softball.js").bytesToString(raw));
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

const DOC_KINDS = ["insurance", "roster", "birth_certs", "waiver", "coach_cert", "other"];
const DOC_LABELS = {
  insurance: "Certificate of insurance",
  roster: "Official roster",
  birth_certs: "Birth certificates / age proof",
  waiver: "Waiver / medical release",
  coach_cert: "Coach certification / background",
  other: "Other document",
};
const BODY_LABELS = {
  usa_softball: "USA Softball",
  usssa: "USSSA",
  pgf: "PGF",
  triple_crown: "Triple Crown",
  rec: "Rec / house",
  other: "Other",
};

function truthy(v) {
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

function requiredDocKinds(event) {
  const out = [];
  if (truthy(event.get("require_insurance"))) out.push("insurance");
  if (truthy(event.get("require_roster"))) out.push("roster");
  if (truthy(event.get("require_birth_certs"))) out.push("birth_certs");
  if (truthy(event.get("require_waiver"))) out.push("waiver");
  if (truthy(event.get("require_coach_cert"))) out.push("coach_cert");
  return out;
}

function isMultipart(e) {
  try {
    const h = e.request.header.get("Content-Type") || "";
    if (String(h).toLowerCase().indexOf("multipart/form-data") !== -1) return true;
  } catch (err) {}
  try {
    const headers = e.requestInfo().headers || {};
    const keys = Object.keys(headers);
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i]).toLowerCase() !== "content-type") continue;
      const v = headers[keys[i]];
      const s = Array.isArray(v) ? v.join(" ") : String(v);
      if (s.toLowerCase().indexOf("multipart/") !== -1) return true;
    }
  } catch (err) {}
  return false;
}

function uploaded(e, field) {
  if (!isMultipart(e)) return null;
  try {
    const files = e.findUploadedFiles(field);
    if (files && files.length) return files;
  } catch (err) {}
  return null;
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

// Packet files are insurance, rosters, waivers, and birth certificates. A birth
// certificate carries a child's birthdate and address, so the download link is
// only ever handed to the director, a region admin, or that team's own signer.
function docJson(app, rec, withFiles) {
  const row = {
    id: rec.id,
    kind: rec.get("kind"),
    label: DOC_LABELS[rec.get("kind")] || rec.get("kind"),
    status: rec.get("status") || "submitted",
  };
  if (withFiles) {
    row.note = rec.get("note") || "";
    row.original_name = rec.get("original_name") || "";
    row.url = fileUrl(app, "team_docs", rec, "file");
  }
  return row;
}

function teamDocs(app, teamId, withFiles) {
  try {
    return app.findRecordsByFilter("team_docs", "event_team = {:t}", "kind", 40, 0, { t: teamId }).map(function (r) {
      return docJson(app, r, withFiles);
    });
  } catch (err) {
    return [];
  }
}

// True only for a region admin, the director who owns this event, or the
// account that signed this team up. `event_td` alone is not enough: account
// registration hands out that role, so it is not a trust boundary.
function canSeeTeamPacket(event, team, auth) {
  if (!auth) return false;
  if (auth.get("role") === "region_admin") return true;
  const creator = event.get("created_by");
  if (creator && creator === auth.id) return true;
  if (team) {
    if (team.get("account") && team.get("account") === auth.id) return true;
    const email = team.get("contact_email");
    if (email && email === auth.email()) return true;
  }
  return false;
}

function packetSummary(app, event, team, withFiles) {
  const required = requiredDocKinds(event);
  const docs = teamDocs(app, team.id, withFiles);
  const have = {};
  for (const d of docs) have[d.kind] = d;
  const missing = required.filter(function (k) { return !have[k]; });
  return {
    required: required,
    required_labels: required.map(function (k) { return DOC_LABELS[k]; }),
    missing: missing,
    docs: docs,
    complete: missing.length === 0,
    status: team.get("packet_status") || (missing.length ? "incomplete" : (required.length ? "submitted" : "submitted")),
    note: team.get("packet_note") || "",
  };
}

function applyGuidelines(rec, body) {
  if (body.governing_body) rec.set("governing_body", body.governing_body);
  if (body.governing_notes != null) rec.set("governing_notes", body.governing_notes);
  if (body.pitch_limit_mode) rec.set("pitch_limit_mode", body.pitch_limit_mode);
  if (body.pitch_limit_ip != null && body.pitch_limit_ip !== "") rec.set("pitch_limit_ip", Number(body.pitch_limit_ip));
  if (body.pitch_limit_pitches != null && body.pitch_limit_pitches !== "") rec.set("pitch_limit_pitches", Number(body.pitch_limit_pitches));
  if (body.pitch_limit_notes != null) rec.set("pitch_limit_notes", body.pitch_limit_notes);
  if (body.game_length_minutes != null && body.game_length_minutes !== "") rec.set("game_length_minutes", Number(body.game_length_minutes));
  if (body.innings_cap != null && body.innings_cap !== "") rec.set("innings_cap", Number(body.innings_cap));
  if (body.mercy_rule != null) rec.set("mercy_rule", body.mercy_rule);
  if (body.umpire_count != null && body.umpire_count !== "") rec.set("umpire_count", Number(body.umpire_count));
  if (body.rules_notes != null) rec.set("rules_notes", body.rules_notes);
  if (body.packet_notes != null) rec.set("packet_notes", body.packet_notes);
  if (body.require_insurance != null) rec.set("require_insurance", truthy(body.require_insurance));
  if (body.require_roster != null) rec.set("require_roster", truthy(body.require_roster));
  if (body.require_birth_certs != null) rec.set("require_birth_certs", truthy(body.require_birth_certs));
  if (body.require_waiver != null) rec.set("require_waiver", truthy(body.require_waiver));
  if (body.require_coach_cert != null) rec.set("require_coach_cert", truthy(body.require_coach_cert));
}

function dateStr(v) {
  if (!v) return "";
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function eventMapUrl(rec) {
  const lat = rec.get("lat");
  const lng = rec.get("lng");
  const address = rec.get("address") || rec.get("venue") || "";
  if (lat && lng) return "https://maps.google.com/?q=" + lat + "," + lng;
  if (address) return "https://maps.google.com/?q=" + encodeURIComponent(address);
  return "";
}

const FORMAT_LABELS = {
  "pool-to-bracket": "Pool play, then single-elim bracket",
  "pool-only": "Pool play only",
  "single-elim": "Single elimination",
  "double-elim": "Double elimination",
  imported: "Imported / already drawn",
};

function eventJson(rec, app) {
  const packet = parsePacket(rec.get("packet"));
  const mode = rec.get("pitch_limit_mode") || "ip";
  const format = rec.get("format") || "";
  let fields = [];
  if (app) {
    try { fields = require(__hooks + "/schedule.js").eventFields(app, rec.id); } catch (err) {}
  }
  return {
    id: rec.id,
    name: rec.get("name"),
    slug: rec.get("slug"),
    venue: rec.get("venue") || "",
    address: rec.get("address") || "",
    lat: rec.get("lat") || 0,
    lng: rec.get("lng") || 0,
    map_url: eventMapUrl(rec),
    rain_status: rec.get("rain_status") || "clear",
    rain_note: rec.get("rain_note") || "",
    format: format,
    format_label: FORMAT_LABELS[format] || format,
    start: dateStr(rec.get("start")),
    end: dateStr(rec.get("end")),
    hours_start: rec.get("hours_start") || "08:00",
    hours_end: rec.get("hours_end") || "18:00",
    scheduler: (function () {
      try { return require(__hooks + "/schedule.js").parseScheduler(rec.get("scheduler")); }
      catch (err) { return { games_per_team: 2, consolation: true, replace: true, draw_bracket: false, days: [] }; }
    })(),
    fields: fields,
    ages: rec.get("ages") || "",
    status: rec.get("status") || "",
    source: rec.get("source") || "native",
    tm_url: rec.get("tm_url") || "",
    tm_id: rec.get("tm_id") || "",
    source_url: rec.get("source_url") || "",
    signup_open: !!rec.get("signup_open"),
    auto_sync: !!rec.get("auto_sync"),
    pitch_limit_ip: rec.get("pitch_limit_ip") || 6,
    pitch_limit_mode: mode,
    pitch_limit_pitches: rec.get("pitch_limit_pitches") || 0,
    pitch_limit_notes: rec.get("pitch_limit_notes") || "",
    governing_body: rec.get("governing_body") || "",
    governing_label: BODY_LABELS[rec.get("governing_body")] || rec.get("governing_body") || "",
    governing_notes: rec.get("governing_notes") || "",
    game_length_minutes: rec.get("game_length_minutes") || 0,
    innings_cap: rec.get("innings_cap") || 0,
    mercy_rule: rec.get("mercy_rule") || "",
    umpire_count: rec.get("umpire_count") || 0,
    rules_notes: rec.get("rules_notes") || "",
    rules_file_url: app ? fileUrl(app, "events", rec, "rules_file") : "",
    require_insurance: !!rec.get("require_insurance"),
    require_roster: !!rec.get("require_roster"),
    require_birth_certs: !!rec.get("require_birth_certs"),
    require_waiver: !!rec.get("require_waiver"),
    require_coach_cert: !!rec.get("require_coach_cert"),
    required_docs: requiredDocKinds(rec),
    required_doc_labels: requiredDocKinds(rec).map(function (k) { return DOC_LABELS[k]; }),
    packet_notes: rec.get("packet_notes") || "",
    public: !!rec.get("public"),
    created_by: rec.get("created_by") || "",
    contact: rec.get("contact") || "",
    status_note: rec.get("status_note") || "",
    dates: packet ? packet.dates : "",
    packet: packet,
    tiebreak: (function () {
      try {
        const diamond = require(__hooks + "/diamond.js");
        const order = diamond.parseTiebreak(rec.get("tiebreak"));
        return { order: order, label: diamond.tiebreakLabel(order) };
      } catch (err) {
        return { order: ["record", "h2h", "ra", "diff", "rs"], label: "record (tie = half), then head-to-head, then fewest runs allowed, then run differential, then most runs scored" };
      }
    })(),
  };
}

function teamJson(rec) {
  return {
    id: rec.id,
    name: rec.get("name"),
    slug: rec.get("slug"),
    club: rec.get("club") || "",
    pool: rec.get("pool") || "",
    seed: rec.get("seed") || 0,
    gamechanger_url: rec.get("gamechanger_url") || "",
    gc_linked: isGameChangerUrl(rec.get("gamechanger_url")),
    gc_sync_status: rec.get("gc_sync_status") || (rec.get("gamechanger_url") ? "linked" : "unlinked"),
    signed_up_by: rec.get("signed_up_by") || "",
    gc_last_error: rec.get("gc_last_error") || "",
    host: !!rec.get("is_host"),
    published_w: rec.get("published_w"),
    published_l: rec.get("published_l"),
    published_t: rec.get("published_t"),
    published_rf: rec.get("published_rf"),
    published_ra: rec.get("published_ra"),
    packet_status: rec.get("packet_status") || "",
    packet_note: rec.get("packet_note") || "",
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
  rec.set("pitch_limit_mode", body.pitch_limit_mode || "ip");
  rec.set("rain_status", body.rain_status || "clear");
  applyGuidelines(rec, body);
  const schedule = require(__hooks + "/schedule.js");
  schedule.applyLocation(rec, body);
  if (body.start) rec.set("start", body.start);
  if (body.end) rec.set("end", body.end);
  if (source === "tourneymachine") {
    rec.set("tm_url", body.tm_url);
    rec.set("tm_id", tm.tmId);
  }
  if (auth) rec.set("created_by", auth.id);
  try {
    require(__hooks + "/diamond.js").saveTiebreak(rec, body.tiebreak_order != null || body.tiebreak != null ? body : { tiebreak_order: "record,h2h,ra,diff,rs" });
  } catch (err) {
    rec.set("tiebreak", { order: ["record", "h2h", "ra", "diff", "rs"] });
  }
  app.save(rec);
  schedule.saveEventFields(app, rec, body);
  writeLog(app, rec.id, "event", true, source === "tourneymachine" ? tm.note : "Native tournament opened");
  return { event: eventJson(rec, app), note: tm.note || "Tournament is live. Teams can join with or without GameChanger." };
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
  const asDirector = director && (body.as_director === true || body.as_director === "true" || body.as_director === "director");
  const team = upsertEventTeam(app, event, {
    name: name,
    pool: body.pool || "",
    gamechanger_url: gcUrl,
    contact_name: body.contact_name || (auth ? auth.email() : ""),
    contact_email: body.contact_email || (auth ? auth.email() : ""),
    signed_up_by: asDirector ? "director" : "team",
    account: auth ? auth.id : "",
  });
  if (!team.get("packet_status")) team.set("packet_status", "incomplete");
  app.save(team);
  const row = teamJson(team);
  row.packet = packetSummary(app, event, team);
  return row;
}

function refreshPacketStatus(app, event, team) {
  const packet = packetSummary(app, event, team);
  if (team.get("packet_status") === "approved" && packet.complete) return packet;
  if (packet.complete && packet.required.length) team.set("packet_status", "submitted");
  else team.set("packet_status", packet.required.length ? "incomplete" : "submitted");
  app.save(team);
  packet.status = team.get("packet_status");
  return packet;
}

function saveTeamDoc(app, event, team, data, files, auth) {
  const kind = String(data.kind || "").trim();
  if (DOC_KINDS.indexOf(kind) === -1) throw new BadRequestError("Unknown document type");
  if (!files || !files.length) throw new BadRequestError("Choose a file for " + (DOC_LABELS[kind] || kind));
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "team_docs",
      "event_team = {:t} && kind = {:k}",
      { t: team.id, k: kind },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("team_docs"));
    rec.set("event", event.id);
    rec.set("event_team", team.id);
    rec.set("kind", kind);
  }
  rec.set("file", files);
  rec.set("original_name", data.original_name || kind);
  rec.set("status", "submitted");
  rec.set("note", data.note || "");
  if (auth) rec.set("uploaded_by", auth.id);
  app.save(rec);
  refreshPacketStatus(app, event, team);
  return docJson(app, rec);
}

function reviewDoc(app, event, doc, body) {
  const status = body.status;
  if (status !== "approved" && status !== "rejected") throw new BadRequestError("status must be approved or rejected");
  doc.set("status", status);
  if (body.note != null) doc.set("note", body.note);
  app.save(doc);
  const team = app.findRecordById("event_teams", doc.get("event_team"));
  if (status === "rejected") {
    team.set("packet_status", "needs_fix");
    team.set("packet_note", body.note || "Director asked for a replacement file.");
    app.save(team);
  } else {
    const packet = refreshPacketStatus(app, event, team);
    const docs = packet.docs;
    if (packet.complete && docs.every(function (d) { return d.status === "approved" || packet.required.indexOf(d.kind) === -1; })) {
      const req = packet.required;
      const ok = req.every(function (k) {
        return docs.some(function (d) { return d.kind === k && d.status === "approved"; });
      });
      if (ok) {
        team.set("packet_status", "approved");
        app.save(team);
      }
    }
  }
  return docJson(app, doc);
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
  return rows.map(function (rec) { return eventJson(rec, app); }).filter(function (ev) {
    if (!needle) return true;
    return (ev.name + " " + ev.venue + " " + ev.ages + " " + ev.slug).toLowerCase().indexOf(needle) !== -1;
  });
}

function accountHome(app, auth) {
  let created = [];
  try {
    created = app.findRecordsByFilter("events", "created_by = {:u}", "-id", 80, 0, { u: auth.id }).map(function (rec) { return eventJson(rec, app); });
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
        const row = eventJson(app.findRecordById("events", evId), app);
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

function publicRoster(app, event, auth) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 200, 0, { e: event.id });
  return teams.map(function (t) {
    const row = teamJson(t);
    row.packet = packetSummary(app, event, t, canSeeTeamPacket(event, t, auth));
    return row;
  });
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

function duplicateEvent(app, source, body, auth) {
  const name = String((body && body.name) || (source.get("name") + " copy")).trim();
  if (!name) throw new BadRequestError("Tournament name is required");
  const slug = uniqueSlug(app, slugify((body && body.slug) || name));
  const rec = new Record(app.findCollectionByNameOrId("events"));
  rec.set("name", name);
  rec.set("slug", slug);
  rec.set("venue", source.get("venue") || "");
  rec.set("address", source.get("address") || "");
  rec.set("lat", source.get("lat") || 0);
  rec.set("lng", source.get("lng") || 0);
  rec.set("ages", source.get("ages") || "10U");
  rec.set("public", true);
  rec.set("status", "live");
  rec.set("format", source.get("format") || "pool-to-bracket");
  rec.set("source", "native");
  rec.set("signup_open", true);
  rec.set("auto_sync", true);
  rec.set("rain_status", "clear");
  rec.set("rain_note", "");
  rec.set("hours_start", source.get("hours_start") || "08:00");
  rec.set("hours_end", source.get("hours_end") || "18:00");
  rec.set("scheduler", source.get("scheduler") || null);
  rec.set("tiebreak", source.get("tiebreak") || { order: ["record", "h2h", "ra", "diff", "rs"] });
  const copied = [
    "governing_body", "governing_notes", "pitch_limit_mode", "pitch_limit_ip",
    "pitch_limit_pitches", "pitch_limit_notes", "game_length_minutes", "innings_cap",
    "mercy_rule", "umpire_count", "rules_notes", "packet_notes", "require_insurance",
    "require_roster", "require_birth_certs", "require_waiver", "require_coach_cert",
  ];
  for (let i = 0; i < copied.length; i++) rec.set(copied[i], source.get(copied[i]));
  if (body && body.start) rec.set("start", body.start);
  else if (source.get("start")) rec.set("start", source.get("start"));
  if (body && body.end) rec.set("end", body.end);
  else if (source.get("end")) rec.set("end", source.get("end"));
  if (auth) rec.set("created_by", auth.id);
  app.save(rec);

  const fieldMap = {};
  const fields = app.findRecordsByFilter("fields", "event = {:e}", "name", 40, 0, { e: source.id });
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const nf = new Record(app.findCollectionByNameOrId("fields"));
    nf.set("event", rec.id);
    nf.set("name", f.get("name"));
    nf.set("address", f.get("address") || "");
    nf.set("lat", f.get("lat") || 0);
    nf.set("lng", f.get("lng") || 0);
    nf.set("surface", f.get("surface") || "");
    nf.set("lights", !!f.get("lights"));
    nf.set("notes", f.get("notes") || "");
    nf.set("status", f.get("status") || "open");
    nf.set("availability", f.get("availability") || []);
    app.save(nf);
    fieldMap[f.id] = nf;
  }

  const teamMap = {};
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 200, 0, { e: source.id });
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    const nt = new Record(app.findCollectionByNameOrId("event_teams"));
    nt.set("event", rec.id);
    nt.set("name", t.get("name"));
    nt.set("slug", t.get("slug"));
    nt.set("pool", t.get("pool") || "");
    nt.set("is_host", !!t.get("is_host"));
    nt.set("gamechanger_url", t.get("gamechanger_url") || "");
    nt.set("gc_team_ref", t.get("gc_team_ref") || "");
    if (t.get("club")) nt.set("club", t.get("club"));
    nt.set("packet_status", "incomplete");
    app.save(nt);
    teamMap[t.id] = nt;
  }

  try {
    const pools = app.findRecordsByFilter("pools", "event = {:e}", "name", 20, 0, { e: source.id });
    for (let i = 0; i < pools.length; i++) {
      const np = new Record(app.findCollectionByNameOrId("pools"));
      np.set("event", rec.id);
      np.set("name", pools[i].get("name"));
      np.set("tiebreak_notes", pools[i].get("tiebreak_notes") || "");
      app.save(np);
    }
  } catch (err) {}

  const games = app.findRecordsByFilter("event_schedule", "event = {:e}", "game_number", 400, 0, { e: source.id });
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const home = teamMap[g.get("home")];
    const away = teamMap[g.get("away")];
    if (!home || !away) continue;
    const ng = new Record(app.findCollectionByNameOrId("event_schedule"));
    ng.set("event", rec.id);
    ng.set("date", g.get("date") || "");
    ng.set("time", g.get("time") || "");
    ng.set("home", home.id);
    ng.set("away", away.id);
    ng.set("status", "scheduled");
    ng.set("pool", g.get("pool") || "");
    ng.set("game_number", Number(g.get("game_number") || 0) || 0);
    const fid = g.get("field");
    if (fid && fieldMap[fid]) {
      ng.set("field", fieldMap[fid].id);
      ng.set("field_name", fieldMap[fid].get("name"));
    } else if (g.get("field_name")) {
      ng.set("field_name", g.get("field_name"));
    }
    app.save(ng);
  }

  const bracket = app.findRecordsByFilter("bracket_games", "event = {:e}", "slot", 40, 0, { e: source.id });
  for (let i = 0; i < bracket.length; i++) {
    const g = bracket[i];
    const ng = new Record(app.findCollectionByNameOrId("bracket_games"));
    ng.set("event", rec.id);
    ng.set("round", g.get("round"));
    ng.set("slot", g.get("slot"));
    if (g.get("side")) ng.set("side", g.get("side"));
    ng.set("status", "scheduled");
    ng.set("game_number", Number(g.get("game_number") || 0) || 0);
    ng.set("date", g.get("date") || "");
    ng.set("time", g.get("time") || "");
    const fid = g.get("field");
    if (fid && fieldMap[fid]) {
      ng.set("field", fieldMap[fid].id);
      ng.set("field_name", fieldMap[fid].get("name"));
    }
    app.save(ng);
  }

  writeLog(app, rec.id, "event", true, "Duplicated from " + source.get("slug") + " without scores, boxes, or family contacts");
  return {
    event: eventJson(rec, app),
    source: source.get("slug"),
    teams: Object.keys(teamMap).length,
    games: games.length,
    note: "Copied teams, fields, and the unpaid schedule. Scores, boxes, and family contacts were left behind.",
  };
}

function applySettings(app, event, body) {
  if (body.signup_open != null) event.set("signup_open", !!body.signup_open);
  if (body.auto_sync != null) event.set("auto_sync", !!body.auto_sync);
  if (body.venue != null) event.set("venue", body.venue);
  if (body.ages != null) event.set("ages", body.ages);
  if (body.start) event.set("start", body.start);
  if (body.end) event.set("end", body.end);
  applyGuidelines(event, body);
  try { require(__hooks + "/diamond.js").saveTiebreak(event, body); } catch (err) {}
  const schedule = require(__hooks + "/schedule.js");
  schedule.saveScheduler(app, event, body);
  schedule.applyLocation(event, body);
  app.save(event);
  schedule.saveEventFields(app, event, body);
  return eventJson(event, app);
}

module.exports = {
  slugify: slugify,
  isGameChangerUrl: isGameChangerUrl,
  isGcBoxUrl: isGcBoxUrl,
  isTourneyMachineUrl: isTourneyMachineUrl,
  eventJson: eventJson,
  teamJson: teamJson,
  writeLog: writeLog,
  parsePacket: parsePacket,
  createEvent: createEvent,
  duplicateEvent: duplicateEvent,
  signupTeam: signupTeam,
  syncEvent: syncEvent,
  publicRoster: publicRoster,
  applySettings: applySettings,
  registerAccount: registerAccount,
  searchEvents: searchEvents,
  accountHome: accountHome,
  listClubs: listClubs,
  saveClub: saveClub,
  applyGuidelines: applyGuidelines,
  requiredDocKinds: requiredDocKinds,
  packetSummary: packetSummary,
  canSeeTeamPacket: canSeeTeamPacket,
  refreshPacketStatus: refreshPacketStatus,
  saveTeamDoc: saveTeamDoc,
  reviewDoc: reviewDoc,
  DOC_KINDS: DOC_KINDS,
  DOC_LABELS: DOC_LABELS,
  uploaded: uploaded,
};
