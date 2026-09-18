const MAX_ROWS = 400;
const AGE_OK = { "6U": 1, "8U": 1, "10U": 1, "11U": 1, "12U": 1, "14U": 1, "16U": 1, "18U": 1 };

const FIELDS = [
  { key: "name", label: "Team name", required: true, aliases: ["team name", "name of team", "organization team", "organization / team", "club name", "team"] },
  { key: "coach_name", label: "Coach name", aliases: ["coach name", "head coach", "contact name", "coach"] },
  { key: "coach_email", label: "Coach email", aliases: ["coach email", "email address", "contact email", "e-mail", "email"] },
  { key: "coach_phone", label: "Coach phone", aliases: ["coach phone", "phone number", "cell phone", "mobile", "phone", "cell"] },
  { key: "age_group", label: "Age group", aliases: ["age group", "age division", "ages", "age"] },
  { key: "klass", label: "Class", aliases: ["class", "class level"] },
  { key: "gamechanger_url", label: "GameChanger URL", aliases: ["gamechanger url", "gamechanger link", "gc url", "gc link", "gamechanger", "gc"] },
  { key: "timestamp", label: "Submission timestamp", aliases: ["timestamp", "submission timestamp", "submitted at", "submitted"] },
  { key: "paid", label: "Paid", aliases: ["paid", "payment", "paid status"] },
  { key: "notes", label: "Notes", aliases: ["notes", "comments", "other"] },
  { key: "pool", label: "Pool", aliases: ["pool"] },
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
      { u: auth.id, k: "teams" },
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
      { u: auth.id, k: "teams" },
    );
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("import_maps"));
    rec.set("account", auth.id);
    rec.set("kind", "teams");
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

function parseAge(raw) {
  const text = String(raw || "").toUpperCase();
  const found = text.match(/6U|8U|10U|11U|12U|14U|16U|18U/);
  return found ? found[0] : "";
}

function parsePaid(raw) {
  return /^(y|yes|true|1|paid|x)$/i.test(String(raw || "").trim());
}

function parseStamp(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const ms = Date.parse(text);
  if (!ms) return text;
  return new Date(ms).toISOString();
}

function validEmail(addr) {
  const email = String(addr || "").trim().toLowerCase();
  if (!email) return "";
  return require(__hooks + "/softball.js").isValidEmail(email) ? email : null;
}

function indexExisting(app, event) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 400, 0, { e: event.id });
  const byEmail = {};
  const byName = {};
  const contacts = require(__hooks + "/contacts.js");
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    const nameKey = require(__hooks + "/csv.js").normalizeName(t.get("name"));
    if (nameKey) byName[nameKey] = t;
    const emails = contacts.contactEmails(app, t);
    for (let j = 0; j < emails.length; j++) byEmail[emails[j]] = t;
    const legacy = String(t.get("contact_email") || "").trim().toLowerCase();
    if (legacy) byEmail[legacy] = t;
  }
  return { teams: teams, byEmail: byEmail, byName: byName };
}

function matchExisting(indexed, mapped) {
  const email = validEmail(mapped.coach_email);
  if (email && indexed.byEmail[email]) return { team: indexed.byEmail[email], how: "email" };
  const nameKey = require(__hooks + "/csv.js").normalizeName(mapped.name);
  if (nameKey && indexed.byName[nameKey]) return { team: indexed.byName[nameKey], how: "name" };
  return null;
}

function problemsFor(mapped, seenNames, seenEmails, line) {
  const problems = [];
  const name = String(mapped.name || "").trim();
  if (!name) problems.push("missing team name");
  const nameKey = require(__hooks + "/csv.js").normalizeName(name);
  if (nameKey && seenNames[nameKey]) problems.push("duplicate team name in this file");
  if (nameKey) seenNames[nameKey] = line;
  const email = String(mapped.coach_email || "").trim();
  if (email) {
    if (validEmail(email) == null) problems.push("malformed email");
    else if (seenEmails[email.toLowerCase()]) problems.push("duplicate email in this file");
    else seenEmails[email.toLowerCase()] = line;
  }
  if (mapped.age_group && !parseAge(mapped.age_group) && !AGE_OK[String(mapped.age_group).toUpperCase()]) {
    problems.push("unrecognized age group");
  }
  return problems;
}

function preview(app, event, body, auth) {
  const csv = require(__hooks + "/csv.js");
  const table = csv.parseTable(body.csv || body.text || "");
  if (table.rows.length > MAX_ROWS) {
    throw new BadRequestError("Cap is " + MAX_ROWS + " rows. Split the file and import twice.");
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
  const indexed = indexExisting(app, event);
  const seenNames = {};
  const seenEmails = {};
  const rows = [];
  let nNew = 0;
  let nExists = 0;
  let nProblems = 0;
  for (let i = 0; i < table.rows.length; i++) {
    const mapped = mappedRow(table.rows[i], mapping);
    const line = i + 2;
    const problems = problemsFor(mapped, seenNames, seenEmails, line);
    const hit = problems.length ? null : matchExisting(indexed, mapped);
    let status = "new";
    if (problems.length) {
      status = "problem";
      nProblems++;
    } else if (hit) {
      status = "exists";
      nExists++;
    } else {
      nNew++;
    }
    rows.push({
      line: line,
      name: mapped.name || "",
      coach_name: mapped.coach_name || "",
      coach_email: mapped.coach_email || "",
      coach_phone: mapped.coach_phone || "",
      age_group: parseAge(mapped.age_group) || String(mapped.age_group || ""),
      klass: mapped.klass || "",
      gamechanger_url: mapped.gamechanger_url || "",
      timestamp: mapped.timestamp || "",
      paid: parsePaid(mapped.paid),
      notes: mapped.notes || "",
      pool: mapped.pool || "",
      status: status,
      match: hit ? hit.how : "",
      existing_id: hit ? hit.team.id : "",
      existing_name: hit ? hit.team.get("name") : "",
      problems: problems,
    });
  }
  return {
    headers: table.headers,
    samples: table.rows.slice(0, 4),
    fields: fieldLabels(),
    guessed: guessed,
    mapping: mapping,
    remembered: !!(!supplied && remembered),
    rows: rows,
    counts: {
      total: rows.length,
      new: nNew,
      exists: nExists,
      problems: nProblems,
    },
  };
}

function applyMapped(app, event, team, mapped, auth) {
  const host = require(__hooks + "/host.js");
  const contacts = require(__hooks + "/contacts.js");
  if (mapped.age_group) team.set("age_group", parseAge(mapped.age_group) || String(mapped.age_group || "").toUpperCase());
  if (mapped.klass) team.set("klass", String(mapped.klass || "").toUpperCase());
  if (mapped.notes != null && mapped.notes !== "") team.set("notes", mapped.notes);
  if (mapped.timestamp) team.set("registered_at", parseStamp(mapped.timestamp));
  if (mapped.paid) team.set("paid", true);
  if (mapped.coach_name) team.set("contact_name", mapped.coach_name);
  if (mapped.coach_email) team.set("contact_email", String(mapped.coach_email).trim().toLowerCase());
  app.save(team);
  contacts.upsertForEventTeam(app, event, team, {
    coach_email: mapped.coach_email || team.get("contact_email") || "",
    coach_phone: mapped.coach_phone || "",
    role: "head_coach",
  });
  return host.teamJson(team);
}

function commit(app, event, body, auth) {
  const viewed = preview(app, event, body, auth);
  if (viewed.counts.problems && body.allow_problems !== true && body.allow_problems !== "true") {
    // Still import clean rows; problems stay out.
  }
  saveRemembered(app, auth, viewed.mapping);
  const onMatch = String(body.on_match || "skip").toLowerCase() === "update" ? "update" : "skip";
  const host = require(__hooks + "/host.js");
  const created = [];
  const updated = [];
  const skipped = [];
  const problems = [];
  const csv = require(__hooks + "/csv.js");
  const table = csv.parseTable(body.csv || body.text || "");
  const indexed = indexExisting(app, event);
  for (let i = 0; i < viewed.rows.length; i++) {
    const row = viewed.rows[i];
    if (row.status === "problem") {
      problems.push(row);
      continue;
    }
    const mapped = mappedRow(table.rows[i], viewed.mapping);
    if (row.status === "exists") {
      if (onMatch === "skip") {
        skipped.push({ id: row.existing_id, name: row.existing_name, match: row.match });
        continue;
      }
      const team = indexed.byEmail[String(mapped.coach_email || "").trim().toLowerCase()]
        || indexed.byName[csv.normalizeName(mapped.name)];
      if (!team) {
        problems.push(row);
        continue;
      }
      if (mapped.gamechanger_url) team.set("gamechanger_url", mapped.gamechanger_url);
      if (mapped.pool) team.set("pool", mapped.pool);
      updated.push(applyMapped(app, event, team, mapped, auth));
      continue;
    }
    const team = host.upsertEventTeam(app, event, {
      name: mapped.name,
      pool: mapped.pool || "",
      gamechanger_url: mapped.gamechanger_url || "",
      contact_name: mapped.coach_name || "",
      contact_email: mapped.coach_email || "",
      signed_up_by: "director",
      account: auth ? auth.id : "",
    });
    created.push(applyMapped(app, event, team, mapped, auth));
    const email = String(mapped.coach_email || "").trim().toLowerCase();
    if (email) indexed.byEmail[email] = team;
    indexed.byName[csv.normalizeName(mapped.name)] = team;
  }
  host.writeLog(app, event.id, "team_import", true,
    created.length + " new, " + updated.length + " updated, " + skipped.length + " skipped, " + problems.length + " problems");
  return {
    mapping: viewed.mapping,
    on_match: onMatch,
    created: created,
    updated: updated,
    skipped: skipped,
    problems: problems,
    counts: {
      new: created.length,
      updated: updated.length,
      skipped: skipped.length,
      problems: problems.length,
      total: viewed.counts.total,
    },
  };
}

module.exports = {
  FIELDS: FIELDS,
  guessMapping: guessMapping,
  preview: preview,
  commit: commit,
};
