function requireUser(auth) {
  if (!auth) throw new UnauthorizedError("login required");
  let superuser = false;
  try { superuser = !!(auth.isSuperuser && auth.isSuperuser()); } catch (err) { superuser = false; }
  if (superuser) throw new ForbiddenError("Use a site login to follow a team.");
  return auth;
}

function findFollow(app, userId, target) {
  try {
    return app.findFirstRecordByFilter("follows", "user = {:u} && target = {:t}", { u: userId, t: target });
  } catch (err) {
    return null;
  }
}

function addFollow(app, auth, target, eventId, clubId) {
  const existing = findFollow(app, auth.id, target);
  if (existing) return existing;
  const rec = new Record(app.findCollectionByNameOrId("follows"));
  rec.set("user", auth.id);
  rec.set("target", target);
  if (eventId) rec.set("event", eventId);
  if (clubId) rec.set("club", clubId);
  app.save(rec);
  return rec;
}

function dropFollow(app, auth, target) {
  const existing = findFollow(app, auth.id, target);
  if (existing) app.delete(existing);
  return { ok: true, following: false };
}

function publicEvent(app, id) {
  try {
    const ev = app.findRecordById("events", id);
    if (!ev.get("public") || ev.get("status") === "archived") return null;
    return ev;
  } catch (err) {
    return null;
  }
}

function listFollowing(app, auth) {
  requireUser(auth);
  let rows = [];
  try {
    rows = app.findRecordsByFilter("follows", "user = {:u}", "", 200, 0, { u: auth.id });
  } catch (err) {
    rows = [];
  }
  const direct = {};
  const clubIds = {};
  for (let i = 0; i < rows.length; i++) {
    const target = String(rows[i].get("target") || "");
    if (target.indexOf("event:") === 0) direct[target.slice(6)] = true;
    else if (target.indexOf("club:") === 0) clubIds[target.slice(5)] = true;
  }
  const teams = [];
  const clubIdList = Object.keys(clubIds);
  for (let i = 0; i < clubIdList.length; i++) {
    try {
      const club = app.findRecordById("club_teams", clubIdList[i]);
      teams.push({ id: club.id, name: club.get("name") || "", slug: club.get("slug") || "" });
    } catch (err) {}
  }
  const teamIn = {};
  if (teams.length) {
    const parts = [];
    const params = {};
    for (let i = 0; i < teams.length; i++) {
      parts.push("club = {:c" + i + "}");
      params["c" + i] = teams[i].id;
    }
    let memberships = [];
    try {
      memberships = app.findRecordsByFilter("event_teams", parts.join(" || "), "name", 500, 0, params);
    } catch (err) {
      memberships = [];
    }
    for (let i = 0; i < memberships.length; i++) {
      const evId = memberships[i].get("event");
      if (!evId || teamIn[evId]) continue;
      teamIn[evId] = memberships[i].get("name") || "";
    }
  }
  const seen = {};
  const tournaments = [];
  function push(id, via, teamName) {
    if (!id) return;
    if (seen[id]) {
      if (via === "team" && seen[id].via === "event") {
        seen[id].via = "both";
        seen[id].team = teamName || seen[id].team;
      }
      return;
    }
    const ev = publicEvent(app, id);
    if (!ev) return;
    const row = {
      slug: ev.get("slug") || "",
      name: ev.get("name") || "",
      start: String(ev.get("start") || "").slice(0, 10),
      via: via,
      team: teamName || "",
    };
    seen[id] = row;
    tournaments.push(row);
  }
  Object.keys(direct).forEach(function (id) { push(id, "event", ""); });
  Object.keys(teamIn).forEach(function (id) { push(id, "team", teamIn[id]); });
  tournaments.sort(function (a, b) {
    if (a.start !== b.start) return a.start < b.start ? 1 : -1;
    return a.name < b.name ? -1 : 1;
  });
  return { teams: teams, tournaments: tournaments };
}

function followEvent(app, auth, slug, on) {
  requireUser(auth);
  const key = String(slug || "").trim();
  if (!key) throw new BadRequestError("Name the tournament to follow.");
  let ev;
  try { ev = app.findFirstRecordByData("events", "slug", key); }
  catch (err) { throw new NotFoundError("That tournament was not found."); }
  if (!ev.get("public") || ev.get("status") === "archived") {
    throw new BadRequestError("That tournament is not on the public board.");
  }
  const target = "event:" + ev.id;
  if (!on) return dropFollow(app, auth, target);
  addFollow(app, auth, target, ev.id, "");
  return { ok: true, following: true, kind: "event", slug: ev.get("slug") };
}

function clubForTeam(app, team) {
  const existing = team.get("club");
  if (existing) {
    try { return app.findRecordById("club_teams", existing); } catch (err) {}
  }
  const club = require(__hooks + "/year.js").upsertClub(app, {
    name: team.get("name"),
    gamechanger_url: team.get("gamechanger_url") || "",
  });
  if (!club) throw new BadRequestError("That team cannot be followed yet.");
  if (team.get("club") !== club.id) {
    team.set("club", club.id);
    app.save(team);
  }
  return club;
}

function followTeam(app, auth, eventSlug, teamSlug, on) {
  requireUser(auth);
  const evKey = String(eventSlug || "").trim();
  const tmKey = String(teamSlug || "").trim();
  if (!evKey || !tmKey) throw new BadRequestError("Name the team and the tournament.");
  let ev;
  try { ev = app.findFirstRecordByData("events", "slug", evKey); }
  catch (err) { throw new NotFoundError("That tournament was not found."); }
  let team;
  try {
    team = app.findFirstRecordByFilter("event_teams", "event = {:e} && slug = {:s}", { e: ev.id, s: tmKey });
  } catch (err) {
    throw new NotFoundError("That team is not in this tournament.");
  }
  const club = clubForTeam(app, team);
  const target = "club:" + club.id;
  if (!on) return dropFollow(app, auth, target);
  addFollow(app, auth, target, "", club.id);
  return { ok: true, following: true, kind: "team", slug: club.get("slug"), name: club.get("name"), id: club.id };
}

function unfollowClub(app, auth, clubId) {
  requireUser(auth);
  const id = String(clubId || "").trim();
  if (!id) throw new BadRequestError("Name the team to stop following.");
  return dropFollow(app, auth, "club:" + id);
}

function setFollow(app, auth, body, on) {
  const kind = String((body && body.kind) || "");
  if (kind === "event") return followEvent(app, auth, body.slug, on);
  if (kind === "team") return followTeam(app, auth, body.event, body.slug, on);
  if (kind === "club" && !on) return unfollowClub(app, auth, (body && (body.id || body.club)) || "");
  throw new BadRequestError("Follow a tournament or a team.");
}

module.exports = {
  listFollowing: listFollowing,
  setFollow: setFollow,
};
