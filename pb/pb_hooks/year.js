function eventYear(event, fallback) {
  const start = String(event.get("start") || "");
  const m = start.match(/^(\d{4})/);
  return m ? m[1] : String(fallback || "2026");
}

function clubSlug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "club";
}

function upsertClub(app, data) {
  const url = data.gamechanger_url || "";
  const fromUrl = (function () {
    const m = String(url).match(/^https?:\/\/([^?#]+)/i);
    return m ? m[1].replace(/\/+$/, "") : "";
  })();
  const baseSlug = clubSlug(data.name || fromUrl || data.gc_team_ref);
  const gcTeamRef = String(data.gc_team_ref || fromUrl || ("manual:" + baseSlug)).replace(/\/+$/, "");
  if (!gcTeamRef) return null;
  let rec;
  try {
    rec = app.findFirstRecordByData("club_teams", "gc_team_ref", gcTeamRef);
  } catch (err) {
    rec = new Record(app.findCollectionByNameOrId("club_teams"));
    rec.set("gc_team_ref", gcTeamRef);
    let slug = clubSlug(data.name || gcTeamRef);
    let n = 2;
    while (true) {
      try {
        app.findFirstRecordByData("club_teams", "slug", slug);
        slug = clubSlug(data.name || gcTeamRef) + "-" + n;
        n++;
      } catch (miss) {
        break;
      }
    }
    rec.set("slug", slug);
  }
  rec.set("name", data.name || rec.get("name") || gcTeamRef);
  if (url) rec.set("gamechanger_url", url);
  if (data.ages) rec.set("ages", data.ages);
  app.save(rec);
  return rec;
}

function clubKey(app, eventTeam) {
  const clubId = eventTeam.get("club");
  if (clubId) {
    try {
      const club = app.findRecordById("club_teams", clubId);
      return { id: club.id, name: club.get("name"), slug: club.get("slug"), gc: true };
    } catch (err) {}
  }
  return {
    id: "et:" + eventTeam.id,
    name: eventTeam.get("name"),
    slug: eventTeam.get("slug"),
    gc: !!eventTeam.get("gamechanger_url"),
  };
}

function yearEvents(app, year) {
  const all = app.findRecordsByFilter("events", "public = true", "name", 80, 0);
  return all.filter(function (ev) { return eventYear(ev, year) === String(year); });
}

function addTeamGame(map, key, meta, us, them) {
  if (!map[key]) {
    map[key] = { id: key, name: meta.name, slug: meta.slug, gc_linked: meta.gc, w: 0, l: 0, t: 0, rs: 0, ra: 0, events: 0 };
  }
  map[key].rs += us;
  map[key].ra += them;
  if (us > them) map[key].w += 1;
  else if (us < them) map[key].l += 1;
  else map[key].t += 1;
}

function yearBoard(app, year) {
  year = String(year || "2026");
  const events = yearEvents(app, year);
  const teams = {};
  const hitting = {};
  const pitching = {};
  const eventList = [];

  for (const ev of events) {
    eventList.push({ name: ev.get("name"), slug: ev.get("slug"), venue: ev.get("venue") || "", ages: ev.get("ages") || "" });
    const seenClubs = {};
    const etById = {};
    const roster = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 80, 0, { e: ev.id });
    for (const t of roster) {
      etById[t.id] = clubKey(app, t);
      const ck = etById[t.id].id;
      if (!seenClubs[ck]) {
        seenClubs[ck] = true;
        if (!teams[ck]) {
          teams[ck] = {
            id: ck,
            name: etById[t.id].name,
            slug: etById[t.id].slug,
            gc_linked: etById[t.id].gc,
            w: 0, l: 0, t: 0, rs: 0, ra: 0, events: 0,
          };
        }
        teams[ck].events += 1;
      }
    }
    const games = app.findRecordsByFilter(
      "event_schedule",
      "event = {:e} && status = 'final'",
      "",
      400,
      0,
      { e: ev.id },
    );
    for (const g of games) {
      const home = etById[g.get("home")];
      const away = etById[g.get("away")];
      if (!home || !away) continue;
      const hr = Number(g.get("home_runs") || 0);
      const ar = Number(g.get("away_runs") || 0);
      addTeamGame(teams, home.id, home, hr, ar);
      addTeamGame(teams, away.id, away, ar, hr);
    }
    const bracket = app.findRecordsByFilter(
      "bracket_games",
      "event = {:e} && status = 'final'",
      "",
      80,
      0,
      { e: ev.id },
    );
    for (const g of bracket) {
      const home = etById[g.get("home_team")];
      const away = etById[g.get("away_team")];
      if (!home || !away) continue;
      const hr = Number(g.get("home_runs") || 0);
      const ar = Number(g.get("away_runs") || 0);
      addTeamGame(teams, home.id, home, hr, ar);
      addTeamGame(teams, away.id, away, ar, hr);
    }
    if (ev.get("source") === "popup") {
      for (const t of roster) {
        const meta = etById[t.id];
        if (!meta) continue;
        const w = Number(t.get("published_w") || 0);
        const l = Number(t.get("published_l") || 0);
        const ties = Number(t.get("published_t") || 0);
        const rs = Number(t.get("published_rf") || 0);
        const ra = Number(t.get("published_ra") || 0);
        if (w + l + ties === 0) continue;
        if (!teams[meta.id]) {
          teams[meta.id] = { id: meta.id, name: meta.name, slug: meta.slug, gc_linked: meta.gc, w: 0, l: 0, t: 0, rs: 0, ra: 0, events: 0 };
        }
        teams[meta.id].w += w;
        teams[meta.id].l += l;
        teams[meta.id].t += ties;
        teams[meta.id].rs += rs;
        teams[meta.id].ra += ra;
      }
    }

    const leaders = require(__hooks + "/diamond.js").eventLeaders(app, ev.id);
    for (const r of leaders.hitting) {
      const key = (r.name_key || "") + "|" + (r.team || "");
      if (!hitting[key]) hitting[key] = { name_key: r.name_key, team: r.team, ab: 0, h: 0, rbi: 0, so: 0 };
      hitting[key].ab += r.ab;
      hitting[key].h += r.h;
      hitting[key].rbi += r.rbi;
      hitting[key].so += r.so || 0;
    }
    for (const r of leaders.pitching) {
      const key = (r.name_key || "") + "|" + (r.team || "");
      if (!pitching[key]) pitching[key] = { name_key: r.name_key, team: r.team, ip_outs: 0, er: 0, so: 0 };
      pitching[key].ip_outs += r.ip_outs;
      pitching[key].er += r.er;
      pitching[key].so += r.so || 0;
    }
  }

  const teamRows = Object.values(teams).sort(function (a, b) {
    if (a.w !== b.w) return b.w - a.w;
    if (a.l !== b.l) return a.l - b.l;
    if (a.ra !== b.ra) return a.ra - b.ra;
    return b.rs - a.rs;
  }).map(function (t, i) {
    t.rank = i + 1;
    t.diff = t.rs - t.ra;
    return t;
  });

  const hitRows = Object.values(hitting).map(function (r) {
    r.avg = r.ab ? r.h / r.ab : 0;
    r.avg_display = r.ab ? (r.h / r.ab).toFixed(3).replace(/^0/, "") : ".000";
    return r;
  }).filter(function (r) { return r.ab >= 8; }).sort(function (a, b) { return b.avg - a.avg; });

  const pitRows = Object.values(pitching).map(function (r) {
    r.ip = Math.floor(r.ip_outs / 3) + "." + (r.ip_outs % 3);
    r.era = r.ip_outs ? (r.er * 7) / (r.ip_outs / 3) : null;
    r.era_display = r.era == null ? "—" : r.era.toFixed(2);
    return r;
  }).filter(function (r) { return r.ip_outs >= 9; }).sort(function (a, b) {
    if (a.era == null) return 1;
    if (b.era == null) return -1;
    return a.era - b.era;
  });

  return {
    year: year,
    events: eventList,
    teams: teamRows,
    hitting: hitRows.slice(0, 25),
    pitching: pitRows.slice(0, 25),
  };
}

module.exports = {
  eventYear: eventYear,
  upsertClub: upsertClub,
  yearBoard: yearBoard,
};
