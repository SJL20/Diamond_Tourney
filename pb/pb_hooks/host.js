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

// True only for a region admin, the director who owns this event, a listed
// co-owner, or the account that signed this team up. `event_td` alone is not
// enough: account registration hands out that role, so it is not a trust
// boundary.
function canSeeTeamPacket(event, team, auth, app) {
  if (!auth) return false;
  const sb = require(__hooks + "/softball.js");
  if (sb.isSiteAdmin(auth)) return true;
  if (!sb.isVerifiedAccount(auth)) return false;
  if (sb.isEventAdmin(event, auth, app)) return true;
  if (team) {
    if (team.get("account") && team.get("account") === auth.id) return true;
    const email = team.get("contact_email");
    if (email && email === auth.email()) return true;
    try {
      if (require(__hooks + "/contacts.js").canSeeEventContact(event, team, auth, app)) return true;
    } catch (err) {}
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

const AGE_CHOICES = ["6U", "8U", "10U", "11U", "12U", "14U", "16U", "18U"];

function decodeJson(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch (err) { return null; }
  }
  return raw;
}

function formatAgeLabel(ages, klass, split) {
  const list = (ages || []).filter(Boolean);
  if (!list.length) return "";
  const suffix = klass ? "-" + klass : "";
  if (split) return list.map(function (a) { return a + suffix; }).join(" · ");
  return list.join("/") + suffix;
}

function agesFromText(text) {
  const found = String(text || "").toUpperCase().match(/6U|8U|10U|11U|12U|14U|16U|18U/g) || [];
  const seen = {};
  const out = [];
  for (let i = 0; i < found.length; i++) {
    if (!seen[found[i]]) {
      out.push(found[i]);
      seen[found[i]] = true;
    }
  }
  return out;
}

function normalizeAgeGroups(body, rec) {
  const allowed = {};
  for (let i = 0; i < AGE_CHOICES.length; i++) allowed[AGE_CHOICES[i]] = true;
  let ages = [];
  let raw = body && body.age_groups;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch (err) {
      raw = String(raw).split(/[,/|]/);
    }
  }
  if (raw && raw.ages) raw = raw.ages;
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const key = String(raw[i] || "").toUpperCase();
      if (allowed[key] && ages.indexOf(key) === -1) ages.push(key);
    }
  }
  if (!ages.length && body) {
    for (let i = 0; i < AGE_CHOICES.length; i++) {
      const a = AGE_CHOICES[i];
      const v = body["age_" + a] || body["age_" + a.toLowerCase()];
      if (v === true || v === "true" || v === "on" || v === "1") ages.push(a);
    }
    const grouped = body.age_group;
    const list = Array.isArray(grouped) ? grouped : (grouped ? [grouped] : []);
    for (let i = 0; i < list.length; i++) {
      const key = String(list[i] || "").toUpperCase();
      if (allowed[key] && ages.indexOf(key) === -1) ages.push(key);
    }
  }
  if (!ages.length) {
    ages = agesFromText((body && body.ages) || (rec && rec.get("ages")) || "");
  }
  let klass = String((body && body.age_class != null) ? body.age_class : ((rec && rec.get("age_class")) || "")).toUpperCase();
  if (klass && "ABC".indexOf(klass) === -1) klass = "";
  if (!klass && body && body.ages && /-[ABC]\b/i.test(String(body.ages))) {
    klass = String(body.ages).toUpperCase().replace(/^.*-([ABC]).*$/, "$1");
  }
  const split = !!(body && (body.age_split === true || body.age_split === "true" || body.age_split === "on" || body.age_split === "1"));
  return { ages: ages, class: klass, split: split, label: formatAgeLabel(ages, klass, split) };
}

function applyAgeGroups(rec, body) {
  if (!rec || !body) return;
  if (body.age_groups == null && body.age_class == null && body.age_split == null && body.ages == null && body.age_group == null) return;
  const parsed = normalizeAgeGroups(body, rec);
  rec.set("age_groups", { ages: parsed.ages, class: parsed.class, split: parsed.split });
  rec.set("age_class", parsed.class);
  rec.set("age_split", parsed.split);
  if (parsed.label) rec.set("ages", parsed.label);
  else if (body.ages != null) rec.set("ages", body.ages);
}

function eventAgeJson(rec) {
  const stored = decodeJson(rec.get("age_groups")) || {};
  const ages = Array.isArray(stored.ages) ? stored.ages : agesFromText(rec.get("ages") || "");
  const klass = rec.get("age_class") || stored.class || "";
  const split = rec.get("age_split") === true || stored.split === true;
  return {
    ages: ages,
    class: klass,
    split: split,
    label: rec.get("ages") || formatAgeLabel(ages, klass, split),
  };
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
  "pool-to-bracket": "Pool play, then bracket",
  "pool-double-elim": "Pool play, then bracket",
  "round-robin": "Round robin",
  "pool-only": "Pool play only",
  "single-elim": "Bracket only",
  "double-elim": "Bracket only",
  imported: "Imported / already drawn",
};

function eventJson(rec, app, auth, opts) {
  const packet = parsePacket(rec.get("packet"));
  const mode = rec.get("pitch_limit_mode") || "none";
  const format = rec.get("format") || "";
  const sb = require(__hooks + "/softball.js");
  const admin = sb.isEventAdmin(rec, auth, app);
  let fields = [];
  if (app) {
    try { fields = require(__hooks + "/schedule.js").eventFields(app, rec.id); } catch (err) {}
  }
  const out = {
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
    bracket_flights: rec.get("bracket_flights") || "none",
    bracket_plan: (function () {
      try { return require(__hooks + "/brackets.js").planFromInputs(rec, {}); }
      catch (err) { return { flights: [] }; }
    })(),
    bracket_mode: rec.get("bracket_mode") || "standings",
    start: dateStr(rec.get("start")),
    end: dateStr(rec.get("end")),
    hours_start: rec.get("hours_start") || "08:00",
    hours_end: rec.get("hours_end") || "18:00",
    scheduler: (function () {
      try { return require(__hooks + "/schedule.js").parseScheduler(rec.get("scheduler")); }
      catch (err) { return { games_per_team: 2, consolation: false, replace: true, draw_bracket: false, origin: "", days: [] }; }
    })(),
    fields: fields,
    ages: rec.get("ages") || "",
    age_groups: eventAgeJson(rec),
    age_class: rec.get("age_class") || "",
    age_split: !!rec.get("age_split"),
    status: rec.get("status") || "",
    source: rec.get("source") || "native",
    tm_url: rec.get("tm_url") || "",
    tm_id: rec.get("tm_id") || "",
    source_url: rec.get("source_url") || "",
    signup_open: !!rec.get("signup_open"),
    auto_sync: !!rec.get("auto_sync"),
    pitch_limit_ip: rec.get("pitch_limit_ip") || 0,
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
    can_admin: admin,
    contact: rec.get("contact") || "",
    status_note: rec.get("status_note") || "",
    dates: packet ? packet.dates : "",
    packet: packet,
    tiebreak: (function () {
      try {
        const diamond = require(__hooks + "/diamond.js");
        const order = diamond.parseTiebreak(rec.get("tiebreak"));
        return { order: order, label: diamond.tiebreakLabel(order), explicit: true };
      } catch (err) {
        return { order: ["record", "h2h", "ra", "diff", "rs"], label: "record (tie = half), then head-to-head, then fewest runs allowed, then run differential, then most runs scored", explicit: true };
      }
    })(),
    pools: (function () {
      if (!app) return [];
      try {
        const diamond = require(__hooks + "/diamond.js");
        const rows = app.findRecordsByFilter("pools", "event = {:e}", "name", 20, 0, { e: rec.id });
        return rows.map(function (p) {
          const order = diamond.parseTiebreak(p.get("tiebreak") || rec.get("tiebreak"));
          return { id: p.id, name: p.get("name"), tiebreak: { order: order, label: diamond.tiebreakLabel(order) } };
        });
      } catch (err) {
        return [];
      }
    })(),
  };
  // Co-owner emails stay off public board / Find / year. The director desk
  // (/plan) and settings responses pass { owners: true }.
  if (opts && opts.owners && admin) {
    out.co_owners = sb.listCoOwners(app, rec);
    out.can_manage_owners = sb.canManageCoOwners(rec, auth);
  }
  return out;
}

function teamJson(rec, app) {
  const masterId = rec.get("team") || "";
  let name = rec.get("name");
  let age = rec.get("age_group") || "";
  const gc = linkedGcUrl(app, rec);
  if (app && masterId) {
    try {
      const master = app.findRecordById("teams", masterId);
      if (master.get("name")) name = master.get("name");
      if (master.get("age_group")) age = master.get("age_group");
    } catch (err) {}
  }
  return {
    id: rec.id,
    name: name,
    slug: rec.get("slug"),
    team: masterId,
    club: rec.get("club") || "",
    pool: rec.get("pool") || "",
    seed: rec.get("seed") || 0,
    gamechanger_url: gc,
    gc_linked: isGameChangerUrl(gc),
    gc_sync_status: rec.get("gc_sync_status") || (gc ? "linked" : "unlinked"),
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
    age_group: rec.get("age_group") || age,
    klass: rec.get("klass") || "",
    notes: rec.get("notes") || "",
    paid: !!rec.get("paid"),
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

function uniqueTeamSlug(app, base) {
  let slug = base || "team";
  let n = 2;
  while (true) {
    try {
      app.findFirstRecordByData("teams", "slug", slug);
      slug = (base || "team") + "-" + n;
      n++;
    } catch (err) {
      return slug;
    }
  }
}

const MASTER_AGES = { "6U": 1, "8U": 1, "10U": 1, "12U": 1, "14U": 1, "16U": 1, "18U": 1 };

function masterTeamJson(rec) {
  return {
    id: rec.id,
    name: rec.get("name") || "",
    slug: rec.get("slug") || "",
    age_group: rec.get("age_group") || "",
    coach_name: rec.get("coach_name") || "",
    gamechanger_url: rec.get("gamechanger_url") || "",
    gc_linked: isGameChangerUrl(rec.get("gamechanger_url")),
  };
}

function emailList(raw) {
  const text = Array.isArray(raw) ? raw.join(",") : String(raw || "");
  const out = [];
  const seen = {};
  const parts = text.split(/[\s,;]+/);
  for (let i = 0; i < parts.length; i++) {
    const email = parts[i].trim().toLowerCase();
    if (!email || email.indexOf("@") < 1 || seen[email]) continue;
    seen[email] = true;
    out.push(email);
  }
  return out;
}

function findOwnerUser(app, teamId) {
  if (!teamId) return null;
  try {
    return app.findFirstRecordByFilter("users", "team = {:t}", { t: teamId });
  } catch (err) {
    return null;
  }
}

function ownerState(app, teamId) {
  if (findOwnerUser(app, teamId)) return "owner";
  try {
    const contacts = require(__hooks + "/contacts.js");
    const row = contacts.findForSeasonTeam(app, teamId);
    if (row && row.get("pending_owner_email")) return "pending";
  } catch (err) {}
  return "none";
}

function listCoOwnerEmails(app, teamId) {
  const out = [];
  try {
    const rows = app.findRecordsByFilter("team_co_owners", "team = {:t}", "email", 40, 0, { t: teamId });
    for (let i = 0; i < rows.length; i++) out.push(rows[i].get("email") || "");
  } catch (err) {}
  return out;
}

function replaceCoOwners(app, teamId, raw) {
  let existing = [];
  try {
    existing = app.findRecordsByFilter("team_co_owners", "team = {:t}", "", 80, 0, { t: teamId });
  } catch (err) {}
  for (let i = 0; i < existing.length; i++) {
    try { app.delete(existing[i]); } catch (err) {}
  }
  const emails = emailList(raw);
  for (let i = 0; i < emails.length; i++) {
    const rec = new Record(app.findCollectionByNameOrId("team_co_owners"));
    rec.set("team", teamId);
    rec.set("email", emails[i]);
    try {
      const user = app.findFirstRecordByFilter("users", "email = {:e}", { e: emails[i] });
      if (user) rec.set("user", user.id);
    } catch (err) {}
    app.save(rec);
  }
  return emails;
}

function linkCoOwnerUsers(app, user) {
  if (!app || !user) return;
  const sb = require(__hooks + "/softball.js");
  const email = sb.normalizeEmail(user.email ? user.email() : "");
  if (!email) return;
  try {
    const rows = app.findRecordsByFilter("team_co_owners", "email = {:e}", "", 40, 0, { e: email });
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].get("user")) continue;
      rows[i].set("user", user.id);
      app.save(rows[i]);
    }
  } catch (err) {}
}

function eventAdminOfTeam(app, teamId, auth) {
  const sb = require(__hooks + "/softball.js");
  let rows = [];
  try {
    rows = app.findRecordsByFilter("event_teams", "team = {:t}", "", 80, 0, { t: teamId });
  } catch (err) {
    return false;
  }
  for (let i = 0; i < rows.length; i++) {
    try {
      const event = app.findRecordById("events", rows[i].get("event"));
      if (sb.isEventAdmin(event, auth, app)) return true;
    } catch (err) {}
  }
  return false;
}

function canEditMaster(app, team, auth) {
  if (!auth || !team) return false;
  const sb = require(__hooks + "/softball.js");
  if (sb.isSiteAdmin(auth)) return true;
  if (!sb.isVerifiedAccount(auth)) return false;
  if (auth.get("team") === team.id) return true;
  try {
    if (require(__hooks + "/contacts.js").isCoOwner(app, team.id, auth)) return true;
  } catch (err) {}
  if (team.get("created_by") && team.get("created_by") === auth.id) return true;
  return eventAdminOfTeam(app, team.id, auth);
}

function canHandOff(app, team, auth) {
  if (!canEditMaster(app, team, auth)) return false;
  const sb = require(__hooks + "/softball.js");
  if (sb.isSiteAdmin(auth)) return true;
  const owner = findOwnerUser(app, team.id);
  if (owner) return owner.id === auth.id;
  if (team.get("created_by") && team.get("created_by") === auth.id) return true;
  return eventAdminOfTeam(app, team.id, auth);
}

function clearOwners(app, teamId, keepUserId) {
  let rows = [];
  try {
    rows = app.findRecordsByFilter("users", "team = {:t}", "", 20, 0, { t: teamId });
  } catch (err) {
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    if (keepUserId && rows[i].id === keepUserId) continue;
    const fresh = app.findRecordById("users", rows[i].id);
    fresh.set("team", "");
    app.save(fresh);
  }
}

function setEventAccounts(app, teamId, userId) {
  let rows = [];
  try {
    rows = app.findRecordsByFilter("event_teams", "team = {:t}", "", 200, 0, { t: teamId });
  } catch (err) {
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    rows[i].set("account", userId || "");
    app.save(rows[i]);
  }
}

function claimPendingTeam(app, user) {
  if (!app || !user || user.get("team")) return;
  const sb = require(__hooks + "/softball.js");
  const email = sb.normalizeEmail(user.email ? user.email() : "");
  if (!email) return;
  let rows = [];
  try {
    rows = app.findRecordsByFilter("team_contacts", "pending_owner_email = {:e}", "", 20, 0, { e: email });
  } catch (err) {
    return;
  }
  for (let i = 0; i < rows.length; i++) {
    const teamId = rows[i].get("team");
    if (!teamId) continue;
    if (findOwnerUser(app, teamId)) continue;
    const fresh = app.findRecordById("users", user.id);
    if (fresh.get("team")) return;
    fresh.set("team", teamId);
    app.save(fresh);
    rows[i].set("pending_owner_email", "");
    app.save(rows[i]);
    setEventAccounts(app, teamId, fresh.id);
    return;
  }
}

function transferTeam(app, team, rawEmail, auth) {
  if (!canHandOff(app, team, auth)) {
    throw new ForbiddenError("Only the owner, or the director who created this team, can pass it to an email.");
  }
  const sb = require(__hooks + "/softball.js");
  const email = sb.normalizeEmail(rawEmail);
  if (!sb.isValidEmail(email)) throw new BadRequestError("Enter the email that should own this team.");
  let user = null;
  try { user = app.findFirstRecordByFilter("users", "email = {:e}", { e: email }); } catch (err) {}
  if (user) {
    if (user.get("team") && user.get("team") !== team.id) {
      throw new BadRequestError("That account already has a team.");
    }
    clearOwners(app, team.id, user.id);
    const fresh = app.findRecordById("users", user.id);
    fresh.set("team", team.id);
    app.save(fresh);
    try {
      const contacts = require(__hooks + "/contacts.js");
      const row = contacts.findForSeasonTeam(app, team.id);
      if (row && row.get("pending_owner_email")) {
        row.set("pending_owner_email", "");
        app.save(row);
      }
    } catch (err) {}
    setEventAccounts(app, team.id, fresh.id);
    return { id: team.id, email: email, state: "owner" };
  }
  clearOwners(app, team.id, "");
  setEventAccounts(app, team.id, "");
  const contacts = require(__hooks + "/contacts.js");
  const row = contacts.upsertForSeasonTeam(app, team, {});
  row.set("pending_owner_email", email);
  app.save(row);
  return { id: team.id, email: email, state: "pending" };
}

function saveMasterProfile(app, team, body) {
  if (!body) body = {};
  let changed = false;
  if (body.name) {
    const name = String(body.name).trim();
    if (name && name !== team.get("name")) {
      team.set("name", name);
      changed = true;
    }
  }
  const coachName = body.coach_name != null ? body.coach_name : body.contact_name;
  if (coachName != null) {
    team.set("coach_name", String(coachName || "").trim());
    changed = true;
  }
  if (body.age_group != null && body.age_group !== "") {
    const age = String(body.age_group).toUpperCase();
    if (MASTER_AGES[age]) {
      team.set("age_group", age);
      changed = true;
    }
  }
  if (body.gamechanger_url != null) {
    const gc = String(body.gamechanger_url || "").trim();
    if (gc && !isGameChangerUrl(gc)) {
      throw new BadRequestError("If you link a stats page, it must be a GameChanger URL (gc.com or web.gc.com).");
    }
    team.set("gamechanger_url", gc);
    changed = true;
  }
  if (changed) app.save(team);
  const contacts = require(__hooks + "/contacts.js");
  const patch = {};
  if (body.coach_email != null || body.contact_email != null) {
    patch.coach_email = body.coach_email != null ? body.coach_email : body.contact_email;
  }
  if (body.coach_phone != null || body.contact_phone != null) {
    patch.coach_phone = body.coach_phone != null ? body.coach_phone : body.contact_phone;
  }
  if (body.alt_name != null) patch.alt_name = body.alt_name;
  if (body.alt_email != null) patch.alt_email = body.alt_email;
  if (body.alt_phone != null) patch.alt_phone = body.alt_phone;
  if (Object.keys(patch).length) contacts.upsertForSeasonTeam(app, team, patch);
  if (body.co_owners != null) replaceCoOwners(app, team.id, body.co_owners);
  return team;
}

function masterProfile(app, team, auth) {
  const row = masterTeamJson(team);
  row.owner_state = ownerState(app, team.id);
  if (!canEditMaster(app, team, auth)) return row;
  const contacts = require(__hooks + "/contacts.js");
  const season = contacts.findForSeasonTeam(app, team.id);
  row.contact = contacts.contactJson(season);
  row.co_owners = listCoOwnerEmails(app, team.id);
  row.pending_owner_email = season ? (season.get("pending_owner_email") || "") : "";
  return row;
}

function createMasterTeam(app, body, auth) {
  if (!auth) throw new UnauthorizedError("Log in before creating a team.");
  const sb = require(__hooks + "/softball.js");
  if (!sb.isVerifiedAccount(auth)) {
    throw new ForbiddenError("Confirm your email before creating a team.");
  }
  body = body || {};
  const name = String(body.name || body.team_name || "").trim();
  if (!name) throw new BadRequestError("Team name is required");
  const role = auth.get("role") || "";
  const siteAdmin = sb.isSiteAdmin(auth);
  const director = role === "event_td" || siteAdmin;
  const coach = role === "team_coach";
  if (!director && !coach) {
    throw new ForbiddenError("A director or team account can create a team.");
  }
  if (coach && !director && auth.get("team")) {
    let existing = null;
    try { existing = app.findRecordById("teams", auth.get("team")); } catch (err) {}
    const label = existing ? existing.get("name") : "this account";
    throw new BadRequestError("This account already has a team: " + label + ". Sign that team up for an event.");
  }
  const ownerEmail = sb.normalizeEmail(body.owner_email || "");
  if (!director && ownerEmail && ownerEmail !== sb.normalizeEmail(auth.email())) {
    throw new BadRequestError("This account owns the team it creates.");
  }
  const rec = new Record(app.findCollectionByNameOrId("teams"));
  rec.set("name", name);
  rec.set("slug", uniqueTeamSlug(app, slugify(name)));
  const age = String(body.age_group || "").toUpperCase();
  if (MASTER_AGES[age]) rec.set("age_group", age);
  const coachName = String(body.coach_name || body.contact_name || "").trim();
  if (coachName) rec.set("coach_name", coachName);
  else if (coach && !director) rec.set("coach_name", auth.get("display_name") || "");
  const gc = String(body.gamechanger_url || "").trim();
  if (gc && !isGameChangerUrl(gc)) {
    throw new BadRequestError("If you link a stats page, it must be a GameChanger URL (gc.com or web.gc.com).");
  }
  if (gc) rec.set("gamechanger_url", gc);
  rec.set("created_by", auth.id);
  rec.set("public_record_wins", 0);
  rec.set("public_record_losses", 0);
  rec.set("public_record_ties", 0);
  app.save(rec);
  if (coach && !director && !auth.get("team")) {
    const fresh = app.findRecordById("users", auth.id);
    fresh.set("team", rec.id);
    app.save(fresh);
  }
  const profile = {};
  if (body.coach_email != null || body.contact_email != null || (coach && !director)) {
    profile.coach_email = body.coach_email || body.contact_email || (coach && !director ? auth.email() : "");
  }
  if (body.coach_phone != null || body.contact_phone != null) profile.coach_phone = body.coach_phone || body.contact_phone;
  if (body.alt_name != null) profile.alt_name = body.alt_name;
  if (body.alt_email != null) profile.alt_email = body.alt_email;
  if (body.alt_phone != null) profile.alt_phone = body.alt_phone;
  if (body.co_owners != null) profile.co_owners = body.co_owners;
  saveMasterProfile(app, rec, profile);
  let handoff = null;
  if (director && ownerEmail) handoff = transferTeam(app, rec, ownerEmail, auth);
  const out = masterProfile(app, rec, auth);
  if (handoff) out.handoff = handoff;
  return out;
}

function updateMasterTeam(app, team, body, auth) {
  if (!canEditMaster(app, team, auth)) {
    throw new ForbiddenError("Only this team's account, a co-owner, or the director who created it can edit it.");
  }
  saveMasterProfile(app, team, body || {});
  const ownerEmail = String((body && body.owner_email) || "").trim();
  let handoff = null;
  if (ownerEmail) handoff = transferTeam(app, team, ownerEmail, auth);
  const out = masterProfile(app, app.findRecordById("teams", team.id), auth);
  if (handoff) out.handoff = handoff;
  return out;
}

function findOrCreateMasterTeam(app, name, auth) {
  const base = slugify(name);
  try {
    return app.findFirstRecordByData("teams", "slug", base);
  } catch (err) {}
  const created = createMasterTeam(app, { name: name }, auth);
  return app.findRecordById("teams", created.id);
}

function loadMasterTeam(app, body) {
  const id = String((body && body.team_id) || "").trim();
  const slug = String((body && body.team_slug) || "").trim();
  if (!id && !slug) {
    throw new BadRequestError("Create the team before signing up for an event.");
  }
  try {
    if (id) return app.findRecordById("teams", id);
    return app.findFirstRecordByData("teams", "slug", slug);
  } catch (err) {
    throw new BadRequestError("That team does not exist yet. Create it before signing up for an event.");
  }
}

function listMasterTeams(app) {
  return app.findRecordsByFilter("teams", "", "name", 500, 0).map(function (rec) {
    const row = masterTeamJson(rec);
    row.owner_state = ownerState(app, rec.id);
    return row;
  });
}

function linkedGcUrl(app, eventTeam) {
  const eventUrl = (eventTeam && eventTeam.get("gamechanger_url")) || "";
  if (!app || !eventTeam) return eventUrl;
  const masterId = eventTeam.get("team") || "";
  if (!masterId) return eventUrl;
  try {
    const masterUrl = app.findRecordById("teams", masterId).get("gamechanger_url") || "";
    if (masterUrl) return masterUrl;
  } catch (err) {}
  return eventUrl;
}

function upsertEventTeam(app, event, data) {
  const slug = slugify(data.name);
  let rec;
  let existing = false;
  if (data.team) {
    try {
      rec = app.findFirstRecordByFilter(
        "event_teams",
        "event = {:e} && team = {:t}",
        { e: event.id, t: data.team },
      );
      existing = true;
    } catch (err) {}
  }
  if (!existing) {
    try {
      rec = app.findFirstRecordByFilter(
        "event_teams",
        "event = {:e} && slug = {:s}",
        { e: event.id, s: slug },
      );
      existing = true;
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("event_teams"));
      rec.set("event", event.id);
      rec.set("slug", slug);
    }
  }
  if (existing) {
    const ownerId = rec.get("account") || "";
    const incoming = data.account || "";
    const sameOwner = !!(ownerId && incoming && ownerId === incoming);
    const storedEmail = String(rec.get("contact_email") || "").trim().toLowerCase();
    const incomingEmail = String(data.contact_email || "").trim().toLowerCase();
    const claim = !ownerId && incoming && data.verified && storedEmail && storedEmail === incomingEmail;
    const directorFill = data.signed_up_by === "director" && !ownerId;
    const sameMaster = !!(data.team && rec.get("team") === data.team);
    if (!sameOwner && !claim && !directorFill && !sameMaster) {
      throw new BadRequestError("That team is already signed up for this tournament.");
    }
  }
  rec.set("name", data.name);
  if (data.team) rec.set("team", data.team);
  if (data.pool) rec.set("pool", data.pool);
  if (data.team) {
    rec.set("gc_sync_status", isGameChangerUrl(data.gamechanger_url) ? "linked" : (rec.get("gc_sync_status") || "unlinked"));
  } else {
    rec.set("gamechanger_url", data.gamechanger_url || "");
    rec.set("gc_team_ref", gcRef(data.gamechanger_url));
    rec.set("contact_name", data.contact_name || "");
    rec.set("contact_email", data.contact_email || "");
    rec.set("gc_sync_status", isGameChangerUrl(data.gamechanger_url) ? "linked" : "unlinked");
  }
  rec.set("signed_up_by", data.signed_up_by || "team");
  if (data.account) rec.set("account", data.account);
  if (data.age_group) rec.set("age_group", String(data.age_group).toUpperCase());
  if (data.klass || data.class) rec.set("klass", String(data.klass || data.class).toUpperCase());
  if (data.notes != null) rec.set("notes", data.notes);
  if (data.paid != null) rec.set("paid", data.paid === true || data.paid === "true" || data.paid === "1");
  if (data.registered_at) rec.set("registered_at", data.registered_at);
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
  rec.set("format", body.format && body.format !== "imported" ? body.format : "pool-to-bracket");
  rec.set("bracket_flights", body.bracket_flights || "none");
  rec.set("bracket_mode", body.bracket_mode || "standings");
  try { require(__hooks + "/schedule.js").persistBracketPlan(app, rec, body); } catch (err) {}
  rec.set("source", source);
  rec.set("signup_open", body.signup_open !== false);
  rec.set("auto_sync", false);
  rec.set("pitch_limit_ip", Number(body.pitch_limit_ip || 0));
  rec.set("pitch_limit_mode", body.pitch_limit_mode || "none");
  rec.set("rain_status", body.rain_status || "clear");
  applyAgeGroups(rec, body.age_groups != null || body.age_class != null || body.age_split != null || body.age_group != null || body.ages != null ? body : { ages: body.ages || "10U" });
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
    const diamond = require(__hooks + "/diamond.js");
    const supplied = body.tiebreak_order != null ? body.tiebreak_order : body.tiebreak;
    diamond.saveTiebreak(rec, supplied != null ? { tiebreak_order: supplied, tiebreak_explicit: true } : { tiebreak_order: "record,h2h,ra,diff,rs", tiebreak_explicit: true });
  } catch (err) {
    rec.set("tiebreak", { order: ["record", "h2h", "ra", "diff", "rs"], explicit: true });
  }
  app.save(rec);
  schedule.saveEventFields(app, rec, body);
  writeLog(app, rec.id, "event", true, source === "tourneymachine" ? tm.note : "Native tournament opened");
  return { event: eventJson(rec, app, auth), note: tm.note || "Tournament is live. Teams can join with or without GameChanger." };
}

function signupTeam(app, event, body, auth) {
  if (!event.get("signup_open")) throw new BadRequestError("Signup is closed for this event");
  if (!auth) {
    throw new UnauthorizedError("Log in and create your team before signing up for an event.");
  }
  const sb = require(__hooks + "/softball.js");
  if (!sb.isVerifiedAccount(auth)) {
    throw new ForbiddenError("Confirm your email before signing up a team.");
  }
  const master = loadMasterTeam(app, body);
  const gcUrl = (body.gamechanger_url || "").trim();
  if (gcUrl && !isGameChangerUrl(gcUrl)) {
    throw new BadRequestError("If you link a stats page, it must be a GameChanger URL (gc.com or web.gc.com).");
  }
  const director = sb.isEventAdmin(event, auth, app);
  const asDirector = director && (body.as_director === true || body.as_director === "true" || body.as_director === "director");
  const owns = auth.get("team") === master.id;
  let coOwner = false;
  try { coOwner = require(__hooks + "/contacts.js").isCoOwner(app, master.id, auth); } catch (err) {}
  if (!asDirector && !owns && !coOwner) {
    throw new ForbiddenError("Sign up the team on this account. A director adds other teams.");
  }
  if (canEditMaster(app, master, auth)) saveMasterProfile(app, master, body);
  const freshMaster = app.findRecordById("teams", master.id);
  const team = upsertEventTeam(app, event, {
    name: freshMaster.get("name"),
    team: freshMaster.id,
    pool: body.pool || "",
    gamechanger_url: freshMaster.get("gamechanger_url") || "",
    signed_up_by: asDirector ? "director" : "team",
    account: asDirector ? "" : auth.id,
    verified: true,
    age_group: body.age_group || freshMaster.get("age_group") || "",
    klass: body.klass || body.class || "",
    notes: body.notes || "",
  });
  if (!team.get("packet_status")) team.set("packet_status", "incomplete");
  const owner = findOwnerUser(app, freshMaster.id);
  if (owner && !team.get("account")) {
    team.set("account", owner.id);
  }
  app.save(team);
  const contacts = require(__hooks + "/contacts.js");
  const contact = contacts.contactJson(contacts.findForSeasonTeam(app, freshMaster.id));
  let mailResult = { sent: false, reason: "not_attempted" };
  try {
    mailResult = require(__hooks + "/mail.js").signupConfirmation(app, event, team, contact);
  } catch (err) {
    mailResult = { sent: false, reason: String(err) };
    writeLog(app, event.id, "signup_mail", false, String(err));
  }
  const row = teamJson(team, app);
  row.packet = packetSummary(app, event, team);
  row.mail = mailResult;
  row.contact = contact;
  return row;
}

function updateEventTeam(app, event, team, body, auth) {
  const sb = require(__hooks + "/softball.js");
  const contacts = require(__hooks + "/contacts.js");
  const admin = sb.isEventAdmin(event, auth, app);
  const own = contacts.canSeeEventContact(event, team, auth, app);
  if (!admin && !own) {
    throw new ForbiddenError("Only this team's coach or the director can edit the contact.");
  }
  if (admin) {
    if (body.name) {
      const name = String(body.name).trim();
      team.set("name", name);
      const next = slugify(name);
      if (next && next !== team.get("slug")) {
        try {
          app.findFirstRecordByFilter(
            "event_teams",
            "event = {:e} && slug = {:s}",
            { e: event.id, s: next },
          );
        } catch (err) {
          team.set("slug", next);
        }
      }
      const masterId = team.get("team") || "";
      if (masterId) {
        try {
          const master = app.findRecordById("teams", masterId);
          master.set("name", name);
          app.save(master);
        } catch (err) {}
      }
    }
    if (body.pool != null) team.set("pool", body.pool);
    const masterId = team.get("team") || "";
    if (masterId && body.gamechanger_url != null) {
      const master = app.findRecordById("teams", masterId);
      saveMasterProfile(app, master, { gamechanger_url: body.gamechanger_url });
      team.set("gamechanger_url", "");
      team.set("gc_team_ref", "");
      const gcUrl = String(body.gamechanger_url || "").trim();
      team.set("gc_sync_status", isGameChangerUrl(gcUrl) ? "linked" : "unlinked");
    } else if (body.gamechanger_url != null) {
      const gcUrl = String(body.gamechanger_url || "").trim();
      if (gcUrl && !isGameChangerUrl(gcUrl)) {
        throw new BadRequestError("If you link a stats page, it must be a GameChanger URL (gc.com or web.gc.com).");
      }
      team.set("gamechanger_url", gcUrl);
      team.set("gc_team_ref", gcRef(gcUrl));
      team.set("gc_sync_status", isGameChangerUrl(gcUrl) ? "linked" : "unlinked");
    }
    if (body.age_group != null) team.set("age_group", String(body.age_group || "").toUpperCase());
    if (body.klass != null || body.class != null) team.set("klass", String(body.klass || body.class || "").toUpperCase());
    if (body.notes != null) team.set("notes", body.notes);
    if (body.paid != null) team.set("paid", body.paid === true || body.paid === "true" || body.paid === "1");
    if (body.registered_at != null) team.set("registered_at", body.registered_at);
  }
  const linkedId = team.get("team") || "";
  if (linkedId) {
    try {
      const master = app.findRecordById("teams", linkedId);
      const patch = {};
      if (body.contact_name != null) patch.coach_name = body.contact_name;
      if (body.age_group != null && MASTER_AGES[String(body.age_group).toUpperCase()]) patch.age_group = body.age_group;
      if (body.coach_email != null || body.contact_email != null) {
        patch.coach_email = body.coach_email != null ? body.coach_email : body.contact_email;
      }
      if (body.coach_phone != null || body.contact_phone != null) {
        patch.coach_phone = body.coach_phone != null ? body.coach_phone : body.contact_phone;
      }
      if (body.alt_name != null) patch.alt_name = body.alt_name;
      if (body.alt_email != null) patch.alt_email = body.alt_email;
      if (body.alt_phone != null) patch.alt_phone = body.alt_phone;
      if (body.co_owners != null) patch.co_owners = body.co_owners;
      saveMasterProfile(app, master, patch);
      if (body.owner_email) transferTeam(app, master, body.owner_email, auth);
    } catch (err) {
      if (err && err.status) throw err;
      throw err;
    }
  } else {
    if (body.contact_name != null) team.set("contact_name", body.contact_name);
    if (body.contact_email != null || body.coach_email != null) {
      team.set("contact_email", String(body.coach_email || body.contact_email || "").trim().toLowerCase());
    }
    contacts.upsertForEventTeam(app, event, team, {
      coach_email: body.coach_email != null ? body.coach_email : (body.contact_email != null ? body.contact_email : undefined),
      coach_phone: body.coach_phone != null ? body.coach_phone : body.contact_phone,
      alt_name: body.alt_name,
      alt_email: body.alt_email,
      alt_phone: body.alt_phone,
      role: body.role,
    });
  }
  app.save(team);
  const row = teamJson(team, app);
  const season = linkedId ? contacts.findForSeasonTeam(app, linkedId) : null;
  row.contact = contacts.contactJson(season || contacts.findForEventTeam(app, team.id));
  return row;
}

function removeEventTeam(app, event, team, auth) {
  const sb = require(__hooks + "/softball.js");
  if (!sb.isEventAdmin(event, auth, app)) {
    throw new ForbiddenError("Only the director can remove a team from this weekend.");
  }
  const teamId = team.id;
  const name = team.get("name") || teamId;

  function involving(rec, keys) {
    for (let i = 0; i < keys.length; i++) {
      if (rec.get(keys[i]) === teamId) return true;
    }
    return false;
  }

  const schedule = app.findRecordsByFilter("event_schedule", "event = {:e}", "", 2000, 0, { e: event.id });
  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    if (!involving(row, ["home", "away"])) continue;
    if (row.get("status") === "final") {
      throw new BadRequestError("This team has a final pool game. Keep the score on the board; you cannot remove them.");
    }
  }
  const tree = app.findRecordsByFilter("bracket_games", "event = {:e}", "", 2000, 0, { e: event.id });
  for (let i = 0; i < tree.length; i++) {
    const row = tree[i];
    if (!involving(row, ["home_team", "away_team", "winner"])) continue;
    if (row.get("status") === "final") {
      throw new BadRequestError("This team has a final bracket game. Keep the score on the board; you cannot remove them.");
    }
  }

  for (let i = 0; i < schedule.length; i++) {
    const row = schedule[i];
    if (!involving(row, ["home", "away"])) continue;
    try {
      const boxes = app.findRecordsByFilter("event_boxes", "schedule_row = {:g}", "", 20, 0, { g: row.id });
      for (let b = 0; b < boxes.length; b++) app.delete(boxes[b]);
    } catch (err) {}
    app.delete(row);
  }
  for (let i = 0; i < tree.length; i++) {
    const row = tree[i];
    let changed = false;
    if (row.get("home_team") === teamId) {
      row.set("home_team", "");
      changed = true;
    }
    if (row.get("away_team") === teamId) {
      row.set("away_team", "");
      changed = true;
    }
    if (row.get("winner") === teamId) {
      row.set("winner", "");
      changed = true;
    }
    if (changed) app.save(row);
  }

  function deleteWhere(collection, filter, params) {
    try {
      const rows = app.findRecordsByFilter(collection, filter, "", 200, 0, params);
      for (let i = 0; i < rows.length; i++) app.delete(rows[i]);
    } catch (err) {}
  }
  deleteWhere("team_contacts", "event_team = {:t}", { t: teamId });
  deleteWhere("team_docs", "event_team = {:t}", { t: teamId });
  let players = [];
  try {
    players = app.findRecordsByFilter("event_players", "event_team = {:t}", "", 200, 0, { t: teamId });
  } catch (err) {}
  for (let i = 0; i < players.length; i++) {
    deleteWhere("event_hitting", "event_player = {:p}", { p: players[i].id });
    deleteWhere("event_pitching", "event_player = {:p}", { p: players[i].id });
    app.delete(players[i]);
  }
  app.delete(team);
  writeLog(app, event.id, "event", true, "Removed team " + name);
  return { deleted: teamId, name: name };
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

const RESET_MS = 60 * 60 * 1000;
const VERIFY_MS = 48 * 60 * 60 * 1000;

function expiresAt(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function freshStamp(raw) {
  const ms = Date.parse(String(raw || ""));
  return !!ms && ms > Date.now();
}

function registerAccount(app, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const passwordConfirm = String(body.passwordConfirm || "");
  const name = String(body.display_name || body.name || "").trim();
  if (!email || password.length < 8) {
    throw new BadRequestError("Email and a password of at least 8 characters are required");
  }
  if (!passwordConfirm || passwordConfirm !== password) {
    throw new BadRequestError("Type the same password in both password fields.");
  }
  const intent = body.intent === "team" ? "team_coach" : "event_td";
  if (intent !== "team_coach" && intent !== "event_td") {
    throw new BadRequestError("Choose a director or team account.");
  }
  const rec = new Record(app.findCollectionByNameOrId("users"));
  rec.set("email", email);
  rec.set("password", password);
  rec.set("passwordConfirm", password);
  rec.set("role", intent);
  rec.set("display_name", name);
  rec.set("verified", false);
  const mail = require(__hooks + "/mail.js");
  const token = mail.randomToken(48);
  rec.set("verify_token", token);
  rec.set("verify_expires", expiresAt(VERIFY_MS));
  rec.set("reset_token", "");
  rec.set("reset_expires", "");
  app.save(rec);
  try { claimPendingTeam(app, rec); } catch (err) {}
  try { linkCoOwnerUsers(app, rec); } catch (err) {}
  let verifySent = false;
  let verifyReason = "";
  const out = mail.directorVerify(app, rec, token);
  if (out && out.sent) verifySent = true;
  else verifyReason = (out && out.reason) || "not_sent";
  return {
    id: rec.id,
    email: rec.email(),
    role: rec.get("role"),
    display_name: rec.get("display_name") || "",
    verified: !!rec.get("verified"),
    verify_sent: verifySent,
    verify_reason: verifyReason,
  };
}

function verifyAccount(app, token) {
  const t = String(token || "").trim();
  if (!t) throw new BadRequestError("Missing verify token");
  let user;
  try {
    user = app.findFirstRecordByFilter("users", "verify_token = {:t}", { t: t });
  } catch (err) {
    throw new BadRequestError("That confirmation link is expired or already used.");
  }
  if (!freshStamp(user.get("verify_expires"))) {
    throw new BadRequestError("That confirmation link is expired or already used.");
  }
  user.set("verified", true);
  user.set("verify_token", "");
  user.set("verify_expires", "");
  app.save(user);
  try { require(__hooks + "/softball.js").linkCoOwnerAccount(app, user); } catch (err) {}
  try { claimPendingTeam(app, user); } catch (err) {}
  try { linkCoOwnerUsers(app, user); } catch (err) {}
  const welcome = require(__hooks + "/mail.js").directorWelcome(app, user);
  return { verified: true, email: user.email(), welcome_sent: !!(welcome && welcome.sent), welcome_reason: (welcome && welcome.reason) || "" };
}

function searchEvents(app, q) {
  const needle = String(q || "").trim().toLowerCase();
  const seen = {};
  const out = [];
  function pushRec(rec) {
    if (!rec || seen[rec.id]) return;
    if (!rec.get("public") || rec.get("status") === "archived") return;
    seen[rec.id] = true;
    out.push(eventJson(rec, app));
  }
  if (needle) {
    try {
      pushRec(app.findFirstRecordByData("events", "slug", needle));
    } catch (err) {}
    try {
      const rows = app.findRecordsByFilter(
        "events",
        "public = true && status != 'archived' && (name ~ {:q} || venue ~ {:q} || ages ~ {:q} || slug ~ {:q})",
        "-start",
        80,
        0,
        { q: needle },
      );
      for (let i = 0; i < rows.length; i++) pushRec(rows[i]);
    } catch (err) {}
    return out;
  }
  try {
    const rows = app.findRecordsByFilter("events", "public = true && status != 'archived'", "-start", 80, 0);
    for (let i = 0; i < rows.length; i++) pushRec(rows[i]);
  } catch (err) {}
  return out;
}

function eventCardJson(rec, app, auth, extra) {
  const sb = require(__hooks + "/softball.js");
  let admin = false;
  try { admin = !!(auth && sb.isEventAdmin(rec, auth, app)); } catch (err) { admin = false; }
  const out = {
    id: rec.id,
    name: rec.get("name") || "",
    slug: rec.get("slug") || "",
    venue: rec.get("venue") || "",
    ages: rec.get("ages") || "",
    status: rec.get("status") || "",
    public: !!rec.get("public"),
    signup_open: !!rec.get("signup_open"),
    created_by: rec.get("created_by") || "",
    can_admin: admin,
    start: dateStr(rec.get("start")),
    end: dateStr(rec.get("end")),
  };
  if (extra) {
    const keys = Object.keys(extra);
    for (let i = 0; i < keys.length; i++) out[keys[i]] = extra[keys[i]];
  }
  return out;
}

function accountUserJson(auth, siteAdmin) {
  const sb = require(__hooks + "/softball.js");
  let email = "";
  try { email = sb.normalizeEmail(auth.email()); } catch (err) { email = ""; }
  let role = "";
  try { role = auth.get("role") || ""; } catch (err) { role = ""; }
  let display = "";
  try { display = auth.get("display_name") || ""; } catch (err) { display = ""; }
  let verified = false;
  try { verified = sb.isVerifiedAccount(auth); } catch (err) { verified = !!siteAdmin; }
  return {
    id: auth.id,
    email: email,
    role: siteAdmin ? "region_admin" : role,
    display_name: display || (siteAdmin ? "Site admin" : ""),
    site_admin: !!siteAdmin,
    verified: verified,
  };
}

function accountHome(app, auth) {
  const sb = require(__hooks + "/softball.js");
  let siteAdmin = false;
  try { siteAdmin = sb.isSiteAdmin(auth); } catch (err) { siteAdmin = false; }
  const created = [];
  const seenCreated = {};
  try {
    const filter = siteAdmin ? "" : "created_by = {:u}";
    const rows = app.findRecordsByFilter("events", filter, "-id", 200, 0, { u: auth.id });
    for (let i = 0; i < rows.length; i++) {
      try {
        seenCreated[rows[i].id] = true;
        created.push(eventCardJson(rows[i], app, auth));
      } catch (err) {}
    }
  } catch (err) {}
  if (!siteAdmin) {
    try {
      const email = sb.normalizeEmail(auth.email());
      const rows = app.findRecordsByFilter(
        "event_co_owners",
        "account = {:u} || email = {:e}",
        "email",
        80,
        0,
        { u: auth.id, e: email },
      );
      for (let i = 0; i < rows.length; i++) {
        const evId = rows[i].get("event");
        if (!evId || seenCreated[evId]) continue;
        seenCreated[evId] = true;
        try {
          created.push(eventCardJson(app.findRecordById("events", evId), app, auth));
        } catch (err) {}
      }
    } catch (err) {}
  }
  const joined = [];
  const seen = {};
  try {
    const teamId = auth.get("team") || "";
    const joinedFilter = teamId
      ? "account = {:u} || contact_email = {:e} || team = {:t}"
      : "account = {:u} || contact_email = {:e}";
    const teams = app.findRecordsByFilter(
      "event_teams",
      joinedFilter,
      "name",
      80,
      0,
      { u: auth.id, e: auth.email(), t: teamId },
    );
    for (const t of teams) {
      const evId = t.get("event");
      if (!evId || seen[evId]) continue;
      seen[evId] = true;
      try {
        const row = eventCardJson(app.findRecordById("events", evId), app);
        row.team_name = t.get("name");
        row.gc_linked = isGameChangerUrl(linkedGcUrl(app, t));
        joined.push(row);
      } catch (err) {}
    }
  } catch (err) {}
  let following = { teams: [], tournaments: [] };
  try {
    following = require(__hooks + "/follow.js").listFollowing(app, auth);
  } catch (err) {
    following = { teams: [], tournaments: [] };
  }
  const user = accountUserJson(auth, siteAdmin);
  user.team = (function () {
    let teamId = "";
    try { teamId = auth.get("team") || ""; } catch (err) { teamId = ""; }
    if (!teamId) return null;
    try {
      return masterProfile(app, app.findRecordById("teams", teamId), auth);
    } catch (err) {
      return null;
    }
  })();
  return {
    user: user,
    created: created,
    joined: joined,
    following: following,
  };
}

function listAdminEvents(app) {
  const out = [];
  try {
    const rows = app.findRecordsByFilter("events", "", "-start", 400, 0);
    for (let i = 0; i < rows.length; i++) {
      try { out.push(eventCardJson(rows[i], app)); } catch (err) {}
    }
  } catch (err) {}
  return out;
}

function archiveEvent(app, event) {
  event.set("status", "archived");
  event.set("public", false);
  event.set("signup_open", false);
  app.save(event);
  writeLog(app, event.id, "event", true, "Site admin removed " + event.get("slug") + " from the public board");
  return eventJson(event, app);
}

function wipeByEvent(app, name, eventId) {
  for (let guard = 0; guard < 40; guard++) {
    let rows = [];
    try {
      rows = app.findRecordsByFilter(name, "event = {:e}", "", 200, 0, { e: eventId });
    } catch (err) {
      return;
    }
    if (!rows || !rows.length) return;
    for (let i = 0; i < rows.length; i++) {
      try { app.delete(rows[i]); } catch (err) { return; }
    }
    if (rows.length < 200) return;
  }
}

function deleteEvent(app, event, body) {
  const slug = event.get("slug");
  if (body.confirm !== true && body.confirm !== "true") {
    throw new BadRequestError("Confirm the delete. This cannot be undone.");
  }
  if (String(body.slug || "") !== slug) {
    throw new BadRequestError("Type the tournament slug to delete it.");
  }
  const eventId = event.id;
  writeLog(app, eventId, "event", true, "Site admin deleted " + slug);
  try {
    const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "", 2000, 0, { e: eventId });
    for (let i = 0; i < teams.length; i++) {
      try {
        const docs = app.findRecordsByFilter("team_docs", "event_team = {:t}", "", 40, 0, { t: teams[i].id });
        for (let j = 0; j < docs.length; j++) app.delete(docs[j]);
      } catch (err) {}
    }
  } catch (err) {}
  const children = [
    "event_hitting", "event_pitching", "event_boxes", "box_submissions", "event_schedule",
    "bracket_games", "venue_photos", "sync_log", "team_contacts", "event_teams",
    "pools", "fields", "event_co_owners",
  ];
  for (let i = 0; i < children.length; i++) wipeByEvent(app, children[i], eventId);
  app.delete(event);
  return { ok: true, slug: slug, deleted: true };
}

function requestPasswordReset(app, email) {
  const addr = String(email || "").trim().toLowerCase();
  const mail = require(__hooks + "/mail.js");
  const configured = !!mail.senderConfigured(app);
  if (!addr || addr.indexOf("@") === -1) {
    return { ok: true, mail: configured ? "sent" : "not_configured" };
  }
  const token = mail.randomToken(48);
  const exp = expiresAt(RESET_MS);
  let rec = null;
  let collection = "users";
  try { rec = app.findAuthRecordByEmail("users", addr); } catch (err) {}
  if (!rec) {
    try {
      rec = app.findAuthRecordByEmail("_superusers", addr);
      collection = "_superusers";
    } catch (err) {}
  }
  if (!rec) return { ok: true, mail: configured ? "sent" : "not_configured" };
  if (collection === "users") {
    rec.set("reset_token", token);
    rec.set("reset_expires", exp);
    app.save(rec);
  } else {
    try {
      const old = app.findRecordsByFilter("login_resets", "record_id = {:id}", "", 20, 0, { id: rec.id });
      for (let i = 0; i < old.length; i++) app.delete(old[i]);
    } catch (err) {}
    const row = new Record(app.findCollectionByNameOrId("login_resets"));
    row.set("token", token);
    row.set("collection", collection);
    row.set("record_id", rec.id);
    row.set("expires", exp);
    app.save(row);
  }
  if (configured) mail.passwordReset(app, rec.email(), token);
  return { ok: true, mail: configured ? "sent" : "not_configured" };
}

function resendVerification(app, auth) {
  if (!auth) throw new UnauthorizedError("login required");
  try { if (auth.isSuperuser()) return { ok: true, verified: true }; } catch (err) {}
  if (auth.get("verified")) return { ok: true, verified: true };
  const mail = require(__hooks + "/mail.js");
  const token = mail.randomToken(48);
  auth.set("verify_token", token);
  auth.set("verify_expires", expiresAt(VERIFY_MS));
  app.save(auth);
  const out = mail.directorVerify(app, auth, token);
  return {
    ok: true,
    verified: false,
    verify_sent: !!(out && out.sent),
    verify_reason: (out && out.reason) || "",
    mail: mail.senderConfigured(app) ? ((out && out.sent) ? "sent" : "failed") : "not_configured",
  };
}

function confirmPasswordReset(app, token, password) {
  const key = String(token || "").trim();
  const pass = String(password || "");
  if (!key) throw new BadRequestError("That reset link is missing a token.");
  if (pass.length < 8) throw new BadRequestError("Use a password of at least 8 characters.");
  let rec = null;
  let userRow = null;
  try { userRow = app.findFirstRecordByFilter("users", "reset_token = {:t}", { t: key }); } catch (err) {}
  if (userRow) {
    if (userRow.get("reset_token") !== key || !freshStamp(userRow.get("reset_expires"))) {
      throw new BadRequestError("That reset link is expired or already used.");
    }
    rec = userRow;
  }
  if (!rec) {
    let row = null;
    try { row = app.findFirstRecordByFilter("login_resets", "token = {:t}", { t: key }); } catch (err) {}
    if (row) {
      if (!freshStamp(row.get("expires"))) {
        try { app.delete(row); } catch (err) {}
        throw new BadRequestError("That reset link is expired or already used.");
      }
      rec = app.findRecordById(row.get("collection"), row.get("record_id"));
      app.delete(row);
    }
  }
  if (!rec) throw new BadRequestError("That reset link is expired or already used.");
  rec.set("password", pass);
  rec.set("passwordConfirm", pass);
  try {
    if (rec.collection().name === "users") {
      rec.set("reset_token", "");
      rec.set("reset_expires", "");
    }
  } catch (err) {}
  app.save(rec);
  return { ok: true };
}

function syncGameChangerTeam(app, team) {
  const url = linkedGcUrl(app, team);
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
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 500, 0, { e: event.id });
  for (const team of teams) {
    const r = syncGameChangerTeam(app, team);
    results.push({ kind: "gamechanger", team: team.get("name"), ok: r.ok, status: r.status });
  }
  writeLog(app, event.id, "gamechanger", results.every(function (r) { return r.kind !== "gamechanger" || r.ok; }), "Synced " + teams.length + " GameChanger links");
  return results;
}

function publicRoster(app, event, auth) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 500, 0, { e: event.id });
  return teams.map(function (t) {
    const row = teamJson(t, app);
    row.packet = packetSummary(app, event, t, canSeeTeamPacket(event, t, auth, app));
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

function eachPage(app, collection, filter, sort, params, fn) {
  let offset = 0;
  for (let guard = 0; guard < 40; guard++) {
    const rows = app.findRecordsByFilter(collection, filter || "id != ''", sort || "", 200, offset, params || {});
    if (!rows || !rows.length) return;
    for (let i = 0; i < rows.length; i++) fn(rows[i]);
    if (rows.length < 200) return;
    offset += rows.length;
  }
}

function listClubs(app) {
  const out = [];
  eachPage(app, "club_teams", "id != ''", "name", null, function (rec) {
    if (out.length < 2000) out.push(clubJson(rec));
  });
  return out;
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

function confirmed(body) {
  return !!(body && (body.confirm === true || body.confirm === "true"));
}

function removeClub(app, id, body) {
  if (!confirmed(body)) throw new BadRequestError("Confirm the remove. Weekend teams and scores stay.");
  const club = app.findRecordById("club_teams", id);
  const name = club.get("name") || "";
  let unlinked = 0;
  for (let guard = 0; guard < 40; guard++) {
    let rows = [];
    try {
      rows = app.findRecordsByFilter("event_teams", "club = {:c}", "", 200, 0, { c: id });
    } catch (err) {
      break;
    }
    if (!rows || !rows.length) break;
    for (let i = 0; i < rows.length; i++) {
      rows[i].set("club", "");
      app.save(rows[i]);
      unlinked++;
    }
    if (rows.length < 200) break;
  }
  app.delete(club);
  return { ok: true, id: id, name: name, unlinked: unlinked };
}

function normTeamName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normGcKey(url) {
  if (!isGameChangerUrl(url)) return "";
  return gcRef(url).toLowerCase();
}

function countWhere(app, collection, filter, params) {
  try {
    const rows = app.findRecordsByFilter(collection, filter, "", 1, 0, params || {});
    return rows && rows.length ? rows.length : 0;
  } catch (err) {
    return 0;
  }
}

function masterHasFinal(app, eventTeamId) {
  try {
    const games = app.findRecordsByFilter(
      "event_schedule",
      "home = {:t} || away = {:t}",
      "",
      200,
      0,
      { t: eventTeamId },
    );
    for (let i = 0; i < games.length; i++) {
      if (games[i].get("status") === "final") return true;
    }
  } catch (err) {}
  try {
    const tree = app.findRecordsByFilter(
      "bracket_games",
      "home_team = {:t} || away_team = {:t} || winner = {:t}",
      "",
      200,
      0,
      { t: eventTeamId },
    );
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].get("status") === "final") return true;
    }
  } catch (err) {}
  return false;
}

function removeMasterTeam(app, id, body) {
  if (!confirmed(body)) throw new BadRequestError("Confirm the remove.");
  const team = app.findRecordById("teams", id);
  const name = team.get("name") || "";
  if (countWhere(app, "players", "team = {:t}", { t: id })) {
    throw new BadRequestError("This team has a roster. It stays.");
  }
  if (countWhere(app, "team_games", "team = {:t}", { t: id })) {
    throw new BadRequestError("This team has a season book. It stays.");
  }
  if (countWhere(app, "staging_games", "team = {:t}", { t: id })) {
    throw new BadRequestError("This team has a score sheet waiting for review. It stays.");
  }
  const weekends = [];
  try {
    eachPage(app, "event_teams", "team = {:t}", "", { t: id }, function (row) {
      weekends.push(row);
    });
  } catch (err) {}
  for (let i = 0; i < weekends.length; i++) {
    if (masterHasFinal(app, weekends[i].id)) {
      throw new BadRequestError("This team has a final game. It stays.");
    }
  }
  clearOwners(app, id, "");
  for (let i = 0; i < weekends.length; i++) {
    const row = app.findRecordById("event_teams", weekends[i].id);
    row.set("team", "");
    app.save(row);
  }
  app.delete(team);
  return { ok: true, id: id, name: name, unlinked: weekends.length };
}

function listAdminMasters(app) {
  const owned = {};
  const pending = {};
  try {
    eachPage(app, "users", "team != ''", "", null, function (user) {
      const teamId = user.get("team");
      if (teamId) owned[teamId] = true;
    });
  } catch (err) {}
  try {
    eachPage(app, "team_contacts", "pending_owner_email != '' && team != ''", "", null, function (row) {
      if (row.get("event_team")) return;
      const teamId = row.get("team");
      if (teamId) pending[teamId] = true;
    });
  } catch (err) {}
  const out = [];
  let truncated = false;
  eachPage(app, "teams", "id != ''", "name", null, function (rec) {
    if (out.length >= 2000) {
      truncated = true;
      return;
    }
    const row = masterTeamJson(rec);
    row.owner_state = owned[rec.id] ? "owner" : (pending[rec.id] ? "pending" : "none");
    out.push(row);
  });
  return { teams: out, truncated: truncated };
}

function loadUnlinkedEventTeams(app) {
  const out = [];
  const seen = {};
  function take(row) {
    if (!row || seen[row.id] || row.get("team")) return;
    seen[row.id] = true;
    out.push(row);
  }
  try {
    eachPage(app, "event_teams", "team = ''", "name", null, take);
  } catch (err) {
    eachPage(app, "event_teams", "id != ''", "name", null, take);
  }
  return out;
}

function eventLabel(app, id, cache) {
  if (!id) return { name: "", slug: "" };
  if (cache[id]) return cache[id];
  try {
    const event = app.findRecordById("events", id);
    cache[id] = { name: event.get("name") || "", slug: event.get("slug") || "" };
  } catch (err) {
    cache[id] = { name: "", slug: "" };
  }
  return cache[id];
}

function pushIndex(map, key, ref) {
  if (!key) return;
  if (!map[key]) map[key] = [];
  map[key].push(ref);
}

function leftoverPlan(app) {
  const byGc = {};
  const byName = {};
  eachPage(app, "teams", "id != ''", "name", null, function (rec) {
    const ref = {
      id: rec.id,
      key: "",
      name: rec.get("name") || "",
    };
    pushIndex(byGc, normGcKey(rec.get("gamechanger_url")), ref);
    pushIndex(byName, normTeamName(rec.get("name")), ref);
  });
  const rows = loadUnlinkedEventTeams(app);
  const buckets = {};
  const order = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const gc = normGcKey(row.get("gamechanger_url"));
    const nameKey = normTeamName(row.get("name"));
    let match = "";
    let key = "";
    if (gc) {
      match = "gamechanger";
      key = "gc:" + gc;
    } else if (nameKey) {
      match = "name";
      key = "name:" + nameKey;
    } else {
      match = "skip";
      key = "blank:" + row.id;
    }
    if (!buckets[key]) {
      buckets[key] = { key: key, match: match, rows: [], gc: gc, nameKey: nameKey };
      order.push(key);
    }
    buckets[key].rows.push(row);
  }
  const gcKeys = [];
  const nameKeys = [];
  for (let i = 0; i < order.length; i++) {
    const bucket = buckets[order[i]];
    if (bucket.match === "gamechanger") gcKeys.push(order[i]);
    else nameKeys.push(order[i]);
  }
  const labels = {};
  const groups = [];
  function decide(key) {
    const bucket = buckets[key];
    const display = String((bucket.rows[0] && bucket.rows[0].get("name")) || "").trim();
    let gcUrl = "";
    for (let i = 0; i < bucket.rows.length; i++) {
      const url = String(bucket.rows[i].get("gamechanger_url") || "").trim();
      if (normGcKey(url)) {
        gcUrl = url;
        break;
      }
    }
    const weekends = [];
    for (let i = 0; i < bucket.rows.length; i++) {
      const row = bucket.rows[i];
      const event = eventLabel(app, row.get("event"), labels);
      weekends.push({
        id: row.id,
        name: row.get("name") || "",
        event_name: event.name,
        event_slug: event.slug,
      });
    }
    const group = {
      key: key,
      match: bucket.match,
      action: "skip",
      reason: "",
      master_id: "",
      master_key: "",
      master_name: "",
      name: display,
      gamechanger_url: gcUrl,
      weekends: weekends,
    };
    if (bucket.match === "skip") {
      group.reason = "This weekend team has no name.";
      groups.push(group);
      return;
    }
    const index = bucket.match === "gamechanger" ? byGc[bucket.gc] : byName[bucket.nameKey];
    if (index && index.length > 1) {
      group.reason = bucket.match === "gamechanger"
        ? "More than one master team already has this GameChanger link."
        : "More than one master team already uses this exact name.";
      groups.push(group);
      return;
    }
    if (index && index.length === 1) {
      group.action = "link";
      group.master_id = index[0].id || "";
      group.master_key = index[0].key || "";
      group.master_name = index[0].name || "";
      groups.push(group);
      return;
    }
    group.action = "create";
    group.master_name = display;
    const virtual = { id: "", key: key, name: display };
    pushIndex(byName, bucket.nameKey, virtual);
    pushIndex(byGc, bucket.gc, virtual);
    groups.push(group);
  }
  for (let i = 0; i < gcKeys.length; i++) decide(gcKeys[i]);
  for (let i = 0; i < nameKeys.length; i++) decide(nameKeys[i]);
  return groups;
}

function leftoverPreview(groups) {
  const events = {};
  let willLink = 0;
  let willCreate = 0;
  let createRows = 0;
  let skipped = 0;
  const listed = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const n = group.weekends.length;
    if (group.action === "link") willLink += n;
    else if (group.action === "create") {
      willCreate++;
      createRows += n;
    } else skipped += n;
    for (let w = 0; w < group.weekends.length; w++) {
      const slug = group.weekends[w].event_slug || "";
      if (!events[slug]) {
        events[slug] = { slug: slug, name: group.weekends[w].event_name || slug, rows: 0 };
      }
      events[slug].rows++;
    }
    if (listed.length < 80) {
      listed.push({
        match: group.match,
        action: group.action,
        reason: group.reason,
        name: group.name,
        master_name: group.master_name,
        weekends: group.weekends,
      });
    }
  }
  const eventList = [];
  for (const slug in events) eventList.push(events[slug]);
  eventList.sort(function (a, b) {
    const left = String(a.name || "");
    const right = String(b.name || "");
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  let unlinked = 0;
  for (let i = 0; i < eventList.length; i++) unlinked += eventList[i].rows;
  return {
    unlinked: unlinked,
    will_link: willLink,
    will_create: willCreate,
    create_rows: createRows,
    skipped: skipped,
    events: eventList,
    groups: listed,
    groups_truncated: listed.length < groups.length,
  };
}

function actorUserId(auth) {
  if (!auth) return "";
  try {
    if (!auth.collection || auth.collection().name !== "users") return "";
  } catch (err) {
    return "";
  }
  return auth.id || "";
}

function fillMasterFromWeekends(app, master, rowIds) {
  const patch = {};
  if (!master.get("coach_name")) {
    for (let i = 0; i < rowIds.length; i++) {
      try {
        const name = String(app.findRecordById("event_teams", rowIds[i]).get("contact_name") || "").trim();
        if (name) {
          patch.coach_name = name;
          break;
        }
      } catch (err) {}
    }
  }
  if (!master.get("age_group")) {
    for (let i = 0; i < rowIds.length; i++) {
      try {
        const age = String(app.findRecordById("event_teams", rowIds[i]).get("age_group") || "").toUpperCase();
        if (MASTER_AGES[age]) {
          patch.age_group = age;
          break;
        }
      } catch (err) {}
    }
  }
  if (!normGcKey(master.get("gamechanger_url"))) {
    for (let i = 0; i < rowIds.length; i++) {
      try {
        const url = String(app.findRecordById("event_teams", rowIds[i]).get("gamechanger_url") || "").trim();
        if (normGcKey(url)) {
          patch.gamechanger_url = url;
          break;
        }
      } catch (err) {}
    }
  }
  const contacts = require(__hooks + "/contacts.js");
  const season = contacts.findForSeasonTeam(app, master.id);
  let email = season ? String(season.get("coach_email") || "").trim() : "";
  let phone = season ? String(season.get("coach_phone") || "").trim() : "";
  if (!email || !phone) {
    for (let i = 0; i < rowIds.length && (!email || !phone); i++) {
      let row = null;
      try { row = app.findRecordById("event_teams", rowIds[i]); } catch (err) { continue; }
      if (!email) email = String(row.get("contact_email") || "").trim();
      const eventContact = contacts.findForEventTeam(app, row.id);
      if (eventContact) {
        if (!email) email = String(eventContact.get("coach_email") || "").trim();
        if (!phone) phone = String(eventContact.get("coach_phone") || "").trim();
      }
    }
  }
  if (email && !(season && season.get("coach_email"))) patch.coach_email = email;
  if (phone && !(season && season.get("coach_phone"))) patch.coach_phone = phone;
  if (Object.keys(patch).length) saveMasterProfile(app, master, patch);
  return master;
}

function createMasterFromGroup(app, auth, group) {
  const rec = new Record(app.findCollectionByNameOrId("teams"));
  rec.set("name", group.name || "Team");
  rec.set("slug", uniqueTeamSlug(app, slugify(group.name || "team")));
  const actor = actorUserId(auth);
  if (actor) rec.set("created_by", actor);
  rec.set("public_record_wins", 0);
  rec.set("public_record_losses", 0);
  rec.set("public_record_ties", 0);
  app.save(rec);
  return rec;
}

function applyLeftoverPlan(app, auth, groups) {
  const created = {};
  let attached = 0;
  let made = 0;
  let skipped = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group.action === "skip") {
      skipped += group.weekends.length;
      continue;
    }
    let master = null;
    try {
      if (group.action === "create") {
        master = createMasterFromGroup(app, auth, group);
        created[group.key] = master;
        made++;
      } else if (group.master_id) {
        master = app.findRecordById("teams", group.master_id);
      } else if (group.master_key && created[group.master_key]) {
        master = created[group.master_key];
      }
    } catch (err) {
      skipped += group.weekends.length;
      continue;
    }
    if (!master) {
      skipped += group.weekends.length;
      continue;
    }
    const ids = [];
    for (let w = 0; w < group.weekends.length; w++) {
      let row = null;
      try { row = app.findRecordById("event_teams", group.weekends[w].id); } catch (err) { continue; }
      if (row.get("team")) continue;
      row.set("team", master.id);
      app.save(row);
      ids.push(row.id);
      attached++;
    }
    if (ids.length) {
      try { fillMasterFromWeekends(app, app.findRecordById("teams", master.id), ids); } catch (err) {}
    }
  }
  return { attached: attached, created: made, skipped: skipped };
}

function selectedEventSlugs(body) {
  if (!body || body.events == null) return null;
  const only = {};
  const list = typeof body.events === "string" ? [body.events] : body.events;
  if (!list || !list.length) return only;
  for (let i = 0; i < list.length; i++) {
    const slug = String(list[i] || "").trim();
    if (slug) only[slug] = true;
  }
  return only;
}

function groupsForEvents(groups, only) {
  if (!only) return groups;
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const weekends = [];
    for (let w = 0; w < group.weekends.length; w++) {
      if (only[group.weekends[w].event_slug]) weekends.push(group.weekends[w]);
    }
    if (!weekends.length) continue;
    out.push({
      key: group.key,
      match: group.match,
      action: group.action,
      reason: group.reason,
      master_id: group.master_id,
      master_key: group.master_key,
      master_name: group.master_name,
      name: group.name,
      gamechanger_url: group.gamechanger_url,
      weekends: weekends,
    });
  }
  return out;
}

function attachLeftovers(app, auth, body) {
  const groups = leftoverPlan(app);
  if (!confirmed(body)) return leftoverPreview(groups);
  const chosen = groupsForEvents(groups, selectedEventSlugs(body));
  const applied = applyLeftoverPlan(app, auth, chosen);
  const after = leftoverPreview(leftoverPlan(app));
  return {
    ok: true,
    attached: applied.attached,
    created: applied.created,
    skipped: applied.skipped,
    unlinked: after.unlinked,
    events: after.events,
  };
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
  rec.set("age_groups", source.get("age_groups") || null);
  rec.set("age_class", source.get("age_class") || "");
  rec.set("age_split", !!source.get("age_split"));
  rec.set("public", true);
  rec.set("status", "live");
  rec.set("format", source.get("format") || "pool-to-bracket");
  rec.set("bracket_flights", source.get("bracket_flights") || "none");
  rec.set("bracket_mode", source.get("bracket_mode") || "standings");
  rec.set("bracket_plan", source.get("bracket_plan") || null);
  rec.set("source", "native");
  rec.set("signup_open", true);
  rec.set("auto_sync", false);
  rec.set("rain_status", "clear");
  rec.set("rain_note", "");
  rec.set("hours_start", source.get("hours_start") || "08:00");
  rec.set("hours_end", source.get("hours_end") || "18:00");
  rec.set("scheduler", source.get("scheduler") || null);
  try {
    const diamond = require(__hooks + "/diamond.js");
    rec.set("tiebreak", { order: diamond.parseTiebreak(source.get("tiebreak")), explicit: true });
  } catch (err) {
    rec.set("tiebreak", { order: ["record", "h2h", "ra", "diff", "rs"], explicit: true });
  }
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
  const fields = app.findRecordsByFilter("fields", "event = {:e}", "name", 2000, 0, { e: source.id });
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
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 500, 0, { e: source.id });
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
    if (t.get("team")) nt.set("team", t.get("team"));
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
      if (pools[i].get("tiebreak")) np.set("tiebreak", pools[i].get("tiebreak"));
      if (pools[i].get("ages")) np.set("ages", pools[i].get("ages"));
      if (pools[i].get("class")) np.set("class", pools[i].get("class"));
      app.save(np);
    }
  } catch (err) {}

  const games = app.findRecordsByFilter("event_schedule", "event = {:e}", "game_number", 2000, 0, { e: source.id });
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
    event: eventJson(rec, app, auth),
    source: source.get("slug"),
    teams: Object.keys(teamMap).length,
    games: games.length,
    note: "Copied teams, fields, and the unpaid schedule. Scores, boxes, and family contacts were left behind.",
  };
}

function applySettings(app, event, body, auth) {
  if (body.signup_open != null) event.set("signup_open", !!body.signup_open);
  if (body.auto_sync != null) event.set("auto_sync", !!body.auto_sync);
  if (body.venue != null) event.set("venue", body.venue);
  if (body.ages != null) event.set("ages", body.ages);
  applyAgeGroups(event, body);
  if (body.start) event.set("start", body.start);
  if (body.end) event.set("end", body.end);
  if (body.format && body.format !== "imported") event.set("format", body.format);
  if (body.bracket_flights != null || body.bracket_plan != null) {
    try { require(__hooks + "/schedule.js").persistBracketPlan(app, event, body); }
    catch (err) {
      if (body.bracket_flights != null) event.set("bracket_flights", body.bracket_flights || "none");
    }
  }
  if (body.bracket_mode != null) event.set("bracket_mode", body.bracket_mode || "standings");
  applyGuidelines(event, body);
  try {
    const diamond = require(__hooks + "/diamond.js");
    diamond.saveTiebreak(event, body);
    diamond.savePoolTiebreaks(app, event, body);
  } catch (err) {}
  const schedule = require(__hooks + "/schedule.js");
  schedule.saveScheduler(app, event, body);
  schedule.applyLocation(event, body);
  app.save(event);
  schedule.saveEventFields(app, event, body);
  return eventJson(event, app, auth, { owners: true });
}

module.exports = {
  slugify: slugify,
  uniqueSlug: uniqueSlug,
  isGameChangerUrl: isGameChangerUrl,
  isGcBoxUrl: isGcBoxUrl,
  isTourneyMachineUrl: isTourneyMachineUrl,
  eventJson: eventJson,
  teamJson: teamJson,
  writeLog: writeLog,
  upsertEventTeam: upsertEventTeam,
  parsePacket: parsePacket,
  createEvent: createEvent,
  duplicateEvent: duplicateEvent,
  signupTeam: signupTeam,
  updateEventTeam: updateEventTeam,
  removeEventTeam: removeEventTeam,
  syncEvent: syncEvent,
  publicRoster: publicRoster,
  applySettings: applySettings,
  registerAccount: registerAccount,
  createMasterTeam: createMasterTeam,
  updateMasterTeam: updateMasterTeam,
  transferTeam: transferTeam,
  masterProfile: masterProfile,
  saveMasterProfile: saveMasterProfile,
  linkedGcUrl: linkedGcUrl,
  findOrCreateMasterTeam: findOrCreateMasterTeam,
  listMasterTeams: listMasterTeams,
  verifyAccount: verifyAccount,
  fileUrl: fileUrl,
  applyAgeGroups: applyAgeGroups,
  AGE_CHOICES: AGE_CHOICES,
  searchEvents: searchEvents,
  accountHome: accountHome,
  listAdminEvents: listAdminEvents,
  archiveEvent: archiveEvent,
  deleteEvent: deleteEvent,
  requestPasswordReset: requestPasswordReset,
  confirmPasswordReset: confirmPasswordReset,
  resendVerification: resendVerification,
  listClubs: listClubs,
  saveClub: saveClub,
  removeClub: removeClub,
  listAdminMasters: listAdminMasters,
  removeMasterTeam: removeMasterTeam,
  attachLeftovers: attachLeftovers,
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
