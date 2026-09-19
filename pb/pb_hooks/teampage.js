/// <reference path="../pb_data/types.d.ts" />

function publicTeam(app, event, teamSlug, auth) {
  const team = app.findFirstRecordByFilter(
    "event_teams",
    "event = {:e} && slug = {:s}",
    { e: event.id, s: String(teamSlug || "") },
  );
  const sb = require(__hooks + "/softball.js");
  const diamond = require(__hooks + "/diamond.js");
  const schedule = require(__hooks + "/schedule.js");
  const host = require(__hooks + "/host.js");
  const admin = sb.isEventAdmin(event, auth, app);
  const manager = !!(auth && (
    team.get("account") === auth.id
    || (team.get("contact_email") && String(team.get("contact_email")).toLowerCase() === String(auth.email()).toLowerCase())
  ));
  const board = diamond.publicBoard(app, event, auth);
  const mine = [];
  const all = (board.overall || []).concat([]);
  for (let i = 0; i < all.length; i++) {
    const g = all[i];
    if (g.home === team.get("name") || g.away === team.get("name") || g.home_id === team.id || g.away_id === team.id) {
      mine.push(g);
    }
  }
  mine.sort(diamond.compareWeekendGames);
  const now = new Date().toISOString().slice(0, 16);
  let next = null;
  for (let i = 0; i < mine.length; i++) {
    const g = mine[i];
    const stamp = String(g.date || "") + "T" + String(g.time || "99:99");
    if (g.status === "final" || g.status === "cancelled") continue;
    if (!g.home || !g.away) continue;
    if (stamp >= now || !g.date) {
      next = g;
      break;
    }
  }
  if (!next) {
    for (let i = 0; i < mine.length; i++) {
      if (mine[i].home && mine[i].away && mine[i].status !== "final") {
        next = mine[i];
        break;
      }
    }
  }
  let standing = null;
  const pools = board.standings || [];
  for (let p = 0; p < pools.length; p++) {
    const rows = pools[p].teams || [];
    for (let t = 0; t < rows.length; t++) {
      if (rows[t].id === team.id || rows[t].slug === team.get("slug")) {
        standing = {
          pool: pools[p].name,
          seed: rows[t].seed,
          seed_reason: rows[t].seed_reason || "",
          w: rows[t].w, l: rows[t].l, t: rows[t].t,
          rs: rows[t].rs, ra: rows[t].ra,
        };
      }
    }
  }
  const hitting = ((board.leaders && (board.leaders.full_hitting || board.leaders.hitting)) || []).filter(function (r) {
    return r.team === team.get("name");
  });
  const pitching = ((board.leaders && (board.leaders.full_pitching || board.leaders.pitching)) || []).filter(function (r) {
    return r.team === team.get("name");
  });
  const path = (board.bracket || []).filter(function (g) {
    return g.home === team.get("name") || g.away === team.get("name") || g.home_id === team.id || g.away_id === team.id;
  });
  const out = {
    event: {
      name: event.get("name"),
      slug: event.get("slug"),
      venue: event.get("venue") || "",
      ages: event.get("ages") || "",
      can_admin: admin,
    },
    team: {
      id: team.id,
      name: team.get("name"),
      slug: team.get("slug"),
      pool: team.get("pool") || "",
      gamechanger_url: team.get("gamechanger_url") || "",
      gc_linked: host.isGameChangerUrl(team.get("gamechanger_url")),
    },
    next: next,
    schedule: mine,
    standing: standing,
    hitting: hitting,
    pitching: pitching,
    bracket_path: path,
  };
  if (admin || manager) {
    const contacts = require(__hooks + "/contacts.js");
    if (contacts.canSeeEventContact(event, team, auth, app)) {
      out.paid = !!team.get("paid");
      out.packet_status = team.get("packet_status") || "";
    }
    try {
      const books = app.findRecordsByFilter("box_submissions", "event = {:e} && team = {:t}", "", 80, 0, {
        e: event.id, t: team.id,
      });
      out.box_scores = books.map(function (r) {
        return {
          game_id: r.get("schedule_row") || r.get("bracket_row") || "",
          status: r.get("status") || "",
          submitted: !!r.get("submitted_at"),
        };
      });
    } catch (err) {
      out.box_scores = [];
    }
    if (admin) out.edit = "/t/" + event.get("slug") + "/admin#admin-teams";
  }
  return out;
}

module.exports = {
  publicTeam: publicTeam,
};
