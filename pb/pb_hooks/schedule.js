function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function addMinutes(hhmm, mins) {
  const parts = String(hhmm || "08:00").split(":");
  const total = Number(parts[0] || 0) * 60 + Number(parts[1] || 0) + Number(mins || 0);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return pad(Math.floor(wrapped / 60)) + ":" + pad(wrapped % 60);
}

function minutesOf(hhmm) {
  const parts = String(hhmm || "00:00").split(":");
  return Number(parts[0] || 0) * 60 + Number(parts[1] || 0);
}

function mapUrl(lat, lng, address) {
  if (lat && lng) return "https://maps.google.com/?q=" + lat + "," + lng;
  if (address) return "https://maps.google.com/?q=" + encodeURIComponent(address);
  return "";
}

function dateOnly(v) {
  return v ? String(v).slice(0, 10) : "";
}

function flag(v) {
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

function hasOwn(body, key) {
  return !!(body && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined && body[key] !== null);
}

function parseScheduler(raw) {
  let data = raw;
  if (data == null || data === "") data = {};
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch (err) { data = {}; }
  } else if (typeof data === "object" && data.length !== undefined && typeof data[0] === "number") {
    try {
      const sb = require(__hooks + "/softball.js");
      data = JSON.parse(sb.bytesToString(data));
    } catch (err) { data = {}; }
  }
  if (!data || typeof data !== "object" || data.length !== undefined) data = {};
  let days = data.days;
  if (typeof days === "string") {
    days = days.split(/[,\n]/).map(function (d) { return dateOnly(d.trim()); }).filter(Boolean);
  }
  if (!Array.isArray(days)) days = [];
  const origin = data.origin === "imported" || data.origin === "generated" ? data.origin : "";
  return {
    games_per_team: Number(data.games_per_team || 2) || 2,
    consolation: data.consolation !== false && data.consolation !== "false" && data.consolation !== "0",
    replace: data.replace !== false && data.replace !== "false" && data.replace !== "0",
    draw_bracket: flag(data.draw_bracket),
    origin: origin,
    days: days.map(function (d) { return dateOnly(d); }).filter(Boolean),
  };
}

function splitDays(value) {
  if (Array.isArray(value)) return value.map(function (d) { return dateOnly(d); }).filter(Boolean);
  if (typeof value === "string") {
    return value.split(/[,\n]/).map(function (d) { return dateOnly(d.trim()); }).filter(Boolean);
  }
  return [];
}

// Persist the scheduler card before a build so a redraw shows what the director
// just chose, not the hardcoded defaults.
function saveScheduler(app, event, body) {
  const current = parseScheduler(event.get("scheduler"));
  const touched = hasOwn(body, "games_per_team") || hasOwn(body, "consolation") || hasOwn(body, "replace")
    || hasOwn(body, "draw_bracket") || hasOwn(body, "days") || hasOwn(body, "start_time")
    || hasOwn(body, "end_time") || hasOwn(body, "scheduler");
  if (!touched) return current;
  const next = {
    games_per_team: current.games_per_team,
    consolation: current.consolation,
    replace: current.replace,
    draw_bracket: current.draw_bracket,
    origin: current.origin || "",
    days: current.days.slice(),
  };
  if (hasOwn(body, "scheduler") && body.scheduler && typeof body.scheduler === "object") {
    const nested = parseScheduler(body.scheduler);
    next.games_per_team = nested.games_per_team;
    next.consolation = nested.consolation;
    next.replace = nested.replace;
    next.draw_bracket = nested.draw_bracket;
    if (nested.origin) next.origin = nested.origin;
    if (nested.days.length) next.days = nested.days;
  }
  if (hasOwn(body, "games_per_team") && body.games_per_team !== "") {
    next.games_per_team = Number(body.games_per_team) || 2;
  }
  if (hasOwn(body, "consolation")) next.consolation = flag(body.consolation);
  if (hasOwn(body, "replace")) next.replace = flag(body.replace);
  if (hasOwn(body, "draw_bracket")) next.draw_bracket = flag(body.draw_bracket);
  const days = splitDays(body.days);
  if (days.length) next.days = days;
  if (body.start_time) event.set("hours_start", body.start_time);
  if (body.end_time) event.set("hours_end", body.end_time);
  if (next.days.length) {
    event.set("start", next.days[0]);
    event.set("end", next.days[next.days.length - 1]);
  }
  event.set("scheduler", next);
  app.save(event);
  return next;
}

function datesBetween(start, end) {
  const out = [];
  const first = dateOnly(start);
  if (!first) return out;
  const last = dateOnly(end) || first;
  let cur = first;
  for (let i = 0; i < 8; i++) {
    out.push(cur);
    if (cur >= last) break;
    const d = new Date(cur + "T12:00:00");
    d.setDate(d.getDate() + 1);
    cur = dateOnly(d.toISOString());
  }
  return out;
}

function parseAvail(raw) {
  if (raw == null || raw === "") return [];
  let rows = raw;
  if (typeof raw === "string") {
    try { rows = JSON.parse(raw); } catch (err) { return []; }
  } else if (typeof raw === "object" && raw.length !== undefined && typeof raw[0] === "number") {
    try {
      let s = "";
      for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
      rows = JSON.parse(s);
    } catch (err) { return []; }
  }
  if (!rows || rows.length === undefined) return [];
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.date) continue;
    out.push({
      date: dateOnly(r.date),
      available: r.available !== false && r.available !== "false" && r.available !== "0",
      start: r.start || "",
      end: r.end || "",
    });
  }
  return out;
}

function fieldWindow(event, rec, date) {
  const gStart = (event && event.get("hours_start")) || "08:00";
  const gEnd = (event && event.get("hours_end")) || "18:00";
  const status = rec.get("status") || "open";
  const closed = status === "closed" || status === "wet";
  const avail = parseAvail(rec.get("availability"));
  let hit = null;
  for (let i = 0; i < avail.length; i++) {
    if (avail[i].date === date) {
      hit = avail[i];
      break;
    }
  }
  if (!hit) {
    return { date: date, available: !closed, start: gStart, end: gEnd, inherited: true };
  }
  return {
    date: date,
    available: !closed && hit.available,
    start: hit.start || gStart,
    end: hit.end || gEnd,
    inherited: false,
  };
}

function fieldOpenAt(event, rec, date, time, gameMinutes) {
  const win = fieldWindow(event, rec, date);
  if (!win.available) return false;
  const start = minutesOf(time);
  const finish = start + Number(gameMinutes || 90);
  return start >= minutesOf(win.start) && finish <= minutesOf(win.end);
}

function fieldJson(rec, event) {
  const lat = rec.get("lat");
  const lng = rec.get("lng");
  const address = rec.get("address") || "";
  const availability = parseAvail(rec.get("availability"));
  const days = event ? datesBetween(event.get("start"), event.get("end")) : [];
  return {
    id: rec.id,
    name: rec.get("name"),
    address: address,
    lat: lat || 0,
    lng: lng || 0,
    surface: rec.get("surface") || "",
    lights: !!rec.get("lights"),
    notes: rec.get("notes") || "",
    status: rec.get("status") || "open",
    map_url: mapUrl(lat, lng, address),
    availability: availability,
    windows: days.map(function (d) { return fieldWindow(event, rec, d); }),
  };
}

function eventFields(app, eventId) {
  try {
    let event = null;
    try { event = app.findRecordById("events", eventId); } catch (miss) {}
    return app.findRecordsByFilter("fields", "event = {:e}", "name", 400, 0, { e: eventId }).map(function (rec) {
      return fieldJson(rec, event);
    });
  } catch (err) {
    return [];
  }
}

function bodyKeys(body) {
  if (!body) return [];
  try { return Object.keys(body); } catch (err) { return []; }
}

function hasFieldPayload(body) {
  if (!body) return false;
  if (body.fields != null) return true;
  if (body.replace_fields === true || body.replace_fields === "true") return true;
  const keys = bodyKeys(body);
  for (let i = 0; i < keys.length; i++) {
    if (/^field_(name|id)_\d+$/.test(String(keys[i]))) return true;
  }
  for (let i = 0; i < 256; i++) {
    if (body["field_name_" + i] || body["field_id_" + i]) return true;
  }
  return false;
}

function fieldRowFromBody(body, i) {
  const name = String(body["field_name_" + i] || "").trim();
  const id = body["field_id_" + i] || "";
  if (!name && !id) return null;
  const availability = [];
  for (let d = 0; d < 16; d++) {
    const date = String(body["field_day_" + i + "_" + d + "_date"] || "").trim();
    if (!date) continue;
    const on = body["field_day_" + i + "_" + d + "_on"];
    availability.push({
      date: date,
      available: on === true || on === "true" || on === "on" || on === "1",
      start: body["field_day_" + i + "_" + d + "_start"] || "",
      end: body["field_day_" + i + "_" + d + "_end"] || "",
    });
  }
  return {
    id: id,
    name: name,
    address: body["field_address_" + i] || "",
    lat: body["field_lat_" + i],
    lng: body["field_lng_" + i],
    pin_set: body["field_pin_set_" + i],
    surface: body["field_surface_" + i] || "",
    lights: body["field_lights_" + i],
    availability: availability,
  };
}

function parseFieldRows(body) {
  if (body.fields && typeof body.fields === "object" && body.fields.length !== undefined) {
    return body.fields;
  }
  if (typeof body.fields === "string") {
    try { return JSON.parse(body.fields); } catch (err) {}
  }
  const seen = {};
  const out = [];
  function take(i) {
    if (seen[i]) return;
    const row = fieldRowFromBody(body, i);
    if (!row) return;
    seen[i] = true;
    out.push(row);
  }
  const keys = bodyKeys(body);
  for (let k = 0; k < keys.length; k++) {
    const m = String(keys[k]).match(/^field_(?:name|id)_(\d+)$/);
    if (m) take(Number(m[1]));
  }
  if (!out.length) {
    for (let i = 0; i < 256; i++) take(i);
  }
  return out;
}

function saveField(app, event, data) {
  const name = String(data.name || "").trim();
  if (!name) throw new BadRequestError("Field name is required");
  let rec;
  if (data.id) {
    rec = app.findRecordById("fields", data.id);
  } else {
    try {
      rec = app.findFirstRecordByFilter("fields", "event = {:e} && name = {:n}", { e: event.id, n: name });
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("fields"));
      rec.set("event", event.id);
    }
  }
  rec.set("event", event.id);
  rec.set("name", name);
  if (data.address != null) rec.set("address", data.address);
  try {
    require(__hooks + "/geo.js").applyGeocode(rec, {
      address: data.address || rec.get("address") || event.get("address") || "",
      lat: data.lat,
      lng: data.lng,
      pin_set: data.pin_set,
      geocode: data.geocode,
    });
  } catch (err) {
    if (data.lat != null && data.lat !== "") rec.set("lat", Number(data.lat));
    if (data.lng != null && data.lng !== "") rec.set("lng", Number(data.lng));
  }
  if (data.surface != null) rec.set("surface", data.surface);
  if (data.lights != null) rec.set("lights", data.lights === true || data.lights === "true" || data.lights === "on");
  if (data.notes != null) rec.set("notes", data.notes);
  if (data.status) rec.set("status", data.status);
  if (!rec.get("status")) rec.set("status", "open");
  if (data.availability !== undefined) rec.set("availability", parseAvail(data.availability));
  app.save(rec);
  return fieldJson(rec, event);
}

function applyLocation(rec, body) {
  if (body.address != null) rec.set("address", body.address);
  if (body.venue != null) rec.set("venue", body.venue);
  try {
    require(__hooks + "/geo.js").applyGeocode(rec, body);
  } catch (err) {
    if (body.lat != null && body.lat !== "") rec.set("lat", Number(body.lat));
    if (body.lng != null && body.lng !== "") rec.set("lng", Number(body.lng));
  }
  if (body.format) {
    if (rec.get("format") === "imported" && body.format !== "imported") {
      const prefs = parseScheduler(rec.get("scheduler"));
      prefs.origin = "imported";
      rec.set("scheduler", prefs);
    }
    rec.set("format", body.format);
  }
  if (body.rain_note != null) rec.set("rain_note", body.rain_note);
  if (body.rain_status) rec.set("rain_status", body.rain_status);
  if (body.hours_start != null) rec.set("hours_start", body.hours_start);
  if (body.hours_end != null) rec.set("hours_end", body.hours_end);
}

function listFieldRecords(app, eventId) {
  try {
    return app.findRecordsByFilter("fields", "event = {:e}", "name", 400, 0, { e: eventId });
  } catch (err) {
    return [];
  }
}

function unlinkField(app, event, rec) {
  const fieldId = rec.id;
  const fieldName = rec.get("name") || "";
  try {
    const games = app.findRecordsByFilter("event_schedule", "event = {:e}", "", 400, 0, { e: event.id });
    for (let i = 0; i < games.length; i++) {
      const row = games[i];
      if (row.get("field") !== fieldId && row.get("field_name") !== fieldName) continue;
      row.set("field", "");
      if (row.get("field_name") === fieldName) row.set("field_name", "");
      app.save(row);
    }
  } catch (err) {}
  try {
    const tree = app.findRecordsByFilter("bracket_games", "event = {:e}", "", 400, 0, { e: event.id });
    for (let i = 0; i < tree.length; i++) {
      if (tree[i].get("field_name") === fieldName) {
        tree[i].set("field_name", "");
        app.save(tree[i]);
      }
    }
  } catch (err) {}
}

function saveEventFields(app, event, body) {
  const existing = listFieldRecords(app, event.id);
  if (!hasFieldPayload(body)) {
    if (!existing.length) {
      return [saveField(app, event, { name: "Field 1" })];
    }
    return existing.map(function (rec) { return fieldJson(rec, event); });
  }
  const rows = parseFieldRows(body);
  const saved = [];
  const keep = {};
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !String(row.name || "").trim()) continue;
    const rec = saveField(app, event, row);
    keep[rec.id] = true;
    saved.push(rec);
  }
  if (!saved.length) {
    if (existing.length) return existing.map(function (rec) { return fieldJson(rec, event); });
    return [saveField(app, event, { name: "Field 1" })];
  }
  for (let i = 0; i < existing.length; i++) {
    const rec = existing[i];
    if (keep[rec.id]) continue;
    if (saved.length < 1) break;
    unlinkField(app, event, rec);
    app.delete(rec);
  }
  return saved;
}

function resolveField(app, event, data) {
  if (data.field_id) {
    try { return app.findRecordById("fields", data.field_id); } catch (err) {}
  }
  const name = String(data.field || data.field_name || "").trim();
  if (!name) return null;
  try {
    return app.findFirstRecordByFilter("fields", "event = {:e} && name = {:n}", { e: event.id, n: name });
  } catch (err) {
    const rec = new Record(app.findCollectionByNameOrId("fields"));
    rec.set("event", event.id);
    rec.set("name", name);
    rec.set("status", "open");
    rec.set("address", event.get("address") || event.get("venue") || "");
    rec.set("lat", event.get("lat") || 0);
    rec.set("lng", event.get("lng") || 0);
    app.save(rec);
    return rec;
  }
}

function fieldLabel(app, rec) {
  const fid = rec.get("field");
  if (fid) {
    try { return app.findRecordById("fields", fid).get("name"); } catch (err) {}
  }
  return rec.get("field_name") || "";
}

function scheduleRow(app, rec, extras) {
  function teamName(id) {
    if (!id) return "";
    try { return app.findRecordById("event_teams", id).get("name"); } catch (err) { return ""; }
  }
  const row = {
    id: rec.id,
    date: rec.get("date") || "",
    time: rec.get("time") || "",
    game_number: Number(rec.get("game_number") || 0) || 0,
    field: fieldLabel(app, rec),
    field_id: rec.get("field") || "",
    pool: rec.get("pool") || "",
    home: teamName(rec.get("home")),
    away: teamName(rec.get("away")),
    home_id: rec.get("home") || "",
    away_id: rec.get("away") || "",
    home_runs: rec.get("home_runs"),
    away_runs: rec.get("away_runs"),
    status: rec.get("status") || "scheduled",
    notes: rec.get("notes") || "",
    delayed_from: rec.get("delayed_from") || "",
    can_score: false,
    has_box: false,
  };
  if (extras) {
    if (extras.can_score) row.can_score = true;
    if (extras.has_box) row.has_box = true;
  }
  return row;
}

function boxesForEvent(app, eventId) {
  const map = {};
  try {
    const rows = app.findRecordsByFilter("event_boxes", "event = {:e}", "", 200, 0, { e: eventId });
    for (const b of rows) map[b.get("schedule_row")] = true;
  } catch (err) {
    try {
      const rows = app.findRecordsByFilter("event_boxes", "", "", 200, 0);
      for (const b of rows) map[b.get("schedule_row")] = true;
    } catch (miss) {}
  }
  return map;
}

function listSchedule(app, eventId, auth) {
  let event = null;
  if (auth) {
    try { event = app.findRecordById("events", eventId); } catch (err) {}
  }
  const boxes = boxesForEvent(app, eventId);
  const score = require(__hooks + "/score.js");
  return app.findRecordsByFilter("event_schedule", "event = {:e}", "date,time,field_name", 400, 0, { e: eventId }).map(function (r) {
    return scheduleRow(app, r, {
      can_score: !!(auth && event && score.canScore(app, event, r, auth)),
      has_box: !!boxes[r.id],
    });
  });
}

function roundRobinPairs(teams) {
  const list = teams.slice();
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds = [];
  let order = list.slice();
  for (let r = 0; r < n - 1; r++) {
    const pair = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (a && b) pair.push([a, b]);
    }
    rounds.push(pair);
    const fixed = order[0];
    const rest = order.slice(1);
    rest.unshift(rest.pop());
    order = [fixed].concat(rest);
  }
  return rounds;
}

function poolGames(teams, gamesPerTeam) {
  const byPool = {};
  for (const t of teams) {
    const key = t.get("pool") || "A";
    if (!byPool[key]) byPool[key] = [];
    byPool[key].push(t);
  }
  const games = [];
  const names = Object.keys(byPool).sort();
  for (const pool of names) {
    const group = byPool[pool];
    if (group.length < 2) continue;
    const rounds = roundRobinPairs(group);
    const want = Number(gamesPerTeam || 0);
    let take = rounds;
    if (want > 0) {
      const per = group.length - 1;
      const roundsNeeded = Math.min(rounds.length, Math.max(1, Math.min(want, per)));
      take = rounds.slice(0, roundsNeeded);
    }
    for (const round of take) {
      for (const pair of round) {
        games.push({ home: pair[0], away: pair[1], pool: pool });
      }
    }
  }
  return games;
}

function formatWantsPool(format) {
  return format !== "single-elim" && format !== "double-elim" && format !== "imported";
}

function importedGrid(event, prefs) {
  if (prefs && prefs.origin === "imported") return true;
  return String(event.get("format") || "") === "imported";
}

function markSchedulerOrigin(app, event, origin) {
  const prefs = parseScheduler(event.get("scheduler"));
  if (prefs.origin === origin) return prefs;
  prefs.origin = origin;
  event.set("scheduler", prefs);
  app.save(event);
  return prefs;
}

function formatWantsBracket(format) {
  return format === "pool-to-bracket" || format === "single-elim" || format === "double-elim" || format === "pool-double-elim";
}

function formatIsDoubleElim(format) {
  return format === "double-elim" || format === "pool-double-elim";
}

function poolCap(format, prefs, body) {
  if (format === "round-robin") {
    if (hasOwn(body, "games_per_team") && Number(body.games_per_team) > 0) return Number(body.games_per_team);
    return 0;
  }
  return prefs.games_per_team;
}

function timeSlots(days, start, end, gameMinutes, buffer) {
  const slots = [];
  const span = Number(gameMinutes || 90) + Number(buffer || 15);
  for (const day of days) {
    let t = start || "08:00";
    let guard = 0;
    while (minutesOf(t) + Number(gameMinutes || 90) <= minutesOf(end || "20:00") && guard < 40) {
      slots.push({ date: day, time: t });
      t = addMinutes(t, span);
      guard++;
    }
  }
  return slots;
}

function nextGameNumber(app, eventId) {
  let max = 0;
  const cols = ["event_schedule", "bracket_games"];
  for (let c = 0; c < cols.length; c++) {
    try {
      const rows = app.findRecordsByFilter(cols[c], "event = {:e}", "", 400, 0, { e: eventId });
      for (let i = 0; i < rows.length; i++) {
        const n = Number(rows[i].get("game_number") || 0);
        if (n > max) max = n;
      }
    } catch (err) {}
  }
  return max + 1;
}

function assignGameNumber(app, rec) {
  const existing = Number(rec.get("game_number") || 0);
  if (existing > 0) return existing;
  const n = nextGameNumber(app, rec.get("event"));
  rec.set("game_number", n);
  return n;
}

function savePoolGame(app, event, game, slot, field) {
  const rec = new Record(app.findCollectionByNameOrId("event_schedule"));
  rec.set("event", event.id);
  rec.set("date", slot.date);
  rec.set("time", slot.time);
  rec.set("home", game.home.id);
  rec.set("away", game.away.id);
  rec.set("pool", game.pool || "");
  rec.set("status", "scheduled");
  if (field) {
    rec.set("field", field.id);
    rec.set("field_name", field.get("name"));
  }
  assignGameNumber(app, rec);
  app.save(rec);
  return rec;
}

function autoSchedule(app, event, body) {
  const prefs = saveScheduler(app, event, body || {});
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: event.id });
  const format = body.format || event.get("format") || "pool-to-bracket";
  const keepImported = importedGrid(event, prefs);
  const generatePool = formatWantsPool(format) && !keepImported;
  if (generatePool && teams.length < 2) throw new BadRequestError("Sign up at least two teams before you auto-schedule.");
  const fields = app.findRecordsByFilter("fields", "event = {:e} && status != 'closed'", "name", 200, 0, { e: event.id }).filter(function (f) {
    return f.get("status") !== "wet";
  });
  let days = prefs.days && prefs.days.length ? prefs.days.slice() : splitDays(body.days);
  if (!days.length) {
    days = datesBetween(event.get("start"), event.get("end"));
    if (!days.length) days = ["2026-09-19"];
  }
  const games = generatePool ? poolGames(teams, poolCap(format, prefs, body || {})) : [];
  if (generatePool && !games.length) throw new BadRequestError("Need at least two teams in the same pool.");
  // Selecting a bracket format or drawing a tree must not rewrite an imported
  // pool grid. Replace only applies when we are generating new pool games.
  if (prefs.replace && generatePool) {
    const old = app.findRecordsByFilter("event_schedule", "event = {:e}", "", 400, 0, { e: event.id });
    for (const row of old) {
      if (row.get("status") === "final") continue;
      app.delete(row);
    }
  }
  let remaining = games.slice();
  const placed = [];
  if (generatePool) {
    if (!fields.length) throw new BadRequestError("Add at least one open field in tournament setup.");
    const gameMin = Number(event.get("game_length_minutes") || 90);
    const buffer = Number(body.buffer_minutes || 15);
    const globalStart = event.get("hours_start") || body.start_time || "08:00";
    const globalEnd = event.get("hours_end") || body.end_time || "18:00";
    const candidates = [];
    for (const day of days) {
      for (const field of fields) {
        const win = fieldWindow(event, field, day);
        if (!win.available) continue;
        const start = win.start || globalStart;
        const end = win.end || globalEnd;
        let t = start;
        let guard = 0;
        while (minutesOf(t) + gameMin <= minutesOf(end) && guard < 40) {
          candidates.push({ date: day, time: t, field: field });
          t = addMinutes(t, gameMin + buffer);
          guard++;
        }
      }
    }
    candidates.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.time !== b.time) return minutesOf(a.time) - minutesOf(b.time);
      return String(a.field.get("name")).localeCompare(String(b.field.get("name")));
    });
    if (!candidates.length) throw new BadRequestError("No field is open in that window. Widen global hours or a field's day hours.");
    const busyAt = {};
    for (const cand of candidates) {
      if (!remaining.length) break;
      const key = cand.date + "|" + cand.time;
      if (!busyAt[key]) busyAt[key] = {};
      let pick = -1;
      for (let i = 0; i < remaining.length; i++) {
        const g = remaining[i];
        if (busyAt[key][g.home.id] || busyAt[key][g.away.id]) continue;
        pick = i;
        break;
      }
      if (pick === -1) continue;
      const game = remaining.splice(pick, 1)[0];
      busyAt[key][game.home.id] = true;
      busyAt[key][game.away.id] = true;
      placed.push(savePoolGame(app, event, game, { date: cand.date, time: cand.time }, cand.field));
    }
  }
  if (format) {
    event.set("format", format);
    if (body.bracket_flights != null) event.set("bracket_flights", body.bracket_flights || "none");
    app.save(event);
  }
  if (placed.length && !keepImported) markSchedulerOrigin(app, event, "generated");
  let bracket = null;
  const wantBracket = prefs.draw_bracket && (formatWantsBracket(format) || keepImported);
  if (wantBracket) {
    const bracketFormat = formatWantsBracket(format) ? format : "pool-to-bracket";
    bracket = buildBracket(app, event, {
      consolation: prefs.consolation,
      replace: true,
      format: bracketFormat,
      bracket_flights: body.bracket_flights || event.get("bracket_flights") || "none",
    });
  }
  return {
    games: placed.length,
    leftover: remaining.length,
    kept: keepImported ? app.findRecordsByFilter("event_schedule", "event = {:e}", "", 400, 0, { e: event.id }).length : 0,
    note: keepImported
      ? "Imported pool games were left in place. Drawing a bracket does not change pool play."
      : "",
    fields: fields.map(function (f) { return f.get("name"); }),
    days: days,
    format: event.get("format"),
    scheduler: parseScheduler(event.get("scheduler")),
    schedule: listSchedule(app, event.id),
    bracket: bracket,
  };
}

function teamRef(body, idKey, nameKeys) {
  if (body && body[idKey]) return body[idKey];
  for (let i = 0; i < nameKeys.length; i++) {
    const key = nameKeys[i];
    if (body && body[key]) return body[key];
  }
  return "";
}

function resolveEventTeam(app, event, value) {
  if (value == null || value === "") return "";
  try {
    const rec = app.findRecordById("event_teams", value);
    if (rec.get("event") === event.id) return rec.id;
  } catch (err) {}
  try {
    return app.findFirstRecordByFilter("event_teams", "event = {:e} && name = {:n}", { e: event.id, n: String(value) }).id;
  } catch (err) {
    return "";
  }
}

function registeredTeamOrBlank(app, event, value, label) {
  if (value == null || value === "") return "";
  const id = resolveEventTeam(app, event, value);
  if (!id) throw new BadRequestError((label || "Team") + " is not a registered team in this tournament");
  return id;
}

function requireRegisteredTeam(app, event, value, label) {
  const id = registeredTeamOrBlank(app, event, value, label);
  if (!id) throw new BadRequestError((label || "Team") + " must be a registered team");
  return id;
}

function addGame(app, event, body) {
  const homeRef = teamRef(body, "home_id", ["home", "home_name"]);
  const awayRef = teamRef(body, "away_id", ["away", "away_name"]);
  if (!homeRef || !awayRef) throw new BadRequestError("Home and away must be registered teams");
  const homeId = requireRegisteredTeam(app, event, homeRef, "Home");
  const awayId = requireRegisteredTeam(app, event, awayRef, "Away");
  if (homeId === awayId) throw new BadRequestError("Home and away must be different teams");
  const home = app.findRecordById("event_teams", homeId);
  const rec = new Record(app.findCollectionByNameOrId("event_schedule"));
  rec.set("event", event.id);
  rec.set("date", body.date || "");
  rec.set("time", body.time || "");
  rec.set("home", homeId);
  rec.set("away", awayId);
  rec.set("pool", body.pool || home.get("pool") || "");
  rec.set("status", body.status || "scheduled");
  rec.set("notes", body.notes || "");
  const field = resolveField(app, event, body);
  if (field) {
    rec.set("field", field.id);
    rec.set("field_name", field.get("name"));
  }
  if (body.game_number) rec.set("game_number", Number(body.game_number));
  assignGameNumber(app, rec);
  app.save(rec);
  return scheduleRow(app, rec);
}

function updateGame(app, event, id, body) {
  const rec = app.findRecordById("event_schedule", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  if (body.home_id !== undefined || body.home !== undefined || body.home_name !== undefined) {
    rec.set("home", requireRegisteredTeam(app, event, teamRef(body, "home_id", ["home", "home_name"]), "Home"));
  }
  if (body.away_id !== undefined || body.away !== undefined || body.away_name !== undefined) {
    rec.set("away", requireRegisteredTeam(app, event, teamRef(body, "away_id", ["away", "away_name"]), "Away"));
  }
  if (rec.get("home") && rec.get("away") && rec.get("home") === rec.get("away")) {
    throw new BadRequestError("Home and away must be different teams");
  }
  if (body.date != null) rec.set("date", body.date);
  if (body.time != null) rec.set("time", body.time);
  if (body.status) rec.set("status", body.status);
  if (body.notes != null) rec.set("notes", body.notes);
  if (body.pool != null) rec.set("pool", body.pool);
  if (body.field || body.field_id || body.field_name) {
    const field = resolveField(app, event, body);
    if (field) {
      rec.set("field", field.id);
      rec.set("field_name", field.get("name"));
    }
  }
  if (body.home_runs != null && body.home_runs !== "") rec.set("home_runs", Number(body.home_runs));
  if (body.away_runs != null && body.away_runs !== "") rec.set("away_runs", Number(body.away_runs));
  app.save(rec);
  return scheduleRow(app, rec);
}

function deleteGame(app, event, id) {
  const rec = app.findRecordById("event_schedule", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  app.delete(rec);
  return { deleted: id };
}

function seedList(app, event) {
  const diamond = require(__hooks + "/diamond.js");
  const standings = diamond.poolStandings(app, event.id);
  const ranked = [];
  for (const pool of standings) {
    for (const t of pool.teams) ranked.push(t);
  }
  ranked.sort(function (a, b) {
    if (a.w !== b.w) return b.w - a.w;
    if (a.l !== b.l) return a.l - b.l;
    if ((a.ra || 0) !== (b.ra || 0)) return (a.ra || 0) - (b.ra || 0);
    if ((a.diff || 0) !== (b.diff || 0)) return (b.diff || 0) - (a.diff || 0);
    return (b.rs || 0) - (a.rs || 0);
  });
  if (ranked.length) return ranked;
  return app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: event.id }).map(function (t) {
    return { id: t.id, name: t.get("name") };
  });
}

function normalizeFlights(raw) {
  const key = String(raw || "none").toLowerCase();
  if (key === "gold-silver") return ["gold", "silver"];
  if (key === "platinum-gold-silver") return ["platinum", "gold", "silver"];
  return [""];
}

function splitFlights(seeds, flightsKey) {
  const names = normalizeFlights(flightsKey);
  if (names.length <= 1) return [{ flight: names[0] || "", seeds: seeds.slice() }];
  const n = seeds.length;
  if (n < 2) return [{ flight: names[0] || "", seeds: seeds.slice() }];
  const out = [];
  let start = 0;
  for (let i = 0; i < names.length; i++) {
    const leftFlights = names.length - i;
    const leftTeams = n - start;
    if (leftTeams <= 0) break;
    const take = i === names.length - 1 ? leftTeams : Math.max(2, Math.ceil(leftTeams / leftFlights));
    const chunk = seeds.slice(start, start + take);
    start += take;
    if (chunk.length >= 2) out.push({ flight: names[i], seeds: chunk });
    else if (chunk.length === 1 && out.length) out[out.length - 1].seeds.push(chunk[0]);
  }
  return out.length ? out : [{ flight: "", seeds: seeds.slice() }];
}

function flightOf(value) {
  return String(value || "");
}

function findBracketSlot(app, event, round, slot, flight) {
  const fl = flightOf(flight);
  try {
    if (fl) {
      return app.findFirstRecordByFilter(
        "bracket_games",
        "event = {:e} && round = {:r} && slot = {:s} && flight = {:f}",
        { e: event.id, r: round, s: slot, f: fl },
      );
    }
    return app.findFirstRecordByFilter(
      "bracket_games",
      "event = {:e} && round = {:r} && slot = {:s} && (flight = '' || flight = {:f})",
      { e: event.id, r: round, s: slot, f: fl },
    );
  } catch (err) {
    if (fl) return null;
    try {
      return app.findFirstRecordByFilter(
        "bracket_games",
        "event = {:e} && round = {:r} && slot = {:s}",
        { e: event.id, r: round, s: slot },
      );
    } catch (miss) {
      return null;
    }
  }
}

function upsertBracket(app, event, round, slot, side, homeId, awayId, extras) {
  extras = extras || {};
  const flight = flightOf(extras.flight);
  const kind = extras.bracket_kind || (side === "losers" ? "losers" : side === "consolation" ? "consolation" : "winners");
  let rec = findBracketSlot(app, event, round, slot, flight);
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId("bracket_games"));
    rec.set("event", event.id);
    rec.set("round", round);
    rec.set("slot", slot);
  }
  rec.set("round", round);
  rec.set("slot", slot);
  rec.set("side", side);
  rec.set("flight", flight);
  rec.set("bracket_kind", kind);
  rec.set("status", rec.get("status") || "scheduled");
  if (homeId) rec.set("home_team", homeId);
  if (awayId) rec.set("away_team", awayId);
  assignGameNumber(app, rec);
  app.save(rec);
  return rec;
}

function drawSingleElim(app, event, seeds, flight, consolation) {
  const extra = { flight: flight, bracket_kind: "winners" };
  const n = seeds.length;
  let count = 0;
  function up(round, slot, side, homeId, awayId, kind) {
    upsertBracket(app, event, round, slot, side, homeId, awayId, { flight: flight, bracket_kind: kind || extra.bracket_kind });
    count += 1;
  }
  if (n <= 2) {
    up("F", 1, "championship", seeds[0].id, seeds[1].id, "winners");
    return count;
  }
  if (n <= 4) {
    up("SF", 1, "championship", seeds[0].id, seeds[3] ? seeds[3].id : "", "winners");
    up("SF", 2, "championship", seeds[1].id, seeds[2] ? seeds[2].id : "", "winners");
    up("F", 1, "championship", "", "", "winners");
    if (consolation) up("3RD", 1, "consolation", "", "", "consolation");
    return count;
  }
  up("QF", 1, "championship", seeds[0].id, seeds[7] ? seeds[7].id : "", "winners");
  up("QF", 2, "championship", seeds[3] ? seeds[3].id : "", seeds[4] ? seeds[4].id : "", "winners");
  up("QF", 3, "championship", seeds[1] ? seeds[1].id : "", seeds[6] ? seeds[6].id : "", "winners");
  up("QF", 4, "championship", seeds[2] ? seeds[2].id : "", seeds[5] ? seeds[5].id : "", "winners");
  up("SF", 1, "championship", "", "", "winners");
  up("SF", 2, "championship", "", "", "winners");
  up("F", 1, "championship", "", "", "winners");
  if (consolation) {
    up("5TH", 1, "consolation", "", "", "consolation");
    up("3RD", 1, "consolation", "", "", "consolation");
    up("7TH", 1, "consolation", "", "", "consolation");
  }
  return count;
}

function drawDoubleElim(app, event, seeds, flight) {
  const n = seeds.length;
  let count = 0;
  function up(round, slot, side, homeId, awayId, kind) {
    upsertBracket(app, event, round, slot, side, homeId || "", awayId || "", { flight: flight, bracket_kind: kind });
    count += 1;
  }
  if (n <= 2) {
    up("F", 1, "championship", seeds[0].id, seeds[1].id, "winners");
    up("LF", 1, "losers", "", "", "losers");
    return count;
  }
  if (n <= 4) {
    up("SF", 1, "championship", seeds[0].id, seeds[3] ? seeds[3].id : "", "winners");
    up("SF", 2, "championship", seeds[1].id, seeds[2] ? seeds[2].id : "", "winners");
    up("F", 1, "championship", "", "", "winners");
    up("L1", 1, "losers", "", "", "losers");
    up("LF", 1, "losers", "", "", "losers");
    return count;
  }
  up("QF", 1, "championship", seeds[0].id, seeds[7] ? seeds[7].id : "", "winners");
  up("QF", 2, "championship", seeds[3] ? seeds[3].id : "", seeds[4] ? seeds[4].id : "", "winners");
  up("QF", 3, "championship", seeds[1] ? seeds[1].id : "", seeds[6] ? seeds[6].id : "", "winners");
  up("QF", 4, "championship", seeds[2] ? seeds[2].id : "", seeds[5] ? seeds[5].id : "", "winners");
  up("SF", 1, "championship", "", "", "winners");
  up("SF", 2, "championship", "", "", "winners");
  up("F", 1, "championship", "", "", "winners");
  up("L1", 1, "losers", "", "", "losers");
  up("L1", 2, "losers", "", "", "losers");
  up("L2", 1, "losers", "", "", "losers");
  up("L2", 2, "losers", "", "", "losers");
  up("L3", 1, "losers", "", "", "losers");
  up("LF", 1, "losers", "", "", "losers");
  return count;
}

function buildBracket(app, event, opts) {
  opts = opts || {};
  const seeds = seedList(app, event);
  const format = opts.format || event.get("format") || "pool-to-bracket";
  const flightsKey = opts.bracket_flights != null ? opts.bracket_flights : (event.get("bracket_flights") || "none");
  const consolation = opts.consolation !== false && !formatIsDoubleElim(format);
  if (opts.bracket_flights != null) event.set("bracket_flights", flightsKey || "none");
  event.set("bracket_mode", opts.bracket_mode || "standings");
  if (opts.format) event.set("format", opts.format);
  app.save(event);
  if (opts.replace) {
    const old = app.findRecordsByFilter("bracket_games", "event = {:e}", "", 400, 0, { e: event.id });
    for (const row of old) {
      if (row.get("status") === "final") continue;
      app.delete(row);
    }
  }
  const n = seeds.length;
  if (n < 2) return { games: 0, seeds: n, note: "Need two teams to draw a bracket." };
  const flights = splitFlights(seeds, flightsKey);
  let games = 0;
  const drawn = [];
  for (let i = 0; i < flights.length; i++) {
    const fl = flights[i];
    const added = formatIsDoubleElim(format)
      ? drawDoubleElim(app, event, fl.seeds, fl.flight)
      : drawSingleElim(app, event, fl.seeds, fl.flight, consolation);
    games += added;
    drawn.push({ flight: fl.flight || "", seeds: fl.seeds.length, games: added });
  }
  return { games: games, seeds: n, flights: drawn, format: format, bracket_flights: flightsKey || "none" };
}

function listBracket(app, event) {
  try {
    return require(__hooks + "/diamond.js").publicBoard(app, event).bracket;
  } catch (err) {
    return [];
  }
}

function saveCustomBracket(app, event, body) {
  body = body || {};
  event.set("bracket_mode", "custom");
  if (body.bracket_flights != null) event.set("bracket_flights", body.bracket_flights || "none");
  if (body.format) event.set("format", body.format);
  app.save(event);
  const incoming = body.games || [];
  const deleteIds = body.delete_ids || body.deleteIds || [];
  const keep = {};
  for (let i = 0; i < incoming.length; i++) {
    if (incoming[i] && incoming[i].id) keep[incoming[i].id] = true;
  }
  for (let i = 0; i < deleteIds.length; i++) {
    try {
      const rec = app.findRecordById("bracket_games", deleteIds[i]);
      if (rec.get("event") !== event.id) continue;
      if (rec.get("status") === "final") continue;
      app.delete(rec);
    } catch (err) {}
  }
  if (body.replace === true || body.replace === "true") {
    const old = app.findRecordsByFilter("bracket_games", "event = {:e}", "", 400, 0, { e: event.id });
    for (let i = 0; i < old.length; i++) {
      if (old[i].get("status") === "final") continue;
      if (keep[old[i].id]) continue;
      app.delete(old[i]);
    }
  }
  let updated = 0;
  for (let i = 0; i < incoming.length; i++) {
    const row = incoming[i];
    if (!row) continue;
    if (row.id) {
      editBracketGame(app, event, row.id, row);
      updated += 1;
      continue;
    }
    const home = registeredTeamOrBlank(app, event, row.home_id != null ? row.home_id : row.home, "Home");
    const away = registeredTeamOrBlank(app, event, row.away_id != null ? row.away_id : row.away, "Away");
    const rec = upsertBracket(
      app,
      event,
      row.round || "QF",
      Number(row.slot || (i + 1)),
      row.side || "championship",
      home,
      away,
      { flight: row.flight || "", bracket_kind: row.bracket_kind || (row.side === "losers" ? "losers" : "winners") },
    );
    if (row.date != null) rec.set("date", row.date);
    if (row.time != null) rec.set("time", row.time);
    if (row.field != null || row.field_name != null) rec.set("field_name", row.field || row.field_name || "");
    app.save(rec);
    updated += 1;
  }
  return { updated: updated, mode: "custom", bracket: listBracket(app, event) };
}

function clearBracketResult(rec) {
  rec.set("status", "scheduled");
  rec.set("winner", "");
  rec.set("home_runs", 0);
  rec.set("away_runs", 0);
}

function editBracketGame(app, event, id, body) {
  const rec = app.findRecordById("bracket_games", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  let teamsChanged = body.swap === true || body.swap === "true";
  if (teamsChanged) {
    const home = rec.get("home_team") || "";
    rec.set("home_team", rec.get("away_team") || "");
    rec.set("away_team", home);
  }
  if (body.home_id !== undefined || body.home !== undefined) {
    const next = registeredTeamOrBlank(app, event, body.home_id !== undefined ? body.home_id : body.home, "Home");
    if (next !== (rec.get("home_team") || "")) teamsChanged = true;
    rec.set("home_team", next);
  }
  if (body.away_id !== undefined || body.away !== undefined) {
    const next = registeredTeamOrBlank(app, event, body.away_id !== undefined ? body.away_id : body.away, "Away");
    if (next !== (rec.get("away_team") || "")) teamsChanged = true;
    rec.set("away_team", next);
  }
  if (body.field != null || body.field_name != null) rec.set("field_name", body.field || body.field_name || "");
  if (body.time != null) rec.set("time", body.time);
  if (body.date != null) rec.set("date", body.date);
  if (body.slot != null && body.slot !== "") rec.set("slot", Number(body.slot));
  if (body.side === "championship" || body.side === "consolation" || body.side === "winners" || body.side === "losers") rec.set("side", body.side);
  if (body.round) rec.set("round", body.round);
  if (body.flight != null) rec.set("flight", String(body.flight || ""));
  if (body.bracket_kind) rec.set("bracket_kind", body.bracket_kind);
  if (body.protest_note != null) rec.set("protest_note", body.protest_note);
  const keep = body.keep_score === true || body.keep_score === "true";
  if (body.clear_result === true || body.clear_result === "true" || body.reopen === true || body.reopen === "true" || (teamsChanged && rec.get("status") === "final" && !keep)) {
    clearBracketResult(rec);
  }
  app.save(rec);
  return rec;
}

function swapBracketSeats(app, event, body) {
  if (!body.from_id) throw new BadRequestError("from_id is required");
  const a = app.findRecordById("bracket_games", body.from_id);
  if (a.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  const b = body.to_id && body.to_id !== body.from_id
    ? app.findRecordById("bracket_games", body.to_id)
    : a;
  if (b.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  const fromSeat = body.from_seat === "away" ? "away_team" : "home_team";
  const toSeat = body.to_seat === "away" ? "away_team" : "home_team";
  const first = a.get(fromSeat) || "";
  const second = b.get(toSeat) || "";
  a.set(fromSeat, second);
  b.set(toSeat, first);
  if (a.get("status") === "final") clearBracketResult(a);
  if (b.get("status") === "final") clearBracketResult(b);
  if (body.protest_note) {
    a.set("protest_note", body.protest_note);
    if (a.id !== b.id) b.set("protest_note", body.protest_note);
  }
  app.save(a);
  if (a.id !== b.id) app.save(b);
  return { swapped: true };
}

function saveBracketDesk(app, event, body) {
  const games = body.games || [];
  let updated = 0;
  for (const row of games) {
    if (!row || !row.id) continue;
    editBracketGame(app, event, row.id, row);
    updated++;
  }
  return { updated: updated };
}

function rainUpdate(app, event, body) {
  const status = body.rain_status || body.status || "watch";
  const allowed = ["clear", "watch", "delay", "postponed", "moved"];
  if (allowed.indexOf(status) === -1) throw new BadRequestError("rain_status must be clear, watch, delay, postponed, or moved");
  event.set("rain_status", status);
  if (body.rain_note != null) event.set("rain_note", body.rain_note);
  if (body.status_note != null) event.set("status_note", body.status_note);
  if (status !== "clear" && !event.get("status_note") && body.rain_note) event.set("status_note", body.rain_note);
  if (status === "clear") {
    if (!body.status_note) event.set("status_note", "");
  }
  app.save(event);

  const rows = app.findRecordsByFilter("event_schedule", "event = {:e}", "date,time", 400, 0, { e: event.id });
  const delay = Number(body.delay_minutes || 0);
  const after = body.after_time || "00:00";
  const day = body.date || "";
  let shifted = 0;
  let moved = 0;
  let postponed = 0;
  let reassigned = 0;

  if (delay && (status === "delay" || body.delay_minutes)) {
    for (const row of rows) {
      if (row.get("status") === "final") continue;
      if (day && row.get("date") !== day) continue;
      if (minutesOf(row.get("time")) < minutesOf(after)) continue;
      const prev = row.get("time");
      row.set("delayed_from", row.get("delayed_from") || prev);
      row.set("time", addMinutes(prev, delay));
      if (row.get("status") === "scheduled" || row.get("status") === "live") row.set("status", "scheduled");
      app.save(row);
      shifted++;
    }
  }

  if (body.move_from && body.move_to) {
    for (const row of rows) {
      if (row.get("status") === "final") continue;
      if (row.get("date") !== body.move_from) continue;
      row.set("date", body.move_to);
      app.save(row);
      moved++;
    }
  }

  if (status === "postponed" && body.postpone) {
    for (const row of rows) {
      if (row.get("status") === "final") continue;
      if (day && row.get("date") !== day) continue;
      row.set("status", "postponed");
      app.save(row);
      postponed++;
    }
  }

  if (body.close_field) {
    let field;
    try {
      field = app.findRecordById("fields", body.close_field);
    } catch (err) {
      field = resolveField(app, event, { field: body.close_field });
    }
    if (field) {
      field.set("status", "wet");
      app.save(field);
      const open = app.findRecordsByFilter("fields", "event = {:e} && status = 'open'", "name", 20, 0, { e: event.id });
      const later = app.findRecordsByFilter("event_schedule", "event = {:e}", "date,time", 400, 0, { e: event.id });
      for (const row of later) {
        if (row.get("status") === "final") continue;
        if (row.get("field") !== field.id && row.get("field_name") !== field.get("name")) continue;
        if (open.length) {
          const next = open[reassigned % open.length];
          row.set("field", next.id);
          row.set("field_name", next.get("name"));
          row.set("notes", (row.get("notes") || "") + (row.get("notes") ? " · " : "") + "Moved off " + field.get("name") + " (wet).");
          app.save(row);
          reassigned++;
        } else {
          row.set("status", "rained_out");
          app.save(row);
          postponed++;
        }
      }
    }
  }

  return {
    event: {
      rain_status: event.get("rain_status"),
      rain_note: event.get("rain_note") || "",
      status_note: event.get("status_note") || "",
    },
    shifted: shifted,
    moved: moved,
    postponed: postponed,
    reassigned: reassigned,
    schedule: listSchedule(app, event.id),
    mail_sent: (function () {
      try { return require(__hooks + "/mail.js").rainNotice(app, event).sent || 0; }
      catch (err) {
        try { require(__hooks + "/host.js").writeLog(app, event.id, "rain_mail", false, String(err)); }
        catch (logErr) {}
        return 0;
      }
    })(),
  };
}

function plan(app, event, auth) {
  const host = require(__hooks + "/host.js");
  const teams = host.publicRoster(app, event, auth);
  try { require(__hooks + "/contacts.js").attachVisible(app, event, teams, auth); }
  catch (err) {}
  return {
    event: host.eventJson(event, app, auth, { owners: true }),
    fields: eventFields(app, event.id),
    schedule: listSchedule(app, event.id, auth),
    teams: teams,
    bracket: listBracket(app, event),
    pending_boxes: require(__hooks + "/score.js").listPendingBoxes(app, event.id),
    photos: (function () {
      try { return require(__hooks + "/photos.js").listPhotos(app, event.id, false); }
      catch (err) { return []; }
    })(),
  };
}

module.exports = {
  mapUrl: mapUrl,
  fieldJson: fieldJson,
  eventFields: eventFields,
  fieldWindow: fieldWindow,
  fieldOpenAt: fieldOpenAt,
  datesBetween: datesBetween,
  applyLocation: applyLocation,
  saveEventFields: saveEventFields,
  saveField: saveField,
  resolveField: resolveField,
  autoSchedule: autoSchedule,
  addGame: addGame,
  updateGame: updateGame,
  deleteGame: deleteGame,
  buildBracket: buildBracket,
  saveCustomBracket: saveCustomBracket,
  listBracket: listBracket,
  splitFlights: splitFlights,
  parseFieldRows: parseFieldRows,
  roundRobinPairs: roundRobinPairs,
  poolGames: poolGames,
  editBracketGame: editBracketGame,
  swapBracketSeats: swapBracketSeats,
  saveBracketDesk: saveBracketDesk,
  rainUpdate: rainUpdate,
  parseScheduler: parseScheduler,
  saveScheduler: saveScheduler,
  plan: plan,
  listSchedule: listSchedule,
  scheduleRow: scheduleRow,
  addMinutes: addMinutes,
  nextGameNumber: nextGameNumber,
  assignGameNumber: assignGameNumber,
};
