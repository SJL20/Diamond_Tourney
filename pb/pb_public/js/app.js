import { battingAverage, contactPct, era, strikePct, outsToIp } from "./metrics.js";
import {
  directorDuplicate, directorImport, directorImportPopup, directorLinkTm, directorNative, eventAdmin, eventAwards,
  eventBracket, eventGame, eventHome, eventInfo, eventLeaders, eventList, eventOverall,
  eventSchedule, eventSignup, eventStandings, eventStats, eventTeamPage, boxUploadPage, boxStopPage, boxHelpPage,
  startTournament,
} from "./event.js";
import { accountHome, adminEvents, adminTeams, findPage, forgotPage, resetPage, startGate, verifyPage, yearPage } from "./flow.js";
import { flashSaved, isSiteAdmin, pageShell } from "./chrome.js";

const pb = new PocketBase(location.origin);
const app = document.getElementById("app");

const ROUTES = [
  [/^\/login\/?$/, "login"],
  [/^\/register\/?$/, "register"],
  [/^\/forgot\/?$/, "forgot"],
  [/^\/reset\/?$/, "reset"],
  [/^\/verify\/?$/, "verify"],
  [/^\/find\/?$/, "find"],
  [/^\/account\/?$/, "account"],
  [/^\/admin\/events\/?$/, "adminEvents"],
  [/^\/admin\/teams\/?$/, "adminTeams"],
  [/^\/year\/([^/]+)\/?$/, "year"],
  [/^\/year\/?$/, "year"],
  [/^\/start\/?$/, "start"],
  [/^\/directors\/new\/?$/, "native"],
  [/^\/directors\/link-tm\/?$/, "linktm"],
  [/^\/directors\/import\/?$/, "import"],
  [/^\/directors\/import-popup\/?$/, "importpopup"],
  [/^\/directors\/duplicate\/?$/, "duplicate"],
  [/^\/t\/?$/, "events"],
  [/^\/t\/([^/]+)\/standings\/?$/, "estandings"],
  [/^\/t\/([^/]+)\/pools\/?$/, "estandings"],
  [/^\/t\/([^/]+)\/bracket\/?$/, "ebracket"],
  [/^\/t\/([^/]+)\/overall\/?$/, "eoverall"],
  [/^\/t\/([^/]+)\/schedule\/?$/, "eschedule"],
  [/^\/t\/([^/]+)\/games\/([^/]+)\/?$/, "egame"],
  [/^\/t\/([^/]+)\/leaders\/?$/, "eleaders"],
  [/^\/t\/([^/]+)\/stats\/?$/, "estats"],
  [/^\/t\/([^/]+)\/awards\/?$/, "eawards"],
  [/^\/t\/([^/]+)\/signup\/?$/, "esignup"],
  [/^\/t\/([^/]+)\/info\/?$/, "einfo"],
  [/^\/t\/([^/]+)\/admin\/?$/, "eadmin"],
  [/^\/t\/([^/]+)\/team\/([^/]+)\/?$/, "eteam"],
  [/^\/t\/([^/]+)\/?$/, "ehome"],
  [/^\/box\/([^/]+)\/stop\/?$/, "boxstop"],
  [/^\/box\/([^/]+)\/?$/, "boxupload"],
  [/^\/help\/box-score\/?$/, "boxhelp"],
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
  return isSiteAdmin(u) || (u.role === "team_coach" && u.team === teamId);
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
  return pageShell({ pb, team, page, body });
}

function table(headers, rows, totals) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.join("")}</tbody>
    ${totals ? `<tfoot><tr class="total">${totals}</tr></tfoot>` : ""}
  </table></div>`;
}

async function landing() {
  if (user()) return accountHome();
  return startGate("login");
}

async function login() {
  if (user()) return accountHome();
  return startGate("login");
}

async function requireTeamPage(slug, page) {
  if (!user()) {
    go("/login");
    return null;
  }
  const team = await teamBySlug(slug);
  if (!isCoachOf(team.id) && !isSiteAdmin(user())) {
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
    <section class="page-head">
      <div class="row">
        <div class="stat"><b>${team.public_record_wins || 0}-${team.public_record_losses || 0}</b><span>Season W-L</span></div>
        <div class="stat"><b>${games[0] ? escapeHtml(games[0].opponent) : "—"}</b><span>Last game</span></div>
      </div>
      <p>${escapeHtml(team.coach_note || "")}</p>
      <p class="muted">Last five: ${last5 || "No approved games yet."}</p>
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
    sort: "-id",
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
    <section class="page-head">
      <h1>Review queue</h1>
      <p class="muted">Staging only. Approve copies lines into the live book. Rejected games never touch BA or the record.</p>
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
      flashSaved(btn.dataset.act === "approve" ? "Game approved" : "Game rejected");
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
    if (name === "register") return startGate("register");
    if (name === "forgot") return forgotPage();
    if (name === "reset") return resetPage();
    if (name === "verify") return verifyPage();
    if (name === "find") return findPage();
    if (name === "account") return accountHome();
    if (name === "adminEvents") return adminEvents();
    if (name === "adminTeams") return adminTeams();
    if (name === "year") return yearPage(params[0] || "2026");
    if (name === "landing" || name === "teams") return landing();
    if (name === "start") {
      if (!user()) return startGate("login");
      return startTournament();
    }
    if (name === "native") return directorNative();
    if (name === "linktm") return directorLinkTm();
    if (name === "import") return directorImport();
    if (name === "importpopup") return directorImportPopup();
    if (name === "duplicate") return directorDuplicate();
    if (name === "events") return eventList();
    if (name === "ehome") return eventHome(params[0]);
    if (name === "estandings" || name === "epools") return eventStandings(params[0]);
    if (name === "ebracket") return eventBracket(params[0]);
    if (name === "eoverall") return eventOverall(params[0]);
    if (name === "eschedule") return eventSchedule(params[0]);
    if (name === "egame") return eventGame(params[0], params[1]);
    if (name === "eleaders") return eventLeaders(params[0]);
    if (name === "estats") return eventStats(params[0]);
    if (name === "eawards") return eventAwards(params[0]);
    if (name === "esignup") return eventSignup(params[0]);
    if (name === "einfo") return eventInfo(params[0]);
    if (name === "eadmin") return eventAdmin(params[0]);
    if (name === "eteam") return eventTeamPage(params[0], params[1]);
    if (name === "boxupload") return boxUploadPage(params[0]);
    if (name === "boxstop") return boxStopPage(params[0]);
    if (name === "boxhelp") return boxHelpPage();
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
window.addEventListener("popstate", () => { render().catch((err) => console.error(err)); });
render().catch((err) => {
  app.innerHTML = chrome(null, "", `<section class="card error"><p>Could not load this page.</p><pre>${escapeHtml(String(err?.message || err))}</pre></section>`);
});
