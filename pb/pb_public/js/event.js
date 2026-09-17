const eventRoot = () => document.getElementById("app");
const eventPb = new PocketBase(location.origin);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${(rows || []).join("")}</tbody></table></div>`;
}

function goEvent(href) {
  history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function eventChrome(event, page, body, extraNav = []) {
  const slug = event?.slug;
  const links = slug ? [
    ["/t/" + slug, "Home"],
    ["/t/" + slug + "/pools", "Pools"],
    ["/t/" + slug + "/bracket", "Bracket"],
    ["/t/" + slug + "/schedule", "Schedule"],
    ["/t/" + slug + "/leaders", "Leaders"],
    ["/t/" + slug + "/awards", "Awards"],
  ] : [];
  return `
    <header class="wrap top">
      <a class="brand" href="/"><b>DIAMOND TOURNEY</b><span>${event ? escapeHtml(event.name) : "Keep the clipboard. Lose the group text."}</span></a>
      <nav class="nav">
        ${links.map(([href, label]) => `<a class="${page === label.toLowerCase() ? "active" : ""}" data-link href="${href}">${label}</a>`).join("")}
        ${extraNav.join("")}
        <a data-link href="/">Region books</a>
      </nav>
    </header>
    <main class="wrap">${body}</main>
    <footer class="wrap footer">Public board · boxes stay unverified until a coach confirms · ${escapeHtml(event?.venue || "")}</footer>
  `;
}

async function fetchBoard(slug) {
  const res = await fetch("/api/event/" + encodeURIComponent(slug) + "/board");
  if (!res.ok) throw new Error("Event board failed");
  return res.json();
}

function standingsBlock(standings) {
  return (standings || []).map((pool) => `
    <div class="card">
      <h2>Pool ${escapeHtml(pool.name)}</h2>
      ${table(["#", "Team", "W", "L", "RS", "RA", "Diff"], pool.teams.map((t) => `<tr>
        <td>${t.seed}</td><td>${escapeHtml(t.name)}</td><td>${t.w}</td><td>${t.l}</td>
        <td>${t.rs}</td><td>${t.ra}</td><td>${t.diff}</td>
      </tr>`))}
      <p class="muted">Tiebreak: wins, then losses, then head-to-head, then runs allowed, then runs scored.</p>
    </div>`).join("");
}

const ROUND_META = {
  QF: { label: "Quarterfinals", order: 1 },
  SF: { label: "Semifinals", order: 2 },
  F: { label: "Championship", order: 3 },
  CSF: { label: "Consolation semis", order: 1 },
  CF: { label: "Consolation final", order: 2 },
  "5TH": { label: "5th place", order: 1 },
  "3RD": { label: "3rd place", order: 2 },
};

function gameSide(g) {
  if (g.side) return g.side;
  const r = String(g.round || "").toUpperCase();
  return /^(C|3RD|5TH|CONS)/.test(r) ? "consolation" : "championship";
}

function matchCard(g) {
  const homeWin = g.status === "final" && g.winner && g.winner === g.home;
  const awayWin = g.status === "final" && g.winner && g.winner === g.away;
  return `<article class="bk-match ${escapeHtml(g.status)}">
    <div class="bk-team ${homeWin ? "winner" : ""} ${g.home ? "" : "tbd"}">
      <span>${escapeHtml(g.home || "TBD")}</span>
      <b>${g.status === "final" ? g.home_runs : ""}</b>
    </div>
    <div class="bk-team ${awayWin ? "winner" : ""} ${g.away ? "" : "tbd"}">
      <span>${escapeHtml(g.away || "TBD")}</span>
      <b>${g.status === "final" ? g.away_runs : ""}</b>
    </div>
    <p class="bk-meta">${g.status === "final" ? "Final" : "Scheduled"}</p>
  </article>`;
}

function renderBracketTree(games, title, blurb, showChampion) {
  if (!games.length) return "";
  const byRound = {};
  for (const g of games) {
    const r = g.round;
    if (!byRound[r]) byRound[r] = [];
    byRound[r].push(g);
  }
  for (const r of Object.keys(byRound)) {
    byRound[r].sort((a, b) => (a.slot || 0) - (b.slot || 0));
  }
  const rounds = Object.keys(byRound).sort(
    (a, b) => (ROUND_META[a]?.order || 50) - (ROUND_META[b]?.order || 50),
  );
  const champ = games.find((g) => g.round === "F" && g.status === "final" && g.winner);
  return `<section class="card bk-card ${showChampion ? "champ-side" : "cons-side"}">
    <h2>${title}</h2>
    <p class="muted">${blurb}</p>
    <div class="bk-viz">
      ${rounds.map((r) => `
        <div class="bk-round">
          <h3>${ROUND_META[r]?.label || r}</h3>
          <div class="bk-round-games n${byRound[r].length}">${byRound[r].map(matchCard).join("")}</div>
        </div>`).join("")}
      ${showChampion ? `<div class="bk-round">
        <h3>Champion</h3>
        <div class="bk-trophy ${champ ? "named" : "tbd"}">${escapeHtml(champ?.winner || "TBD")}</div>
      </div>` : ""}
    </div>
  </section>`;
}

function bracketBoards(games) {
  const champ = games.filter((g) => gameSide(g) === "championship");
  const cons = games.filter((g) => gameSide(g) === "consolation");
  return `
    ${renderBracketTree(champ, "Championship", "Winners move right when a score is final. Locked rosters stay locked.", true)}
    ${renderBracketTree(cons, "Consolation", "Outside the championship. These games do not feed the final.", false)}
  `;
}

export async function eventHome(slug) {
  const board = await fetchBoard(slug);
  const ev = board.event;
  eventRoot().innerHTML = eventChrome(ev, "home", `
    <section class="hero">
      <h1>${escapeHtml(ev.name)}</h1>
      <p class="muted">${escapeHtml(ev.ages)} · ${escapeHtml(ev.venue)} · ${escapeHtml(ev.status)}</p>
      <p>Live standings and a bracket that fills itself. Families stop walking to the fence.</p>
    </section>
    <section class="grid two">${standingsBlock(board.standings)}</section>
    ${bracketBoards(board.bracket)}
  `);
}

export async function eventPools(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "pools", `<section class="grid two">${standingsBlock(board.standings)}</section>`);
}

export async function eventBracket(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "bracket", `
    <section class="hero">
      <h1>Bracket</h1>
      <p>Championship on top. Consolation sits to the side and never feeds the title game.</p>
    </section>
    ${board.bracket.length ? bracketBoards(board.bracket) : `<section class="card empty">No bracket games yet.</section>`}
  `);
}

export async function eventSchedule(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "schedule", `
    <section class="card">
      <h2>Schedule</h2>
      ${table(["Time", "Home", "Away", "Score", "Status"], board.schedule.map((g) => `<tr>
        <td>${escapeHtml(g.date)} ${escapeHtml(g.time)}</td>
        <td>${escapeHtml(g.home)}</td><td>${escapeHtml(g.away)}</td>
        <td>${g.status === "final" ? `${g.home_runs}–${g.away_runs}` : "—"}</td>
        <td>${escapeHtml(g.status)}</td>
      </tr>`))}
    </section>`);
}

export async function eventLeaders(slug) {
  const board = await fetchBoard(slug);
  const hit = board.leaders.hitting.map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ab}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.avg_display}</td>
  </tr>`);
  const pit = board.leaders.pitching.map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ip}</td><td>${r.er}</td><td>${r.so}</td><td>${r.era_display}</td>
  </tr>`);
  const counts = board.leaders.pitch_counts.map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ip}</td><td>${board.event.pitch_limit_ip}.0</td>
    <td>${r.ip_outs > board.event.pitch_limit_ip * 3 ? `<span class="badge l">over</span>` : `<span class="badge w">ok</span>`}</td>
  </tr>`);
  eventRoot().innerHTML = eventChrome(board.event, "leaders", `
    <section class="grid two">
      <div class="card"><h2>Hitting leaders</h2><p class="muted">Min 8 AB</p>
        ${table(["Player", "Team", "AB", "H", "RBI", "AVG"], hit)}</div>
      <div class="card"><h2>Pitching leaders</h2><p class="muted">Min 3.0 IP · youth ERA base 7</p>
        ${table(["Player", "Team", "IP", "ER", "SO", "ERA"], pit)}</div>
    </section>
    <section class="card"><h2>Pitching counts</h2>
      <p class="muted">Weekend limit ${board.event.pitch_limit_ip}.0 IP. Tracked in one place, not forty texts.</p>
      ${table(["Player", "Team", "IP used", "Limit", ""], counts)}
    </section>`);
}

export async function eventAwards(slug) {
  const board = await fetchBoard(slug);
  const at = board.leaders.all_tournament;
  eventRoot().innerHTML = eventChrome(board.event, "awards", `
    <section class="hero print-sheet">
      <h1>All-tournament · ${escapeHtml(board.event.name)}</h1>
      <p>Picked on numbers. Not on which kid the director happened to watch.</p>
      <p><button class="btn" onclick="window.print()">Print award sheet</button></p>
    </section>
    <section class="grid two">
      <div class="card"><h2>Hitters</h2>
        ${table(["Player", "Team", "AVG", "RBI"], at.hitters.map((r) => `<tr>
          <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
          <td>${r.avg_display}</td><td>${r.rbi}</td></tr>`))}
      </div>
      <div class="card"><h2>Pitchers</h2>
        ${table(["Player", "Team", "IP", "ERA"], at.pitchers.map((r) => `<tr>
          <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
          <td>${r.ip}</td><td>${r.era_display}</td></tr>`))}
      </div>
    </section>
    <p class="muted">Print Sunday at the field while everybody is still there.</p>
  `);
}

export async function eventList() {
  const events = await eventPb.collection("events").getFullList({ filter: "public=true", sort: "-start" });
  eventRoot().innerHTML = eventChrome(null, "", `
    <section class="hero"><h1>Tournaments</h1>
      <p>Public boards only. Season books stay behind a coach login.</p></section>
    <section class="grid cards">${events.map((ev) => `
      <a class="card team-card" data-link href="/t/${ev.slug}">
        <h3>${escapeHtml(ev.name)}</h3>
        <p class="muted">${escapeHtml(ev.ages)} · ${escapeHtml(ev.venue)}</p>
      </a>`).join("") || `<div class="card empty">No public events.</div>`}
    </section>`);
}

export async function directorImport() {
  const u = eventPb.authStore.record;
  if (!u || (u.role !== "region_admin" && u.role !== "event_td")) {
    eventRoot().innerHTML = eventChrome(null, "", `<section class="card"><p>Director login required.</p><p><a class="btn" data-link href="/login">Log in</a></p></section>`);
    return;
  }
  eventRoot().innerHTML = eventChrome(null, "", `
    <section class="hero">
      <h1>You already have a schedule</h1>
      <p>Bring the grid from Excel, Tourney Machine, or a legal pad. Nothing to abandon.</p>
    </section>
    <section class="card">
      <form class="form" id="import-form" style="max-width:none">
        <label>Event slug <input name="event_slug" value="clipboard-open" required></label>
        <label>Event name <input name="event_name" value="Clipboard Open"></label>
        <label>CSV (header required)
          <textarea name="csv" rows="10">date,time,home,away,pool,home_runs,away_runs,status
2026-09-20,09:00,Northside,West End,A,5,3,final
2026-09-20,09:00,Eastside,South Ridge,B,,,scheduled</textarea>
        </label>
        <button class="btn" type="submit">Publish the public link</button>
        <p class="error" id="import-err" hidden></p>
      </form>
    </section>`);
  document.getElementById("import-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    const res = await fetch("/api/event/import-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: eventPb.authStore.token },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      document.getElementById("import-err").hidden = false;
      document.getElementById("import-err").textContent = await res.text();
      return;
    }
    goEvent("/t/" + data.event_slug);
  });
}
