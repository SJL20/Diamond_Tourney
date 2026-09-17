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

export async function eventHome(slug) {
  const board = await fetchBoard(slug);
  const ev = board.event;
  eventRoot().innerHTML = eventChrome(ev, "home", `
    <section class="hero">
      <h1>${escapeHtml(ev.name)}</h1>
      <p class="muted">${escapeHtml(ev.ages)} · ${escapeHtml(ev.venue)} · ${escapeHtml(ev.status)}</p>
      <p>Live standings and a bracket that fills itself. Families stop walking to the fence.</p>
    </section>
    <section class="grid two">
      ${standingsBlock(board.standings)}
      <div class="card">
        <h2>Bracket</h2>
        ${board.bracket.map((g) => `<p><b>${escapeHtml(g.round)}</b> ${escapeHtml(g.home || "TBD")} ${g.status === "final" ? g.home_runs + "–" + g.away_runs : "vs"} ${escapeHtml(g.away || "TBD")}
          ${g.winner ? ` · <span class="badge w">${escapeHtml(g.winner)}</span>` : ""}</p>`).join("") || `<p class="empty">No bracket yet.</p>`}
      </div>
    </section>
  `);
}

export async function eventPools(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "pools", `<section class="grid two">${standingsBlock(board.standings)}</section>`);
}

export async function eventBracket(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "bracket", `
    <section class="card">
      <h2>Bracket</h2>
      <p class="muted">Winners move forward when a score is final. Locked rosters stay locked.</p>
      ${table(["Round", "Home", "Away", "Score", "Winner"], board.bracket.map((g) => `<tr>
        <td>${escapeHtml(g.round)} ${g.slot || ""}</td>
        <td>${escapeHtml(g.home || "TBD")}</td>
        <td>${escapeHtml(g.away || "TBD")}</td>
        <td>${g.status === "final" ? `${g.home_runs}–${g.away_runs}` : g.status}</td>
        <td>${escapeHtml(g.winner || "")}</td>
      </tr>`))}
    </section>`);
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
