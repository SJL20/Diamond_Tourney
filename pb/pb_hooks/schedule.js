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

function fieldJson(rec) {
  const lat = rec.get("lat");
  const lng = rec.get("lng");
  const address = rec.get("address") || "";
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
  };
}

function eventFields(app, eventId) {
  try {
    return app.findRecordsByFilter("fields", "event = {:e}", "name", 40, 0, { e: eventId }).map(fieldJson);
  } catch (err) {
    return [];
  }
}

function parseFieldRows(body) {
  if (body.fields && typeof body.fields === "object" && body.fields.length !== undefined) {
    return body.fields;
  }
  if (typeof body.fields === "string") {
    try { return JSON.parse(body.fields); } catch (err) {}
  }
  const out = [];
  for (let i = 0; i < 16; i++) {
    const name = String(body["field_name_" + i] || "").trim();
    if (!name) continue;
    out.push({
      id: body["field_id_" + i] || "",
      name: name,
      address: body["field_address_" + i] || "",
      lat: body["field_lat_" + i],
      lng: body["field_lng_" + i],
      surface: body["field_surface_" + i] || "",
      lights: body["field_lights_" + i],
    });
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
  if (data.lat != null && data.lat !== "") rec.set("lat", Number(data.lat));
  if (data.lng != null && data.lng !== "") rec.set("lng", Number(data.lng));
  if (data.surface != null) rec.set("surface", data.surface);
  if (data.lights != null) rec.set("lights", data.lights === true || data.lights === "true" || data.lights === "on");
  if (data.notes != null) rec.set("notes", data.notes);
  if (data.status) rec.set("status", data.status);
  if (!rec.get("status")) rec.set("status", "open");
  app.save(rec);
  return fieldJson(rec);
}

function applyLocation(rec, body) {
  if (body.address != null) rec.set("address", body.address);
  if (body.lat != null && body.lat !== "") rec.set("lat", Number(body.lat));
  if (body.lng != null && body.lng !== "") rec.set("lng", Number(body.lng));
  if (body.venue != null) rec.set("venue", body.venue);
  if (body.format) rec.set("format", body.format);
  if (body.rain_note != null) rec.set("rain_note", body.rain_note);
  if (body.rain_status) rec.set("rain_status", body.rain_status);
}

function saveEventFields(app, event, body) {
  const rows = parseFieldRows(body);
  const saved = [];
  for (const row of rows) {
    if (!row || !row.name) continue;
    saved.push(saveField(app, event, row));
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
  app.save(rec);
  return rec;
}

function autoSchedule(app, event, body) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: event.id });
  if (teams.length < 2) throw new BadRequestError("Sign up at least two teams before you auto-schedule.");
  const fields = app.findRecordsByFilter("fields", "event = {:e} && status != 'closed'", "name", 20, 0, { e: event.id }).filter(function (f) {
    return f.get("status") !== "wet";
  });
  if (!fields.length) throw new BadRequestError("Add at least one open field in tournament setup.");
  let days = body.days;
  if (typeof days === "string") days = days.split(/[,\n]/).map(function (d) { return d.trim(); }).filter(Boolean);
  if (!days || !days.length) {
    const start = event.get("start");
    days = [start ? String(start).slice(0, 10) : "2026-09-19"];
  }
  const games = poolGames(teams, body.games_per_team != null ? body.games_per_team : 2);
  if (!games.length) throw new BadRequestError("Need at least two teams in the same pool.");
  if (body.replace) {
    const old = app.findRecordsByFilter("event_schedule", "event = {:e}", "", 400, 0, { e: event.id });
    for (const row of old) {
      if (row.get("status") === "final") continue;
      app.delete(row);
    }
  }
  const slots = timeSlots(days, body.start_time || "08:00", body.end_time || "18:00", event.get("game_length_minutes") || 90, body.buffer_minutes || 15);
  if (!slots.length) throw new BadRequestError("No time slots fit between start and end. Widen the window.");
  let remaining = games.slice();
  const placed = [];
  for (const slot of slots) {
    if (!remaining.length) break;
    const busy = {};
    for (const field of fields) {
      let pick = -1;
      for (let i = 0; i < remaining.length; i++) {
        const g = remaining[i];
        if (busy[g.home.id] || busy[g.away.id]) continue;
        pick = i;
        break;
      }
      if (pick === -1) break;
      const game = remaining.splice(pick, 1)[0];
      busy[game.home.id] = true;
      busy[game.away.id] = true;
      placed.push(savePoolGame(app, event, game, slot, field));
    }
  }
  let extra = slots.length ? slots[slots.length - 1] : { date: days[0], time: body.start_time || "08:00" };
  let guard = 0;
  while (remaining.length && guard < 80) {
    extra = { date: extra.date, time: addMinutes(extra.time, Number(event.get("game_length_minutes") || 90) + Number(body.buffer_minutes || 15)) };
    const busy = {};
    for (const field of fields) {
      if (!remaining.length) break;
      let pick = -1;
      for (let i = 0; i < remaining.length; i++) {
        const g = remaining[i];
        if (busy[g.home.id] || busy[g.away.id]) continue;
        pick = i;
        break;
      }
      if (pick === -1) break;
      const game = remaining.splice(pick, 1)[0];
      busy[game.home.id] = true;
      busy[game.away.id] = true;
      placed.push(savePoolGame(app, event, game, extra, field));
    }
    guard++;
  }
  const format = body.format || event.get("format") || "pool-to-bracket";
  if (format) {
    event.set("format", format);
    app.save(event);
  }
  const draw = body.draw_bracket === true || body.draw_bracket === "true";
  if (draw && format && format !== "pool-only" && format !== "imported") {
    buildBracket(app, event, { consolation: body.consolation !== false, replace: true });
  }
  return {
    games: placed.length,
    leftover: remaining.length,
    fields: fields.map(function (f) { return f.get("name"); }),
    days: days,
    format: event.get("format"),
    schedule: listSchedule(app, event.id),
  };
}

function addGame(app, event, body) {
  const homeName = body.home || body.home_name;
  const awayName = body.away || body.away_name;
  if (!homeName || !awayName) throw new BadRequestError("Home and away teams are required");
  const diamond = require(__hooks + "/diamond.js");
  const home = diamond.upsertEventTeam(app, event.id, homeName, body.pool || "");
  const away = diamond.upsertEventTeam(app, event.id, awayName, body.pool || "");
  const rec = new Record(app.findCollectionByNameOrId("event_schedule"));
  rec.set("event", event.id);
  rec.set("date", body.date || "");
  rec.set("time", body.time || "");
  rec.set("home", home.id);
  rec.set("away", away.id);
  rec.set("pool", body.pool || home.get("pool") || "");
  rec.set("status", body.status || "scheduled");
  rec.set("notes", body.notes || "");
  const field = resolveField(app, event, body);
  if (field) {
    rec.set("field", field.id);
    rec.set("field_name", field.get("name"));
  }
  app.save(rec);
  return scheduleRow(app, rec);
}

function updateGame(app, event, id, body) {
  const rec = app.findRecordById("event_schedule", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
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
    return (b.diff || 0) - (a.diff || 0);
  });
  if (ranked.length) return ranked;
  return app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: event.id }).map(function (t) {
    return { id: t.id, name: t.get("name") };
  });
}

function upsertBracket(app, event, round, slot, side, homeId, awayId) {
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "bracket_games",
      "event = {:e} && round = {:r} && slot = {:s}",
      { e: event.id, r: round, s: slot },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("bracket_games"));
    rec.set("event", event.id);
    rec.set("round", round);
    rec.set("slot", slot);
  }
  rec.set("side", side);
  rec.set("status", rec.get("status") || "scheduled");
  if (homeId) rec.set("home_team", homeId);
  if (awayId) rec.set("away_team", awayId);
  app.save(rec);
  return rec;
}

function buildBracket(app, event, opts) {
  const seeds = seedList(app, event);
  const consolation = !opts || opts.consolation !== false;
  if (opts && opts.replace) {
    const old = app.findRecordsByFilter("bracket_games", "event = {:e}", "", 80, 0, { e: event.id });
    for (const row of old) {
      if (row.get("status") === "final") continue;
      app.delete(row);
    }
  }
  const n = seeds.length;
  if (n < 2) return { games: 0, note: "Need two teams to draw a bracket." };
  if (n <= 2) {
    upsertBracket(app, event, "F", 1, "championship", seeds[0].id, seeds[1].id);
    return { games: 1, seeds: n };
  }
  if (n <= 4) {
    upsertBracket(app, event, "SF", 1, "championship", seeds[0].id, seeds[3] ? seeds[3].id : "");
    upsertBracket(app, event, "SF", 2, "championship", seeds[1].id, seeds[2] ? seeds[2].id : "");
    upsertBracket(app, event, "F", 1, "championship", "", "");
    if (consolation) upsertBracket(app, event, "3RD", 1, "consolation", "", "");
    return { games: consolation ? 4 : 3, seeds: n };
  }
  upsertBracket(app, event, "QF", 1, "championship", seeds[0].id, seeds[7] ? seeds[7].id : "");
  upsertBracket(app, event, "QF", 2, "championship", seeds[3] ? seeds[3].id : "", seeds[4] ? seeds[4].id : "");
  upsertBracket(app, event, "QF", 3, "championship", seeds[1] ? seeds[1].id : "", seeds[6] ? seeds[6].id : "");
  upsertBracket(app, event, "QF", 4, "championship", seeds[2] ? seeds[2].id : "", seeds[5] ? seeds[5].id : "");
  upsertBracket(app, event, "SF", 1, "championship", "", "");
  upsertBracket(app, event, "SF", 2, "championship", "", "");
  upsertBracket(app, event, "F", 1, "championship", "", "");
  if (consolation) {
    upsertBracket(app, event, "5TH", 1, "consolation", "", "");
    upsertBracket(app, event, "3RD", 1, "consolation", "", "");
    upsertBracket(app, event, "7TH", 1, "consolation", "", "");
  }
  return { games: consolation ? 10 : 7, seeds: n };
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
  };
}

function plan(app, event, auth) {
  const host = require(__hooks + "/host.js");
  return {
    event: host.eventJson(event, app),
    fields: eventFields(app, event.id),
    schedule: listSchedule(app, event.id, auth),
    teams: host.publicRoster(app, event),
  };
}

module.exports = {
  mapUrl: mapUrl,
  fieldJson: fieldJson,
  eventFields: eventFields,
  applyLocation: applyLocation,
  saveEventFields: saveEventFields,
  saveField: saveField,
  resolveField: resolveField,
  autoSchedule: autoSchedule,
  addGame: addGame,
  updateGame: updateGame,
  deleteGame: deleteGame,
  buildBracket: buildBracket,
  rainUpdate: rainUpdate,
  plan: plan,
  listSchedule: listSchedule,
  scheduleRow: scheduleRow,
  addMinutes: addMinutes,
};
