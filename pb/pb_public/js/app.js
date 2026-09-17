import { battingAverage, contactPct, era, strikePct, outsToIp } from "./metrics.js";
import {
  directorImport, eventAwards, eventBracket, eventHome, eventLeaders,
  eventList, eventPools, eventSchedule,
} from "./event.js";

const pb = new PocketBase(location.origin);
const app = document.getElementById("app");

const ROUTES = [
  [/^\/login\/?$/, "login"],
  [/^\/directors\/import\/?$/, "import"],
  [/^\/t\/?$/, "events"],
  [/^\/t\/([^/]+)\/pools\/?$/, "epools"],
  [/^\/t\/([^/]+)\/bracket\/?$/, "ebracket"],
  [/^\/t\/([^/]+)\/schedule\/?$/, "eschedule"],
  [/^\/t\/([^/]+)\/leaders\/?$/, "eleaders"],
  [/^\/t\/([^/]+)\/awards\/?$/, "eawards"],
  [/^\/t\/([^/]+)\/?$/, "ehome"],
  [/^\/teams\/?$/, "teams"],
  [/^\/teams\/([^/]+)\/home\/?$/, "home"],
  [/^\/teams\/([^/]+)\/roster\/?$/, "roster"],
  [/^\/teams\/([^/]+)\/hitting\/?$/, "hitting"],
  [/^\/teams\/([^/]+)\/pitching\/?$/, "pitching"],
  [/^\/teams\/([^/]+)\/games\/([^/]+)\/?$/, "box"],
  [/^\/teams\/([^/]+)\/games\/?$/, "games"],
  [/^\/teams\/([^/]+)\/admin\/review\/?$/, "review"],
  [/^\/teams\/([^/]+)\/?$/, "publicTeam"],
  [/^\/?$/, "landing"],
];

function pathOf() {
  return location.pathname.replace(/\/+$/, "") || "/";
}

function matchRoute() {
  const path = pathOf();
  for (const [re, name] of ROUTES) {
    const m = path.match(re);
    if (m) return { name, params: m.slice(1) };
  }
  return { name: "notfound", params: [] };
}

function go(href) {
  history.pushState({}, "", href);
  render();
}

function user() {
  return pb.authStore.record;
}

function isCoachOf(teamId) {
  const u = user();
  if (!u) return false;
  return u.role === "region_admin" || (u.role === "team_coach" && u.team === teamId);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function teamBySlug(slug) {
  const res = await pb.collection("teams").getFirstListItem(`slug="${slug}"`);
  return res;
}

function chrome(team, page, body) {
  const slug = team?.slug;
  const links = slug ? [
    ["/teams/" + slug + "/home", "Home"],
    ["/teams/" + slug + "/roster", "Roster"],
    ["/teams/" + slug + "/hitting", "Hitting"],
    ["/teams/" + slug + "/pitching", "Pitching"],
    ["/teams/" + slug + "/games", "Games"],
  ] : [];
  if (slug && isCoachOf(team.id)) links.push(["/teams/" + slug + "/admin/review", "Review"]);
  const who = user() ? user().email : "signed out";
  return `
    <header class="wrap top">
      <a class="brand" href="/"><b>DIAMOND TOURNEY</b><span>${team ? escapeHtml(team.name) : "Keep the clipboard. Lose the group text."}</span></a>
      <nav class="nav">
        ${links.map(([href, label]) => `<a class="${page === label.toLowerCase() ? "active" : ""}" data-link href="${href}">${label}</a>`).join("")}
        <a data-link href="/t">Tournaments</a>
        ${user() ? `<button class="link" id="logout">Sign out</button>` : `<a data-link href="/login">Log in</a>`}
      </nav>
    </header>
    <main class="wrap">${body}</main>
    <footer class="wrap footer">${escapeHtml(who)} · Stats stay in staging until a coach approves.</footer>
  `;
}

function table(headers, rows, totals) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.join("")}</tbody>
    ${totals ? `<tfoot><tr class="total">${totals}</tr></tfoot>` : ""}
  </table></div>`;
}

async function landing() {
  const teams = await pb.collection("teams").getFullList({ sort: "age_group,name" });
  let events = [];
  try {
    events = await pb.collection("events").getFullList({ filter: "public=true", sort: "-start" });
  } catch (err) {}
  const cards = teams.map((t) => `
    <a class="card team-card" data-link href="${user() && isCoachOf(t.id) ? `/teams/${t.slug}/home` : `/teams/${t.slug}`}">
      <h3>${escapeHtml(t.name)}</h3>
      <p class="muted">${escapeHtml(t.age_group)} · public record only</p>
      <p><b>${t.public_record_wins || 0}-${t.public_record_losses || 0}</b>${t.public_record_ties ? `-${t.public_record_ties}` : ""}</p>
    </a>`).join("");
  app.innerHTML = chrome(null, "landing", `
    <section class="hero">
      <h1>Keep the clipboard. Lose the group text.</h1>
      <p>Diamond Tourney is the public weekend board. Region team books stay behind a coach login. Use as much of it as you want.</p>
    </section>
    <section class="grid cards">
      <a class="card team-card" data-link href="/directors/import">
        <h3>You already have a schedule</h3>
        <p class="muted">START HERE · door three</p>
        <p>Paste the Excel / Tourney Machine / legal-pad grid. Get a link, live standings, and a bracket that fills itself.</p>
      </a>
      <a class="card team-card" data-link href="/t/central-saturday">
        <h3>Just look at a live board</h3>
        <p class="muted">Central Saturday · 10U</p>
        <p>Pools, bracket, leaders, and a print-ready award sheet.</p>
      </a>
      <a class="card team-card" data-link href="/login">
        <h3>Season team book</h3>
        <p class="muted">Coach login</p>
        <p>Approve GameChanger boxes. Nothing publishes unverified.</p>
      </a>
    </section>
    <section class="card">
      <h2>This weekend</h2>
      ${events.map((ev) => `<p><a data-link href="/t/${ev.slug}"><b>${escapeHtml(ev.name)}</b></a> · ${escapeHtml(ev.venue || "")} · ${escapeHtml(ev.ages || "")}</p>`).join("") || `<p class="muted">No public events yet.</p>`}
    </section>
    <section class="grid cards">${cards || `<div class="card empty">No teams yet.</div>`}</section>
  `);
}

async function login() {
  app.innerHTML = chrome(null, "login", `
    <section class="hero">
      <h1>Log in</h1>
      <p class="muted">Team books require a coach or region admin account. The bot account can write staging only.</p>
      <form class="form" id="login-form">
        <label>Email <input name="email" type="email" autocomplete="username" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Enter team book</button>
        <p class="error" id="login-error" hidden></p>
      </form>
      ${["localhost", "127.0.0.1"].includes(location.hostname) ? `
        <div class="accounts">
          <p><b>Local accounts</b></p>
          <p>owner@local.test / RegionAdmin1!</p>
          <p>coach.demo@local.test / CoachDemo1!</p>
          <p>coach.hawks@local.test / CoachHawks1!</p>
          <p>td@local.test / EventTd1!</p>
          <p>bot@local.test / BotStaging1! (API only)</p>
        </div>` : ""}
    </section>
  `);
  document.getElementById("login-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(ev.target);
    const err = document.getElementById("login-error");
    try {
      await pb.collection("users").authWithPassword(data.get("email"), data.get("password"));
      const u = user();
      if (u.role === "team_coach" && u.team) {
        const team = await pb.collection("teams").getOne(u.team);
        go("/teams/" + team.slug + "/home");
      } else {
        go("/");
      }
    } catch (e) {
      err.hidden = false;
      err.textContent = "Login failed. Check the email and password.";
    }
  });
}

async function requireTeamPage(slug, page) {
  if (!user()) {
    go("/login");
    return null;
  }
  const team = await teamBySlug(slug);
  if (!isCoachOf(team.id) && user().role !== "region_admin") {
    app.innerHTML = chrome(team, page, `<section class="card empty">You can see the public record for this team, not the book.</section>`);
    return null;
  }
  return team;
}

async function publicTeam(slug) {
  const team = await teamBySlug(slug);
  if (user() && isCoachOf(team.id)) return home(slug);
  app.innerHTML = chrome(team, "public", `
    <section class="hero">
      <h1>${escapeHtml(team.name)}</h1>
      <p class="muted">${escapeHtml(team.age_group)} · public card</p>
      <div class="row"><div class="stat"><b>${team.public_record_wins || 0}-${team.public_record_losses || 0}</b><span>W-L</span></div></div>
      <p>Player stats are in the team book after login.</p>
    </section>
  `);
}

async function loadGames(teamId) {
  return pb.collection("team_games").getFullList({
    filter: `team="${teamId}" && status="approved"`,
    sort: "-date",
  });
}

async function loadPlayers(teamId) {
  return pb.collection("players").getFullList({
    filter: `team="${teamId}"`,
    sort: "jersey",
  });
}

async function loadHitting(teamId) {
  return pb.collection("hitting_game").getFullList({
    filter: `game.team="${teamId}" && game.status="approved"`,
    expand: "player,game",
  });
}

async function loadPitching(teamId) {
  return pb.collection("pitching_game").getFullList({
    filter: `game.team="${teamId}" && game.status="approved"`,
    expand: "player,game",
  });
}

function rollHit(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = row.player;
    const cur = map.get(id) || { player: row.expand?.player, ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 };
    cur.ab += row.ab || 0; cur.r += row.r || 0; cur.h += row.h || 0;
    cur.rbi += row.rbi || 0; cur.bb += row.bb || 0; cur.so += row.so || 0;
    map.set(id, cur);
  }
  return [...map.values()];
}

function rollPit(rows) {
  const map = new Map();
  for (const row of rows) {
    const id = row.player;
    const cur = map.get(id) || { player: row.expand?.player, ip_outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, pitches: 0, strikes: 0 };
    cur.ip_outs += row.ip_outs || 0; cur.h += row.h || 0; cur.r += row.r || 0;
    cur.er += row.er || 0; cur.bb += row.bb || 0; cur.so += row.so || 0;
    cur.pitches += row.pitches || 0; cur.strikes += row.strikes || 0;
    map.set(id, cur);
  }
  return [...map.values()];
}

async function home(slug) {
  const team = await requireTeamPage(slug, "home");
  if (!team) return;
  const games = await loadGames(team.id);
  const last5 = games.slice(0, 5).map((g) =>
    `<span class="badge ${g.result.toLowerCase()}">${g.result} ${escapeHtml(g.opponent)} ${g.us_runs}-${g.them_runs}</span>`
  ).join(" ");
  app.innerHTML = chrome(team, "home", `
    <section class="hero">
      <h1>${escapeHtml(team.name)}</h1>
      <p class="muted">${escapeHtml(team.age_group)} · ${escapeHtml(team.coach_name || "")}</p>
      <div class="row">
        <div class="stat"><b>${team.public_record_wins || 0}-${team.public_record_losses || 0}</b><span>Season W-L</span></div>
        <div class="stat"><b>${games[0] ? escapeHtml(games[0].opponent) : "—"}</b><span>Last game</span></div>
      </div>
      <p>${escapeHtml(team.coach_note || "")}</p>
      <p>Last five: ${last5 || "No approved games yet."}</p>
    </section>
  `);
}

async function roster(slug) {
  const team = await requireTeamPage(slug, "roster");
  if (!team) return;
  const players = await loadPlayers(team.id);
  const rows = players.map((p) => `<tr>
    <td>${escapeHtml(p.jersey)}</td><td>${escapeHtml(p.display_name)} ${p.display_name.includes("FAKE") ? `<span class="badge fake">FAKE</span>` : ""}</td>
    <td>${escapeHtml(p.name_key)}</td><td>${escapeHtml(p.positions)}</td>
    <td>${escapeHtml(p.bats)}/${escapeHtml(p.throws)}</td><td>${p.grad_year || ""}</td>
  </tr>`);
  app.innerHTML = chrome(team, "roster", `<section class="card"><h2>Roster</h2>
    ${table(["#", "Name", "Key", "Pos", "B/T", "Grad"], rows)}</section>`);
}

async function hitting(slug) {
  const team = await requireTeamPage(slug, "hitting");
  if (!team) return;
  const rolled = rollHit(await loadHitting(team.id));
  const totals = rolled.reduce((a, r) => ({ ab: a.ab + r.ab, r: a.r + r.r, h: a.h + r.h, rbi: a.rbi + r.rbi, bb: a.bb + r.bb, so: a.so + r.so }), { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0 });
  const rows = rolled.sort((a, b) => Number(a.player?.jersey || 0) - Number(b.player?.jersey || 0)).map((r) => `<tr>
    <td>${escapeHtml(r.player?.jersey)}</td><td>${escapeHtml(r.player?.display_name)}</td>
    <td>${r.ab}</td><td>${r.r}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.bb}</td><td>${r.so}</td>
    <td>${battingAverage(r.h, r.ab)}</td><td>${contactPct(r.ab, r.so)}</td>
  </tr>`);
  app.innerHTML = chrome(team, "hitting", `<section class="card"><h2>Hitting</h2>
    <p class="muted">Approved games only. BA to three decimals. Contact% = (AB − SO) / AB.</p>
    ${table(["#", "Player", "AB", "R", "H", "RBI", "BB", "SO", "BA", "Contact%"], rows,
      `<td colspan="2">Team</td><td>${totals.ab}</td><td>${totals.r}</td><td>${totals.h}</td><td>${totals.rbi}</td><td>${totals.bb}</td><td>${totals.so}</td><td>${battingAverage(totals.h, totals.ab)}</td><td>${contactPct(totals.ab, totals.so)}</td>`)}
  </section>`);
}

async function pitching(slug) {
  const team = await requireTeamPage(slug, "pitching");
  if (!team) return;
  const rolled = rollPit(await loadPitching(team.id));
  const totals = rolled.reduce((a, r) => ({
    ip_outs: a.ip_outs + r.ip_outs, h: a.h + r.h, r: a.r + r.r, er: a.er + r.er,
    bb: a.bb + r.bb, so: a.so + r.so, pitches: a.pitches + r.pitches, strikes: a.strikes + r.strikes,
  }), { ip_outs: 0, h: 0, r: 0, er: 0, bb: 0, so: 0, pitches: 0, strikes: 0 });
  const rows = rolled.map((r) => `<tr>
    <td>${escapeHtml(r.player?.jersey)}</td><td>${escapeHtml(r.player?.display_name)}</td>
    <td>${outsToIp(r.ip_outs)}</td><td>${r.h}</td><td>${r.r}</td><td>${r.er}</td><td>${r.bb}</td><td>${r.so}</td>
    <td>${r.pitches || "—"}</td><td>${r.strikes || "—"}</td>
    <td>${era(r.er, r.ip_outs)}</td><td>${strikePct(r.strikes, r.pitches)}</td>
  </tr>`);
  app.innerHTML = chrome(team, "pitching", `<section class="card"><h2>Pitching</h2>
    <p class="muted">IP stored as outs. Youth ERA = (ER × 7) / IP.</p>
    ${table(["#", "Player", "IP", "H", "R", "ER", "BB", "SO", "P", "S", "ERA", "Strike%"], rows,
      `<td colspan="2">Team</td><td>${outsToIp(totals.ip_outs)}</td><td>${totals.h}</td><td>${totals.r}</td><td>${totals.er}</td><td>${totals.bb}</td><td>${totals.so}</td><td>${totals.pitches}</td><td>${totals.strikes}</td><td>${era(totals.er, totals.ip_outs)}</td><td>${strikePct(totals.strikes, totals.pitches)}</td>`)}
  </section>`);
}

async function games(slug) {
  const team = await requireTeamPage(slug, "games");
  if (!team) return;
  const rows = (await loadGames(team.id)).map((g) => `<tr>
    <td>${escapeHtml(g.date)}</td>
    <td><a data-link href="/teams/${slug}/games/${g.id}">${escapeHtml(g.opponent)}</a></td>
    <td>${g.us_runs}-${g.them_runs}</td>
    <td><span class="badge ${g.result.toLowerCase()}">${g.result}</span></td>
    <td>${escapeHtml(g.source)}</td>
  </tr>`);
  app.innerHTML = chrome(team, "games", `<section class="card"><h2>Game log</h2>
    ${rows.length ? table(["Date", "Opponent", "Score", "Rslt", "Source"], rows) : `<p class="empty">No approved games.</p>`}
  </section>`);
}

async function box(slug, gameId) {
  const team = await requireTeamPage(slug, "games");
  if (!team) return;
  const game = await pb.collection("team_games").getOne(gameId);
  const hittingRows = await pb.collection("hitting_game").getFullList({ filter: `game="${gameId}"`, expand: "player" });
  const pitchingRows = await pb.collection("pitching_game").getFullList({ filter: `game="${gameId}"`, expand: "player" });
  const h = hittingRows.map((r) => `<tr><td>${escapeHtml(r.expand.player.jersey)}</td><td>${escapeHtml(r.expand.player.display_name)}</td>
    <td>${r.ab}</td><td>${r.r}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.bb}</td><td>${r.so}</td></tr>`);
  const p = pitchingRows.map((r) => `<tr><td>${escapeHtml(r.expand.player.jersey)}</td><td>${escapeHtml(r.expand.player.display_name)}</td>
    <td>${outsToIp(r.ip_outs)}</td><td>${r.h}</td><td>${r.r}</td><td>${r.er}</td><td>${r.bb}</td><td>${r.so}</td><td>${era(r.er, r.ip_outs)}</td></tr>`);
  app.innerHTML = chrome(team, "games", `
    <section class="hero"><h1>${escapeHtml(game.opponent)}</h1>
      <p>${escapeHtml(game.date)} · ${game.us_runs}-${game.them_runs} · <span class="badge ${game.result.toLowerCase()}">${game.result}</span></p>
    </section>
    <section class="grid two">
      <div class="card"><h2>Hitting</h2>${table(["#", "Player", "AB", "R", "H", "RBI", "BB", "SO"], h)}</div>
      <div class="card"><h2>Pitching</h2>${table(["#", "Player", "IP", "H", "R", "ER", "BB", "SO", "ERA"], p)}</div>
    </section>`);
}

function previewTable(payload) {
  const hitting = (payload.hitting || []).map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${r.ab ?? "null"}</td><td>${r.r ?? "null"}</td><td>${r.h ?? "null"}</td>
    <td>${r.rbi ?? "null"}</td><td>${r.bb ?? "null"}</td><td>${r.so ?? "null"}</td></tr>`).join("");
  const pitching = (payload.pitching || []).map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.ip || r.ip_outs)}</td><td>${r.h ?? "null"}</td>
    <td>${r.er ?? "null"}</td><td>${r.so ?? "null"}</td></tr>`).join("");
  return `<div class="grid two">
    <div>${table(["Player", "AB", "R", "H", "RBI", "BB", "SO"], hitting ? [hitting] : ["<tr><td colspan=7 class=empty>No hitting lines</td></tr>"])}</div>
    <div>${table(["Player", "IP", "H", "ER", "SO"], pitching ? [pitching] : ["<tr><td colspan=5 class=empty>No pitching lines</td></tr>"])}</div>
  </div>`;
}

async function review(slug) {
  const team = await requireTeamPage(slug, "review");
  if (!team) return;
  const items = await pb.collection("staging_games").getFullList({
    filter: `team="${team.id}"`,
    sort: "-created",
  });
  const cards = items.map((s) => {
    const payload = typeof s.payload === "string" ? JSON.parse(s.payload || "{}") : (s.payload || {});
    return `<article class="card" data-staging="${s.id}">
      <h3>${escapeHtml(payload.opponent || "Unknown opponent")} · ${escapeHtml(payload.date || "no date")}</h3>
      <p><span class="badge ${s.status}">${s.status}</span> ${payload.us_runs ?? "?"}–${payload.them_runs ?? "?"}</p>
      <p class="muted">${escapeHtml(s.parser_notes || "No parser notes.")}</p>
      ${previewTable(payload)}
      ${(s.status === "staged" || s.status === "needs_review") ? `
        <p>
          <button class="btn" data-act="approve">Approve</button>
          <button class="btn ghost" data-act="reject">Reject</button>
        </p>` : `<p class="muted">Decision already recorded.</p>`}
    </article>`;
  }).join("");
  app.innerHTML = chrome(team, "review", `
    <section class="hero"><h1>Review queue</h1>
      <p>Bot A writes staging only. Approving copies lines into the live book and rebuilds W-L. Rejected games never touch BA or the record.</p>
    </section>
    <section class="grid">${cards || `<div class="card empty">Nothing in staging. Drop a GameChanger box to Bot A.</div>`}</section>
  `);
  app.querySelectorAll("[data-act]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const id = btn.closest("[data-staging]").dataset.staging;
      const res = await fetch(`/api/coach/staging/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ decision: btn.dataset.act }),
      });
      if (!res.ok) {
        const t = await res.text();
        alert("Decision failed: " + t);
        btn.disabled = false;
        return;
      }
      render();
    });
  });
}

async function teams() {
  return landing();
}

async function render() {
  const { name, params } = matchRoute();
  try {
    if (name === "login") return login();
    if (name === "landing" || name === "teams") return landing();
    if (name === "import") return directorImport();
    if (name === "events") return eventList();
    if (name === "ehome") return eventHome(params[0]);
    if (name === "epools") return eventPools(params[0]);
    if (name === "ebracket") return eventBracket(params[0]);
    if (name === "eschedule") return eventSchedule(params[0]);
    if (name === "eleaders") return eventLeaders(params[0]);
    if (name === "eawards") return eventAwards(params[0]);
    if (name === "publicTeam") return publicTeam(params[0]);
    if (name === "home") return home(params[0]);
    if (name === "roster") return roster(params[0]);
    if (name === "hitting") return hitting(params[0]);
    if (name === "pitching") return pitching(params[0]);
    if (name === "games") return games(params[0]);
    if (name === "box") return box(params[0], params[1]);
    if (name === "review") return review(params[0]);
    app.innerHTML = chrome(null, "", `<section class="card empty">Page not found.</section>`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("404") || msg.toLowerCase().includes("not found")) {
      app.innerHTML = chrome(null, "", `<section class="card empty">That team was not found.</section>`);
      return;
    }
    if (msg.includes("403") || msg.toLowerCase().includes("forbidden")) {
      app.innerHTML = chrome(null, "", `<section class="card empty">You do not have access to this book.</section>`);
      return;
    }
    app.innerHTML = chrome(null, "", `<section class="card error"><p>Could not load this page.</p><pre>${escapeHtml(msg)}</pre></section>`);
  }
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-link]");
  if (a) {
    e.preventDefault();
    go(a.getAttribute("href"));
  }
  if (e.target.id === "logout") {
    pb.authStore.clear();
    go("/");
  }
});
window.addEventListener("popstate", render);
render();
