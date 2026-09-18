const ROLES = ["head_coach", "team_manager", "billing"];

function contactJson(rec) {
  if (!rec) {
    return {
      coach_email: "",
      coach_phone: "",
      alt_name: "",
      alt_email: "",
      alt_phone: "",
      role: "head_coach",
    };
  }
  return {
    id: rec.id,
    coach_email: rec.get("coach_email") || "",
    coach_phone: rec.get("coach_phone") || "",
    alt_name: rec.get("alt_name") || "",
    alt_email: rec.get("alt_email") || "",
    alt_phone: rec.get("alt_phone") || "",
    role: rec.get("role") || "head_coach",
  };
}

function findForEventTeam(app, eventTeamId) {
  if (!eventTeamId) return null;
  try {
    return app.findFirstRecordByFilter("team_contacts", "event_team = {:t}", { t: eventTeamId });
  } catch (err) {
    return null;
  }
}

function findForSeasonTeam(app, teamId) {
  if (!teamId) return null;
  try {
    return app.findFirstRecordByFilter("team_contacts", "team = {:t}", { t: teamId });
  } catch (err) {
    return null;
  }
}

function applyFields(rec, data) {
  if (!data) return rec;
  if (data.coach_email != null) rec.set("coach_email", String(data.coach_email || "").trim().toLowerCase());
  if (data.coach_phone != null) rec.set("coach_phone", String(data.coach_phone || "").trim());
  if (data.alt_name != null) rec.set("alt_name", String(data.alt_name || "").trim());
  if (data.alt_email != null) rec.set("alt_email", String(data.alt_email || "").trim().toLowerCase());
  if (data.alt_phone != null) rec.set("alt_phone", String(data.alt_phone || "").trim());
  if (data.role && ROLES.indexOf(data.role) !== -1) rec.set("role", data.role);
  if (!rec.get("role")) rec.set("role", "head_coach");
  return rec;
}

function upsertForEventTeam(app, event, team, data) {
  let rec = findForEventTeam(app, team.id);
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId("team_contacts"));
    rec.set("event", event.id);
    rec.set("event_team", team.id);
  }
  applyFields(rec, data);
  app.save(rec);
  return rec;
}

function upsertForSeasonTeam(app, team, data) {
  let rec = findForSeasonTeam(app, team.id);
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId("team_contacts"));
    rec.set("team", team.id);
  }
  applyFields(rec, data);
  app.save(rec);
  return rec;
}

function emailsMatch(auth, rec) {
  if (!auth || !rec) return false;
  const mine = String(auth.email ? auth.email() : "").trim().toLowerCase();
  if (!mine) return false;
  const a = String(rec.get("coach_email") || "").trim().toLowerCase();
  const b = String(rec.get("alt_email") || "").trim().toLowerCase();
  return mine === a || mine === b;
}

function canSeeEventContact(event, team, auth, app) {
  if (!auth) return false;
  const sb = require(__hooks + "/softball.js");
  if (sb.isEventAdmin(event, auth, app)) return true;
  if (team && team.get("account") && team.get("account") === auth.id) return true;
  if (team && team.get("contact_email") && team.get("contact_email") === auth.email()) return true;
  return emailsMatch(auth, findForEventTeam(app, team && team.id));
}

function canSeeSeasonContact(team, auth) {
  if (!auth || !team) return false;
  const sb = require(__hooks + "/softball.js");
  if (sb.isSiteAdmin(auth)) return true;
  return !!(auth.get("team") && auth.get("team") === team.id);
}

function attachVisible(app, event, teams, auth) {
  if (!auth || !teams) return teams;
  for (let i = 0; i < teams.length; i++) {
    const row = teams[i];
    let rec = null;
    try { rec = app.findRecordById("event_teams", row.id); } catch (err) { continue; }
    if (!canSeeEventContact(event, rec, auth, app)) continue;
    row.contact = contactJson(findForEventTeam(app, rec.id));
    row.age_group = rec.get("age_group") || "";
    row.klass = rec.get("klass") || "";
    row.paid = !!rec.get("paid");
    row.registered_at = rec.get("registered_at") || "";
    row.notes = rec.get("notes") || "";
    row.contact_name = rec.get("contact_name") || "";
  }
  return teams;
}

function contactEmails(app, team) {
  const out = [];
  const seen = {};
  function add(raw) {
    const email = String(raw || "").trim().toLowerCase();
    if (!email || email.indexOf("@") === -1 || seen[email]) return;
    seen[email] = true;
    out.push(email);
  }
  if (team) add(team.get("contact_email"));
  const rec = findForEventTeam(app, team && team.id);
  if (rec) {
    add(rec.get("coach_email"));
    add(rec.get("alt_email"));
  }
  return out;
}

module.exports = {
  contactJson: contactJson,
  findForEventTeam: findForEventTeam,
  findForSeasonTeam: findForSeasonTeam,
  upsertForEventTeam: upsertForEventTeam,
  upsertForSeasonTeam: upsertForSeasonTeam,
  canSeeEventContact: canSeeEventContact,
  canSeeSeasonContact: canSeeSeasonContact,
  attachVisible: attachVisible,
  contactEmails: contactEmails,
  emailsMatch: emailsMatch,
};
