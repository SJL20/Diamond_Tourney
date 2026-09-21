/// <reference path="../pb_data/types.d.ts" />

const BUFFER_MINUTES = 15;
const DEFAULT_GAME_MINUTES = 90;
const TOKEN_DAYS = 7;

function teamSlug(app, id) {
  if (!id) return "";
  try { return app.findRecordById("event_teams", id).get("slug") || ""; } catch (err) { return ""; }
}

function teamName(app, id) {
  if (!id) return "";
  try { return app.findRecordById("event_teams", id).get("name") || ""; } catch (err) { return ""; }
}

function gameKind(rec) {
  return rec.get("home_team") != null || rec.collectionName === "bracket_games" ? "bracket" : "schedule";
}

function homeAwayIds(game) {
  if (game.get("home_team") != null || game.get("away_team") != null) {
    return { home: game.get("home_team") || "", away: game.get("away_team") || "" };
  }
  return { home: game.get("home") || "", away: game.get("away") || "" };
}

function isSuppressed(game) {
  const st = String(game.get("status") || "");
  if (st === "cancelled" || st === "forfeit" || st === "postponed" || st === "rained_out" || st === "bye") return true;
  const notes = String(game.get("notes") || "").toLowerCase();
  return /\bforfeit\b|\bcancel/.test(notes);
}

function parseClock(date, time) {
  const d = String(date || "");
  const t = String(time || "00:00");
  const m = (d + "T" + t).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
}

function expectedEndMs(event, game) {
  const start = parseClock(game.get("date"), game.get("time"));
  if (!start) return 0;
  const mins = Number(event.get("game_length_minutes") || DEFAULT_GAME_MINUTES) || DEFAULT_GAME_MINUTES;
  return start + (mins + BUFFER_MINUTES) * 60000;
}

function dateMs(v) {
  if (v == null || v === "" || v === false) return 0;
  const t = Date.parse(String(v).replace(" ", "T"));
  if (t && t > 24 * 3600 * 1000) return t;
  try {
    const n = new Date(v).getTime();
    return n > 24 * 3600 * 1000 ? n : 0;
  } catch (err) {
    return 0;
  }
}

function hasDate(rec, field) {
  return dateMs(rec.get(field)) > 0;
}

function reminderDue(emailedAt, nowMs) {
  const sent = dateMs(emailedAt);
  if (!sent) return false;
  const sentDay = new Date(sent).toISOString().slice(0, 10);
  const nowDay = new Date(nowMs).toISOString().slice(0, 10);
  return nowDay > sentDay;
}

function optedOut(app, team) {
  try {
    const rec = require(__hooks + "/contacts.js").findForEventTeam(app, team.id);
    return !!(rec && rec.get("box_mail_opt_out"));
  } catch (err) {
    return false;
  }
}

function findInvite(app, eventId, gameId, teamId, kind) {
  const filter = kind === "bracket"
    ? "event = {:e} && bracket_row = {:g} && team = {:t}"
    : "event = {:e} && schedule_row = {:g} && team = {:t}";
  try {
    return app.findFirstRecordByFilter("box_submissions", filter, { e: eventId, g: gameId, t: teamId });
  } catch (err) {
    return null;
  }
}

function findByToken(app, token) {
  const t = String(token || "").trim();
  if (!t) throw new BadRequestError("Missing upload token.");
  try {
    return app.findFirstRecordByFilter("box_submissions", "token = {:t}", { t: t });
  } catch (err) {
    throw new BadRequestError("That upload link is expired or already used.");
  }
}

function expiresAt() {
  return new Date(Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function inviteRow(app, event, game, team, kind) {
  let rec = findInvite(app, event.id, game.id, team.id, kind);
  if (rec) return rec;
  rec = new Record(app.findCollectionByNameOrId("box_submissions"));
  rec.set("event", event.id);
  rec.set("team", team.id);
  if (kind === "bracket") rec.set("bracket_row", game.id);
  else rec.set("schedule_row", game.id);
  rec.set("token", require(__hooks + "/mail.js").randomToken() + require(__hooks + "/mail.js").randomToken());
  rec.set("expires", expiresAt());
  rec.set("status", "invited");
  rec.set("unsubscribed", false);
  app.save(rec);
  return rec;
}

function gameLabel(app, event, game) {
  const n = Number(game.get("game_number") || 0);
  const sides = homeAwayIds(game);
  const home = teamName(app, sides.home) || "Home";
  const away = teamName(app, sides.away) || "Away";
  return {
    number: n,
    home: home,
    away: away,
    field: game.get("field_name") || game.get("field") || "",
    date: game.get("date") || "",
    time: game.get("time") || "",
    subject: event.get("name") + " — upload your book for Game " + (n || "?") + " vs " + away,
  };
}

function boxHelpHtml() {
  return "<p>How to send the book (use the way you already export for this weekend):</p>"
    + "<ol>"
    + "<li>Upload a GameChanger mobile PDF on the link.</li>"
    + "<li>Paste a public GameChanger box-score URL (web.gc.com …/box-score).</li>"
    + "<li>Upload a photo of the paper scorebook.</li>"
    + "</ol>"
    + "<p>Exact GameChanger menu names change by app version. This mail does not guess them. "
    + "Use the export your director already showed you, or open the help page from the link.</p>";
}

function sendInvite(app, event, game, team, rec, reminder, nowMs) {
  const mail = require(__hooks + "/mail.js");
  const contacts = require(__hooks + "/contacts.js");
  const emails = contacts.contactEmails(app, team);
  if (!emails.length) {
    mail.logMail(app, event.id, "box_mail", false, "no_recipient");
    return { sent: 0, reason: "no_recipient" };
  }
  const meta = gameLabel(app, event, game);
  const us = team.get("name");
  const opp = us === meta.home ? meta.away : meta.home;
  const subject = event.get("name") + " — upload your book for Game " + (meta.number || "?") + " vs " + opp;
  const link = mail.publicUrl("/box/" + rec.get("token"));
  const help = mail.publicUrl("/help/box-score");
  const stop = mail.publicUrl("/box/" + rec.get("token") + "/stop");
  const html = "<p><b>" + subject.replace(/</g, "") + "</b></p>"
    + "<p>" + (meta.date || "") + (meta.time ? " · " + meta.time : "") + (meta.field ? " · " + meta.field : "") + "</p>"
    + "<p>" + meta.home + " vs " + meta.away + "</p>"
    + "<p><a href=\"" + link + "\">Upload this team's book</a> — one game, this team only.</p>"
    + boxHelpHtml()
    + "<p><a href=\"" + help + "\">Help: how to send a box score</a></p>"
    + "<p><a href=\"" + stop + "\">Stop asking about this tournament</a></p>";
  let sent = 0;
  let reason = "";
  for (let i = 0; i < emails.length; i++) {
    const out = mail.sendMail(app, emails[i], (reminder ? "Reminder: " : "") + subject, html, "box_mail", event.id);
    if (out.sent) sent++;
    else reason = out.reason || reason;
  }
  const now = new Date(nowMs || Date.now()).toISOString();
  if (!hasDate(rec, "emailed_at")) rec.set("emailed_at", now);
  if (reminder) rec.set("reminder_at", now);
  app.save(rec);
  return { sent: sent, reason: reason, token: rec.get("token") };
}

function dueGames(app, event, nowMs) {
  const out = [];
  function add(kind, collection) {
    let rows = [];
    try {
      rows = app.findRecordsByFilter(collection, "event = {:e}", "", 2000, 0, { e: event.id });
    } catch (err) { rows = []; }
    for (let i = 0; i < rows.length; i++) {
      if (isSuppressed(rows[i])) continue;
      const end = expectedEndMs(event, rows[i]);
      if (end && end <= nowMs) out.push({ kind: kind, rec: rows[i] });
    }
  }
  add("schedule", "event_schedule");
  add("bracket", "bracket_games");
  return out;
}

function runBoxMail(app, opts) {
  opts = opts || {};
  const nowMs = opts.now ? Date.parse(opts.now) : Date.now();
  let events = [];
  if (opts.event) events = [opts.event];
  else {
    try {
      events = app.findRecordsByFilter("events", "status = 'live'", "", 2000, 0);
    } catch (err) { events = []; }
  }
  const summary = { invited: 0, reminded: 0, skipped: 0, mailed: 0, reason: "", invites: [] };
  for (let e = 0; e < events.length; e++) {
    const event = events[e];
    const games = dueGames(app, event, nowMs);
    for (let g = 0; g < games.length; g++) {
      const game = games[g].rec;
      const kind = games[g].kind;
      const sides = homeAwayIds(game);
      const ids = [sides.home, sides.away];
      for (let t = 0; t < ids.length; t++) {
        if (!ids[t]) continue;
        let team;
        try { team = app.findRecordById("event_teams", ids[t]); } catch (err) { continue; }
        if (optedOut(app, team)) { summary.skipped++; continue; }
        let rec = findInvite(app, event.id, game.id, team.id, kind);
        if (rec && hasDate(rec, "submitted_at")) { summary.skipped++; continue; }
        if (rec && rec.get("unsubscribed")) { summary.skipped++; continue; }
        if (rec && hasDate(rec, "emailed_at") && hasDate(rec, "reminder_at")) { summary.skipped++; continue; }
        if (rec && hasDate(rec, "emailed_at") && !reminderDue(rec.get("emailed_at"), nowMs)) { summary.skipped++; continue; }
        if (!rec) rec = inviteRow(app, event, game, team, kind);
        const reminder = !!(hasDate(rec, "emailed_at") && !hasDate(rec, "reminder_at"));
        const out = sendInvite(app, event, game, team, rec, reminder, nowMs);
        if (reminder) summary.reminded++;
        else summary.invited++;
        summary.mailed += out.sent;
        if (out.reason) summary.reason = out.reason;
        summary.invites.push({
          team: team.get("name"),
          team_id: team.id,
          team_slug: team.get("slug") || "",
          game_id: game.id,
          kind: kind,
          token: rec.get("token"),
          reminder: reminder,
        });
      }
    }
  }
  return summary;
}

function publicInvite(app, rec) {
  const event = app.findRecordById("events", rec.get("event"));
  const team = app.findRecordById("event_teams", rec.get("team"));
  let game;
  const kind = rec.get("bracket_row") ? "bracket" : "schedule";
  if (kind === "bracket") game = app.findRecordById("bracket_games", rec.get("bracket_row"));
  else game = app.findRecordById("event_schedule", rec.get("schedule_row"));
  const meta = gameLabel(app, event, game);
  const expires = rec.get("expires");
  const expired = dateMs(expires) && dateMs(expires) < Date.now();
  return {
    event: { name: event.get("name"), slug: event.get("slug") },
    team: { name: team.get("name"), slug: team.get("slug") },
    game: {
      id: game.id,
      kind: kind,
      game_number: meta.number,
      date: meta.date,
      time: meta.time,
      field: meta.field,
      home: meta.home,
      away: meta.away,
    },
    expired: !!expired,
    submitted: hasDate(rec, "submitted_at"),
    help: "/help/box-score",
  };
}

function assertLiveToken(rec) {
  if (rec.get("unsubscribed")) throw new BadRequestError("This team asked not to get box-score mail.");
  if (dateMs(rec.get("expires")) && dateMs(rec.get("expires")) < Date.now()) {
    throw new BadRequestError("That upload link is expired.");
  }
}

function otherInvite(app, rec) {
  const kind = rec.get("bracket_row") ? "bracket" : "schedule";
  const gameId = rec.get("bracket_row") || rec.get("schedule_row");
  const rows = app.findRecordsByFilter(
    "box_submissions",
    kind === "bracket"
      ? "event = {:e} && bracket_row = {:g}"
      : "event = {:e} && schedule_row = {:g}",
    "",
    8,
    0,
    { e: rec.get("event"), g: gameId },
  );
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id !== rec.id) return rows[i];
  }
  return null;
}

function loadGame(app, rec) {
  if (rec.get("bracket_row")) return app.findRecordById("bracket_games", rec.get("bracket_row"));
  return app.findRecordById("event_schedule", rec.get("schedule_row"));
}

function runsOf(rec) {
  if (!hasDate(rec, "submitted_at")) return null;
  if (rec.get("home_runs") == null || rec.get("away_runs") == null) return null;
  return { home: Number(rec.get("home_runs")), away: Number(rec.get("away_runs")) };
}

function hidePublicScore(app, game) {
  game.set("home_runs", 0);
  game.set("away_runs", 0);
  game.set("score_source", "conflict");
  if (game.get("status") === "final") game.set("status", "submitted");
  app.save(game);
}

function applyFirstScore(app, game, home, away) {
  if (game.get("score_source") === "verified" || game.get("score_source") === "conflict") return;
  if (game.get("status") === "final" && game.get("score_source") !== "one_book") {
    if (!game.get("score_source")) {
      game.set("score_source", "one_book");
      app.save(game);
    }
    return;
  }
  game.set("home_runs", home);
  game.set("away_runs", away);
  game.set("score_source", "one_book");
  if (!game.get("status") || game.get("status") === "scheduled") game.set("status", "submitted");
  app.save(game);
}

function applyVerified(app, event, game, home, away) {
  game.set("home_runs", home);
  game.set("away_runs", away);
  game.set("score_source", "verified");
  game.set("status", "final");
  app.save(game);
  try { require(__hooks + "/schedule.js").fillEmptyBracket(app, event); } catch (err) {}
}

function reconcile(app, rec) {
  const ours = runsOf(rec);
  if (!ours) return { state: rec.get("status") || "pending" };
  const other = otherInvite(app, rec);
  const event = app.findRecordById("events", rec.get("event"));
  const game = loadGame(app, rec);
  if (!other || !runsOf(other)) {
    rec.set("status", "parsed");
    app.save(rec);
    applyFirstScore(app, game, ours.home, ours.away);
    return { state: "one_book" };
  }
  const theirs = runsOf(other);
  if (theirs.home === ours.home && theirs.away === ours.away) {
    rec.set("status", "verified");
    other.set("status", "verified");
    app.save(rec);
    app.save(other);
    applyVerified(app, event, game, ours.home, ours.away);
    return { state: "verified" };
  }
  rec.set("status", "conflict");
  other.set("status", "conflict");
  app.save(rec);
  app.save(other);
  hidePublicScore(app, game);
  return { state: "conflict" };
}

function submitToken(app, token, body, files) {
  const rec = findByToken(app, token);
  assertLiveToken(rec);
  const host = require(__hooks + "/host.js");
  const gcUrl = String(body.gc_url || "").trim();
  if (gcUrl && !host.isGcBoxUrl(gcUrl) && !host.isGameChangerUrl(gcUrl)) {
    throw new BadRequestError("Paste a public GameChanger box-score URL.");
  }
  const hasFile = !!(files && files.length);
  const hr = body.home_runs;
  const ar = body.away_runs;
  if (!hasFile && !gcUrl && (hr == null || ar == null || hr === "" || ar === "")) {
    throw new BadRequestError("Upload a PDF or photo, paste a public box URL, or enter both run totals from the book.");
  }
  if (hasFile) rec.set("file", files);
  if (gcUrl) rec.set("gc_url", gcUrl);
  if (hr != null && hr !== "" && ar != null && ar !== "") {
    rec.set("home_runs", Number(hr));
    rec.set("away_runs", Number(ar));
    rec.set("parsed", { home_runs: Number(hr), away_runs: Number(ar), innings: body.innings || "" });
  }
  let method = body.method || "";
  if (!method) {
    if (gcUrl && !hasFile) method = "gc_link";
    else if (hasFile && /\.pdf$/i.test(String(body.original_name || body.filename || ""))) method = "gc_pdf";
    else if (hasFile) method = "photo";
    else method = "manual";
  }
  rec.set("method", method);
  rec.set("submitted_at", new Date().toISOString());
  rec.set("submitted_by", String(body.submitted_by || "token").slice(0, 120));
  rec.set("status", rec.get("home_runs") != null ? "parsed" : "pending");
  app.save(rec);

  if (hasFile || gcUrl) {
    try {
      const event = app.findRecordById("events", rec.get("event"));
      const game = loadGame(app, rec);
      if (!rec.get("bracket_row")) {
        const existing = (function () {
          try { return app.findFirstRecordByFilter("event_boxes", "schedule_row = {:s}", { s: game.id }); }
          catch (err) {
            const row = new Record(app.findCollectionByNameOrId("event_boxes"));
            row.set("event", event.id);
            row.set("schedule_row", game.id);
            return row;
          }
        })();
        existing.set("event", event.id);
        existing.set("schedule_row", game.id);
        if (hasFile) {
          existing.set("file", files);
          existing.set("original_name", body.original_name || "box-score");
        }
        if (gcUrl) existing.set("gc_url", gcUrl);
        existing.set("source", method === "gc_link" ? "gc_url" : "gc_pdf");
        existing.set("status", "queued");
        existing.set("note", "token upload");
        app.save(existing);
      }
    } catch (err) {}
  }

  const state = reconcile(app, rec);
  return { ok: true, state: state.state, view: publicInvite(app, rec) };
}

function unsubscribeToken(app, token) {
  const rec = findByToken(app, token);
  rec.set("unsubscribed", true);
  app.save(rec);
  try {
    const contacts = require(__hooks + "/contacts.js");
    const team = app.findRecordById("event_teams", rec.get("team"));
    const event = app.findRecordById("events", rec.get("event"));
    const row = contacts.upsertForEventTeam(app, event, team, {});
    row.set("box_mail_opt_out", true);
    app.save(row);
  } catch (err) {}
  return { ok: true, stopped: true };
}

function gameStateFromRows(rows) {
  const parsed = rows.filter(function (r) { return hasDate(r, "submitted_at") && r.get("status") !== "invited"; });
  if (parsed.length === 0) {
    if (rows.some(function (r) { return r.get("submitted_at"); })) return "waiting";
    return "none";
  }
  if (parsed.length === 1) return "waiting";
  const a = runsOf(parsed[0]);
  const b = runsOf(parsed[1]);
  if (a && b && a.home === b.home && a.away === b.away) return "verified";
  if (a && b) return "conflict";
  return "waiting";
}

function deskRow(app, rec) {
  const team = (function () {
    try { return app.findRecordById("event_teams", rec.get("team")); } catch (err) { return null; }
  })();
  return {
    id: rec.id,
    team_id: rec.get("team") || "",
    team: team ? team.get("name") : "",
    team_slug: team ? team.get("slug") : "",
    status: rec.get("status") || "invited",
    emailed: hasDate(rec, "emailed_at"),
    reminded: hasDate(rec, "reminder_at"),
    submitted: hasDate(rec, "submitted_at"),
    method: rec.get("method") || "",
    home_runs: rec.get("home_runs"),
    away_runs: rec.get("away_runs"),
    submitted_by: rec.get("submitted_by") || "",
    submitted_at: rec.get("submitted_at") || "",
  };
}

function directorDesk(app, event) {
  const games = [];
  let sched = [];
  try {
    sched = app.findRecordsByFilter("event_schedule", "event = {:e}", "date,time", 2000, 0, { e: event.id });
  } catch (err) { sched = []; }
  for (let i = 0; i < sched.length; i++) {
    const g = sched[i];
    const sides = homeAwayIds(g);
    let rows = [];
    try {
      rows = app.findRecordsByFilter("box_submissions", "event = {:e} && schedule_row = {:g}", "", 8, 0, {
        e: event.id, g: g.id,
      });
    } catch (err) { rows = []; }
    const state = gameStateFromRows(rows);
    games.push({
      id: g.id,
      kind: "schedule",
      game_number: Number(g.get("game_number") || 0) || 0,
      date: g.get("date") || "",
      time: g.get("time") || "",
      field: g.get("field_name") || "",
      home: teamName(app, sides.home),
      away: teamName(app, sides.away),
      home_id: sides.home,
      away_id: sides.away,
      home_slug: teamSlug(app, sides.home),
      away_slug: teamSlug(app, sides.away),
      status: g.get("status") || "",
      score_source: g.get("score_source") || "",
      home_runs: g.get("score_source") === "conflict" ? null : g.get("home_runs"),
      away_runs: g.get("score_source") === "conflict" ? null : g.get("away_runs"),
      book_state: state,
      books: rows.map(function (r) { return deskRow(app, r); }),
    });
  }
  let bracket = [];
  try {
    bracket = app.findRecordsByFilter("bracket_games", "event = {:e}", "date,time", 2000, 0, { e: event.id });
  } catch (err) { bracket = []; }
  for (let i = 0; i < bracket.length; i++) {
    const g = bracket[i];
    if (g.get("status") === "bye") continue;
    const sides = homeAwayIds(g);
    let rows = [];
    try {
      rows = app.findRecordsByFilter("box_submissions", "event = {:e} && bracket_row = {:g}", "", 8, 0, {
        e: event.id, g: g.id,
      });
    } catch (err) { rows = []; }
    const state = gameStateFromRows(rows);
    games.push({
      id: g.id,
      kind: "bracket",
      game_number: Number(g.get("game_number") || 0) || 0,
      date: g.get("date") || "",
      time: g.get("time") || "",
      field: g.get("field_name") || g.get("field") || "",
      home: teamName(app, sides.home),
      away: teamName(app, sides.away),
      home_id: sides.home,
      away_id: sides.away,
      home_slug: teamSlug(app, sides.home),
      away_slug: teamSlug(app, sides.away),
      status: g.get("status") || "",
      score_source: g.get("score_source") || "",
      home_runs: g.get("score_source") === "conflict" ? null : g.get("home_runs"),
      away_runs: g.get("score_source") === "conflict" ? null : g.get("away_runs"),
      book_state: state,
      books: rows.map(function (r) { return deskRow(app, r); }),
    });
  }
  games.sort(function (a, b) {
    if (a.book_state === "conflict" && b.book_state !== "conflict") return -1;
    if (b.book_state === "conflict" && a.book_state !== "conflict") return 1;
    if (a.book_state !== "verified" && b.book_state === "verified") return -1;
    if (b.book_state !== "verified" && a.book_state === "verified") return 1;
    return (a.game_number || 0) - (b.game_number || 0);
  });
  return { games: games };
}

function resendOne(app, event, body) {
  const kind = body.kind === "bracket" ? "bracket" : "schedule";
  const game = app.findRecordById(kind === "bracket" ? "bracket_games" : "event_schedule", body.game_id);
  const team = app.findRecordById("event_teams", body.team_id);
  if (game.get("event") !== event.id || team.get("event") !== event.id) {
    throw new BadRequestError("Game and team must belong to this tournament.");
  }
  const rec = inviteRow(app, event, game, team, kind);
  rec.set("reminder_at", "");
  app.save(rec);
  return sendInvite(app, event, game, team, rec, false, Date.now());
}

function resolveConflict(app, event, body) {
  const kind = body.kind === "bracket" ? "bracket" : "schedule";
  const game = app.findRecordById(kind === "bracket" ? "bracket_games" : "event_schedule", body.game_id);
  if (game.get("event") !== event.id) throw new BadRequestError("Game is not on this tournament");
  let hr = body.home_runs;
  let ar = body.away_runs;
  if (body.pick === "home" || body.pick === "away") {
    const rows = app.findRecordsByFilter(
      "box_submissions",
      kind === "bracket" ? "event = {:e} && bracket_row = {:g}" : "event = {:e} && schedule_row = {:g}",
      "",
      8,
      0,
      { e: event.id, g: game.id },
    );
    const sides = homeAwayIds(game);
    const want = body.pick === "home" ? sides.home : sides.away;
    let chosen = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].get("team") === want && runsOf(rows[i])) chosen = rows[i];
    }
    if (!chosen) throw new BadRequestError("That team does not have a parsed book.");
    hr = chosen.get("home_runs");
    ar = chosen.get("away_runs");
    for (let i = 0; i < rows.length; i++) {
      rows[i].set("status", "verified");
      app.save(rows[i]);
    }
  }
  if (hr == null || ar == null || hr === "" || ar === "") {
    throw new BadRequestError("Enter both run totals or pick a team's book.");
  }
  applyVerified(app, event, game, Number(hr), Number(ar));
  return { ok: true, home_runs: Number(hr), away_runs: Number(ar), score_source: "verified" };
}

module.exports = {
  BUFFER_MINUTES: BUFFER_MINUTES,
  runBoxMail: runBoxMail,
  findByToken: findByToken,
  publicInvite: publicInvite,
  submitToken: submitToken,
  unsubscribeToken: unsubscribeToken,
  directorDesk: directorDesk,
  resendOne: resendOne,
  resolveConflict: resolveConflict,
  expectedEndMs: expectedEndMs,
  teamSlug: teamSlug,
};
