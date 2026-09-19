const MAX_ROWS = 80;

const FIELDS = [
  { key: "game", label: "Game label", required: true, aliases: ["game", "game id", "game_id", "slot label", "b game"] },
  { key: "round", label: "Round", aliases: ["round", "rnd"] },
  { key: "side", label: "Side", aliases: ["side", "bracket", "flight side"] },
  { key: "date", label: "Date", aliases: ["date", "day"] },
  { key: "time", label: "Time", aliases: ["time", "first pitch", "start"] },
  { key: "field", label: "Field", aliases: ["field", "diamond", "field name"] },
  { key: "home", label: "Home", aliases: ["home", "home team", "team a"] },
  { key: "away", label: "Away", aliases: ["away", "away team", "team b"] },
  { key: "winner_to", label: "Winner to", aliases: ["winner to", "winner_to", "advances to", "next"] },
  { key: "loser_to", label: "Loser to", aliases: ["loser to", "loser_to", "drops to"] },
  { key: "home_runs", label: "Home runs", aliases: ["home runs", "home_runs", "as"] },
  { key: "away_runs", label: "Away runs", aliases: ["away runs", "away_runs", "bs"] },
  { key: "status", label: "Status", aliases: ["status"] },
  { key: "flight", label: "Flight", aliases: ["flight", "level"] },
];

function fieldLabels() {
  return FIELDS.map(function (f) {
    return { key: f.key, label: f.label, required: !!f.required };
  });
}

function scoreHeader(header, alias) {
  const h = require(__hooks + "/csv.js").normalizeHeader(header);
  const a = require(__hooks + "/csv.js").normalizeHeader(alias);
  if (!h || !a) return 0;
  if (h === a) return 100 + a.length;
  if (h.indexOf(a) !== -1 && a.length >= 4) return 70 + a.length;
  if (a.indexOf(h) !== -1 && h.length >= 4) return 50 + h.length;
  return 0;
}

function guessMapping(headers) {
  const used = {};
  const mapping = {};
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    let best = "";
    let bestScore = 0;
    for (let f = 0; f < FIELDS.length; f++) {
      if (used[FIELDS[f].key]) continue;
      for (let a = 0; a < FIELDS[f].aliases.length; a++) {
        const score = scoreHeader(header, FIELDS[f].aliases[a]);
        if (score > bestScore) {
          bestScore = score;
          best = FIELDS[f].key;
        }
      }
    }
    if (best && bestScore >= 50) {
      mapping[header] = best;
      used[best] = true;
    } else {
      mapping[header] = "";
    }
  }
  return mapping;
}

function decodeMapping(raw) {
  if (!raw) return null;
  try {
    if (typeof raw !== "string") raw = JSON.stringify(raw);
    raw = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i++) {
    out[String(keys[i])] = raw[keys[i]] == null ? "" : String(raw[keys[i]]);
  }
  return Object.keys(out).length ? out : null;
}

function loadRemembered(app, auth) {
  if (!app || !auth) return null;
  try {
    if (auth.isSuperuser && auth.isSuperuser()) return null;
  } catch (err) {}
  try {
    const rec = app.findFirstRecordByFilter(
      "import_maps",
      "account = {:u} && kind = {:k}",
      { u: auth.id, k: "bracket" },
    );
    return decodeMapping(rec.get("mapping"));
  } catch (err) {
    return null;
  }
}

function saveRemembered(app, auth, mapping) {
  if (!app || !auth || !mapping) return;
  try {
    if (auth.isSuperuser && auth.isSuperuser()) return;
  } catch (err) {}
  let rec;
  try {
    rec = app.findFirstRecordByFilter(
      "import_maps",
      "account = {:u} && kind = {:k}",
      { u: auth.id, k: "bracket" },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("import_maps"));
    rec.set("account", auth.id);
    rec.set("kind", "bracket");
  }
  rec.set("mapping", mapping);
  app.save(rec);
}

function mappedRow(row, mapping) {
  const out = {};
  const headers = Object.keys(row);
  for (let i = 0; i < headers.length; i++) {
    const field = mapping[headers[i]];
    if (!field) continue;
    out[field] = row[headers[i]];
  }
  return out;
}

function normLabel(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

function parseRef(raw) {
  const text = String(raw || "").trim();
  if (!text) return { kind: "empty", value: "" };
  const seed = text.match(/^seed\s*:?\s*(\d+)$/i);
  if (seed) return { kind: "seed", value: Number(seed[1]) };
  const winner = text.match(/^winner\s*:?\s*(.+)$/i);
  if (winner) return { kind: "winner", value: normLabel(winner[1]) };
  const loser = text.match(/^loser\s*:?\s*(.+)$/i);
  if (loser) return { kind: "loser", value: normLabel(loser[1]) };
  if (/^(tbd|tba|winner of|loser of)$/i.test(text)) return { kind: "empty", value: "" };
  return { kind: "team", value: text };
}

function refLabel(ref) {
  if (!ref || ref.kind === "empty") return "";
  if (ref.kind === "seed") return "Seed " + ref.value;
  if (ref.kind === "winner") return "Winner of " + ref.value;
  if (ref.kind === "loser") return "Loser of " + ref.value;
  return ref.value;
}

function inferSide(round, side) {
  const s = String(side || "").toLowerCase();
  if (s === "losers" || s === "winners" || s === "championship" || s === "consolation") return s;
  const r = String(round || "").toUpperCase();
  if (r === "LF" || /^L(\d|QF|SF)/.test(r)) return "losers";
  if (/^(C|3RD|5TH|7TH|CONS|CSF|CF)/.test(r)) return "consolation";
  return "championship";
}

function slotFromLabel(label, index) {
  const m = String(label || "").match(/(\d+)/);
  if (m) return Number(m[1]);
  return index + 1;
}

function indexTeams(app, event) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: event.id });
  const byName = {};
  const byId = {};
  const csv = require(__hooks + "/csv.js");
  for (let i = 0; i < teams.length; i++) {
    byName[csv.normalizeName(teams[i].get("name"))] = teams[i];
    byId[teams[i].id] = teams[i];
  }
  return { teams: teams, byName: byName, byId: byId };
}

function seedMap(app, event) {
  const ranked = require(__hooks + "/schedule.js").seedList(app, event);
  const out = {};
  for (let i = 0; i < ranked.length; i++) {
    if (ranked[i] && ranked[i].seed != null) out[Number(ranked[i].seed)] = ranked[i];
  }
  return out;
}

function resolveSeat(ref, indexed, seeds) {
  if (!ref || ref.kind === "empty") return { id: "", name: "", label: "", ok: true };
  if (ref.kind === "seed") {
    const hit = seeds[ref.value];
    return {
      id: hit ? hit.id : "",
      name: hit ? hit.name : "",
      label: "Seed " + ref.value,
      ok: true,
      pending: !hit,
    };
  }
  if (ref.kind === "winner" || ref.kind === "loser") {
    return { id: "", name: "", label: refLabel(ref), ok: true, pending: true };
  }
  const key = require(__hooks + "/csv.js").normalizeName(ref.value);
  const team = key ? indexed.byName[key] : null;
  if (!team) return { id: "", name: ref.value, label: ref.value, ok: false };
  return { id: team.id, name: team.get("name"), label: team.get("name"), ok: true };
}

function hasCycle(labels, edges) {
  const seen = {};
  const stack = {};
  function walk(node) {
    if (stack[node]) return true;
    if (seen[node]) return false;
    seen[node] = true;
    stack[node] = true;
    const next = edges[node] || [];
    for (let i = 0; i < next.length; i++) {
      if (next[i] && walk(next[i])) return true;
    }
    stack[node] = false;
    return false;
  }
  for (let i = 0; i < labels.length; i++) {
    if (walk(labels[i])) return true;
  }
  return false;
}

function existingByLabel(app, event) {
  const rows = app.findRecordsByFilter("bracket_games", "event = {:e}", "", 400, 0, { e: event.id });
  const byLabel = {};
  for (let i = 0; i < rows.length; i++) {
    const label = normLabel(rows[i].get("game_id"));
    if (label) byLabel[label] = rows[i];
  }
  return { rows: rows, byLabel: byLabel };
}

function fieldWarning(app, event, fieldName, time) {
  const warnings = [];
  if (!fieldName) return warnings;
  const names = {};
  try {
    const fields = require(__hooks + "/schedule.js").eventFields(app, event.id);
    for (let i = 0; i < fields.length; i++) names[require(__hooks + "/csv.js").normalizeName(fields[i].name)] = true;
    if (Object.keys(names).length && !names[require(__hooks + "/csv.js").normalizeName(fieldName)]) {
      warnings.push("field is not on this weekend");
    }
  } catch (err) {}
  const start = String(event.get("hours_start") || "08:00");
  const end = String(event.get("hours_end") || "18:00");
  if (time && (time < start || time > end)) warnings.push("time is outside the posted hour window");
  return warnings;
}

function preview(app, event, body, auth) {
  const csv = require(__hooks + "/csv.js");
  const table = csv.parseTable(body.csv || body.text || "");
  if (table.rows.length > MAX_ROWS) {
    throw new BadRequestError("Cap is " + MAX_ROWS + " bracket games. Split the file.");
  }
  const remembered = loadRemembered(app, auth);
  const supplied = decodeMapping(body.mapping);
  const guessed = guessMapping(table.headers);
  const stored = supplied || remembered || {};
  const mapping = {};
  for (let i = 0; i < table.headers.length; i++) {
    const h = table.headers[i];
    mapping[h] = stored[h] || guessed[h] || "";
  }
  const indexed = indexTeams(app, event);
  const seeds = seedMap(app, event);
  const existing = existingByLabel(app, event);
  const rows = [];
  const labels = [];
  const seen = {};
  const edges = {};
  let nNew = 0;
  let nExists = 0;
  let nProblems = 0;
  let nKept = 0;
  for (let i = 0; i < table.rows.length; i++) {
    const mapped = mappedRow(table.rows[i], mapping);
    const line = i + 2;
    const label = normLabel(mapped.game);
    const problems = [];
    const warnings = [];
    if (!label) problems.push("missing game label");
    if (label && seen[label]) problems.push("duplicate game label in this file");
    if (label) seen[label] = line;
    labels.push(label);
    const winnerTo = normLabel(mapped.winner_to);
    const loserTo = normLabel(mapped.loser_to);
    edges[label] = [];
    if (winnerTo) edges[label].push(winnerTo);
    if (loserTo) edges[label].push(loserTo);
    const homeRef = parseRef(mapped.home);
    const awayRef = parseRef(mapped.away);
    const home = resolveSeat(homeRef, indexed, seeds);
    const away = resolveSeat(awayRef, indexed, seeds);
    if (homeRef.kind === "team" && !home.ok) problems.push("unmatched home team");
    if (awayRef.kind === "team" && !away.ok) problems.push("unmatched away team");
    warnings.push.apply(warnings, fieldWarning(app, event, mapped.field, mapped.time));
    const hit = label ? existing.byLabel[label] : null;
    let status = "new";
    if (problems.length) {
      status = "problem";
      nProblems++;
    } else if (hit && hit.get("status") === "final") {
      status = "kept";
      nKept++;
    } else if (hit) {
      status = "exists";
      nExists++;
    } else {
      nNew++;
    }
    rows.push({
      line: line,
      game: label,
      round: mapped.round || "",
      side: inferSide(mapped.round, mapped.side),
      date: mapped.date || "",
      time: mapped.time || "",
      field: mapped.field || "",
      home: home.name || home.label,
      away: away.name || away.label,
      home_ref: homeRef.kind === "team" ? "" : refLabel(homeRef),
      away_ref: awayRef.kind === "team" ? "" : refLabel(awayRef),
      winner_to: winnerTo,
      loser_to: loserTo,
      status: status,
      existing_id: hit ? hit.id : "",
      problems: problems,
      warnings: warnings,
    });
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.winner_to && !seen[row.winner_to]) row.problems.push("winner_to does not match a game in this file");
    if (row.loser_to && !seen[row.loser_to]) row.problems.push("loser_to does not match a game in this file");
  }
  const cycled = hasCycle(labels.filter(Boolean), edges);
  if (cycled) {
    for (let i = 0; i < rows.length; i++) rows[i].problems.push("cycle in advancement");
  }
  nNew = 0; nExists = 0; nProblems = 0; nKept = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].problems.length) rows[i].status = "problem";
    if (rows[i].status === "problem") nProblems++;
    else if (rows[i].status === "kept") nKept++;
    else if (rows[i].status === "exists") nExists++;
    else nNew++;
  }
  const finals = rows.filter(function (r) { return r.game && !r.winner_to; });
  const warnings = [];
  if (cycled) warnings.push("winner_to / loser_to has a cycle");
  if (finals.length === 0) warnings.push("no game is missing winner_to — there is no final");
  if (finals.length > 1) warnings.push(finals.length + " games have no winner_to (more than one final)");
  return {
    headers: table.headers,
    samples: table.rows.slice(0, 4),
    fields: fieldLabels(),
    guessed: guessed,
    mapping: mapping,
    remembered: !!(!supplied && remembered),
    rows: rows,
    warnings: warnings,
    counts: {
      total: rows.length,
      new: nNew,
      exists: nExists,
      kept: nKept,
      problems: nProblems,
    },
  };
}

function findOrCreate(app, event, existing, row) {
  if (existing.byLabel[row.game]) return existing.byLabel[row.game];
  const rec = new Record(app.findCollectionByNameOrId("bracket_games"));
  rec.set("event", event.id);
  rec.set("round", row.round || "QF");
  rec.set("slot", slotFromLabel(row.game, 0));
  rec.set("side", row.side || "championship");
  rec.set("game_id", row.game);
  rec.set("status", "scheduled");
  return rec;
}

function commit(app, event, body, auth) {
  const viewed = preview(app, event, body, auth);
  if (viewed.counts.problems) {
    throw new BadRequestError("Fix " + viewed.counts.problems + " row(s) in the preview before importing.");
  }
  saveRemembered(app, auth, viewed.mapping);
  const csv = require(__hooks + "/csv.js");
  const table = csv.parseTable(body.csv || body.text || "");
  const indexed = indexTeams(app, event);
  const seeds = seedMap(app, event);
  const existing = existingByLabel(app, event);
  const replace = body.replace === true || body.replace === "true";
  const keep = {};
  const feeds = {};
  const created = [];
  const updated = [];
  const kept = [];
  const schedule = require(__hooks + "/schedule.js");
  for (let i = 0; i < viewed.rows.length; i++) {
    const row = viewed.rows[i];
    const mapped = mappedRow(table.rows[i], viewed.mapping);
    const home = resolveSeat(parseRef(mapped.home), indexed, seeds);
    const away = resolveSeat(parseRef(mapped.away), indexed, seeds);
    feeds[row.game] = {
      winner_to: row.winner_to || "",
      loser_to: row.loser_to || "",
      home_ref: home.label && !home.id ? home.label : (parseRef(mapped.home).kind === "team" ? "" : refLabel(parseRef(mapped.home))),
      away_ref: away.label && !away.id ? away.label : (parseRef(mapped.away).kind === "team" ? "" : refLabel(parseRef(mapped.away))),
    };
    if (row.status === "kept") {
      keep[row.existing_id] = true;
      kept.push({ id: row.existing_id, game: row.game });
      continue;
    }
    const rec = findOrCreate(app, event, existing, {
      game: row.game,
      round: mapped.round || row.round,
      side: inferSide(mapped.round, mapped.side),
    });
    if (rec.get("status") === "final") {
      keep[rec.id] = true;
      kept.push({ id: rec.id, game: row.game });
      continue;
    }
    rec.set("game_id", row.game);
    rec.set("round", mapped.round || rec.get("round") || "QF");
    rec.set("slot", slotFromLabel(row.game, i));
    rec.set("side", inferSide(mapped.round, mapped.side));
    rec.set("flight", mapped.flight || rec.get("flight") || "");
    rec.set("home_team", home.id || "");
    rec.set("away_team", away.id || "");
    if (mapped.date) rec.set("date", mapped.date);
    if (mapped.time) rec.set("time", mapped.time);
    if (mapped.field) rec.set("field_name", mapped.field);
    if (mapped.home_runs !== "" && mapped.home_runs != null) rec.set("home_runs", Number(mapped.home_runs));
    if (mapped.away_runs !== "" && mapped.away_runs != null) rec.set("away_runs", Number(mapped.away_runs));
    if (mapped.status) rec.set("status", mapped.status);
    else if (mapped.home_runs !== "" && mapped.home_runs != null) rec.set("status", "final");
    schedule.assignGameNumber(app, rec);
    app.save(rec);
    keep[rec.id] = true;
    existing.byLabel[row.game] = rec;
    if (row.existing_id) updated.push({ id: rec.id, game: row.game });
    else created.push({ id: rec.id, game: row.game });
  }
  if (replace) {
    for (let i = 0; i < existing.rows.length; i++) {
      const rec = existing.rows[i];
      if (keep[rec.id]) continue;
      if (rec.get("status") === "final") continue;
      app.delete(rec);
    }
  }
  const prefs = schedule.parseScheduler(event.get("scheduler"));
  prefs.bracket_feeds = feeds;
  event.set("scheduler", prefs);
  event.set("bracket_mode", "imported");
  if (!event.get("format") || event.get("format") === "imported") event.set("format", "pool-to-bracket");
  app.save(event);
  require(__hooks + "/host.js").writeLog(app, event.id, "event", true,
    created.length + " bracket games imported, " + updated.length + " updated, " + kept.length + " finals kept");
  return {
    mapping: viewed.mapping,
    created: created,
    updated: updated,
    kept: kept,
    warnings: viewed.warnings,
    counts: {
      new: created.length,
      updated: updated.length,
      kept: kept.length,
      total: viewed.counts.total,
    },
    bracket: require(__hooks + "/diamond.js").publicBoard(app, event).bracket,
  };
}

module.exports = {
  FIELDS: FIELDS,
  guessMapping: guessMapping,
  parseRef: parseRef,
  preview: preview,
  commit: commit,
};
