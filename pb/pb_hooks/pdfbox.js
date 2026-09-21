// Read a PDF text layer into hitting and pitching lines.
// A missing cell stays null. Nothing here approves the box.

function mergeNotes(prior, extra) {
  const left = String(prior || "").trim();
  const right = String(extra || "").trim();
  if (!left) return right;
  if (!right || left.indexOf(right) !== -1) return left;
  return left + " · " + right;
}

function sideNames(app, game) {
  function name(id) {
    if (!id) return "";
    try { return app.findRecordById("event_teams", id).get("name") || ""; }
    catch (err) { return ""; }
  }
  if (!game) return { home: "", away: "" };
  return {
    home: name(game.get("home") || game.get("home_team")),
    away: name(game.get("away") || game.get("away_team")),
  };
}

function storedFilePath(app, rec) {
  const raw = rec.get("file");
  const file = Array.isArray(raw) ? raw[0] : raw;
  if (!file) return "";
  const col = app.findCollectionByNameOrId("event_boxes");
  return [app.dataDir(), "storage", col.id, rec.id, file].join("/");
}

function pdfScriptPath() {
  const hooks = String(__hooks || "");
  const candidates = [];
  if (hooks) {
    candidates.push(hooks.replace(/\/pb\/pb_hooks\/?$/, "/scripts/pdf_box_text.py"));
    candidates.push(hooks.replace(/\/pb_hooks\/?$/, "/scripts/pdf_box_text.py"));
  }
  candidates.push("/app/scripts/pdf_box_text.py");
  for (let i = 0; i < candidates.length; i++) {
    try {
      if ($os.stat(candidates[i])) return candidates[i];
    } catch (err) {}
  }
  return "";
}

function failed(note) {
  return {
    ok: false,
    hitting: [],
    pitching: [],
    note: note || "PDF text extract failed. The file stays queued.",
  };
}

function runExtract(pdfPath, home, away) {
  const script = pdfScriptPath();
  if (!script) return failed("PDF text extract is unavailable on this server. The file stays queued.");
  const job = $os.tempDir() + "/pdfbox-" + Math.random().toString(36).slice(2) + ".json";
  let raw = "";
  try {
    // os.WriteFile perm is required. Omitted perm is 0 and Python cannot read the job.
    $os.writeFile(job, JSON.stringify({
      pdf: pdfPath,
      home: home || "",
      away: away || "",
    }), 0o644);
    const cmd = $os.cmd("python3", script, "--job", job);
    raw = toString(cmd.output());
  } catch (err) {
    try { $os.remove(job); } catch (err2) {}
    return failed("PDF text extract failed. The file stays queued.");
  }
  try { $os.remove(job); } catch (err) {}
  try {
    const parsed = JSON.parse(String(raw || "").trim());
    if (!parsed || typeof parsed !== "object") return failed();
    parsed.hitting = parsed.hitting || [];
    parsed.pitching = parsed.pitching || [];
    return parsed;
  } catch (err) {
    return failed();
  }
}

function extractBoxFile(app, box, game) {
  const path = storedFilePath(app, box);
  if (!path || !/\.pdf$/i.test(path)) return null;
  const names = sideNames(app, game);
  return runExtract(path, names.home, names.away);
}

function applyExtract(app, box, extracted) {
  if (!extracted) return false;
  const hitting = extracted.hitting || [];
  const pitching = extracted.pitching || [];
  const got = !!(hitting.length || pitching.length);
  if (got) {
    box.set("hitting", hitting);
    box.set("pitching", pitching);
    box.set("status", "needs_review");
  }
  if (extracted.note) box.set("note", mergeNotes(box.get("note"), extracted.note));
  if (got || extracted.note) app.save(box);
  return got;
}

module.exports = {
  mergeNotes: mergeNotes,
  extractBoxFile: extractBoxFile,
  applyExtract: applyExtract,
};
