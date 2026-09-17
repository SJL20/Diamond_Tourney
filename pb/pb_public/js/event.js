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

function isDirector() {
  const u = eventPb.authStore.record;
  return u && (u.role === "region_admin" || u.role === "event_td");
}

function authHeader() {
  return eventPb.authStore.token ? { Authorization: eventPb.authStore.token } : {};
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
  if (slug && event?.signup_open !== false) {
    links.push(["/t/" + slug + "/signup", "Sign up"]);
  }
  if (slug && event?.packet) {
    links.push(["/t/" + slug + "/stats", "Stats"]);
    links.push(["/t/" + slug + "/info", "Info"]);
  }
  if (slug && isDirector()) {
    links.push(["/t/" + slug + "/admin", "Admin"]);
  }
  return `
    <header class="wrap top">
      <a class="brand" href="/"><b>DIAMOND TOURNEY</b><span>${event ? escapeHtml(event.name) : "Keep the clipboard. Lose the group text."}</span></a>
      <nav class="nav">
        ${links.map(([href, label]) => `<a class="${page === label.toLowerCase() ? "active" : ""}" data-link href="${href}">${label}</a>`).join("")}
        ${extraNav.join("")}
        <a data-link href="/find">Find</a>
        <a data-link href="/year/2026">Year</a>
        <a data-link href="/start">Create</a>
        <a data-link href="/account">Account</a>
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
      <h2>${pool.name === "All teams" ? "Pool standings" : "Pool " + escapeHtml(pool.name)}</h2>
      ${pool.note ? `<p class="muted">${escapeHtml(pool.note)}</p>` : ""}
      ${table(["#", "Team", "W", "L", "RS", "RA", "Diff"], pool.teams.map((t) => `<tr>
        <td>${t.seed}</td>
        <td>${t.gamechanger_url ? `<a href="${escapeHtml(t.gamechanger_url)}" target="_blank" rel="noopener">${escapeHtml(t.name)}</a>` : escapeHtml(t.name)}${t.host ? ` <span class="badge host">host</span>` : ""}</td>
        <td>${t.w}</td><td>${t.l}</td>
        <td>${t.rs}</td><td>${t.ra}</td><td>${t.diff > 0 ? "+" : ""}${t.diff}</td>
      </tr>`))}
      <p class="muted">Tiebreak: record, then fewest runs allowed, then run differential. Official seeds follow Tourney Machine — the director may apply head-to-head.</p>
    </div>`).join("");
}

const ROUND_META = {
  QF: { label: "Quarterfinals", order: 1 },
  SF: { label: "Semifinals", order: 2 },
  F: { label: "Championship", order: 3 },
  CSF: { label: "Consolation semis", order: 1 },
  CF: { label: "Consolation championship", order: 3 },
  "5TH": { label: "5th place", order: 1 },
  "3RD": { label: "3rd place", order: 2 },
  "7TH": { label: "7th place", order: 2 },
};

function sourceLabel(ev) {
  if (!ev) return "Hosted";
  if (ev.source === "popup") return "Keystone Clash popup";
  if (ev.source === "tourneymachine") return "Tourney Machine";
  return "Hosted";
}

function gameSide(g) {
  if (g.side) return g.side;
  const r = String(g.round || "").toUpperCase();
  return /^(C|3RD|5TH|CONS)/.test(r) ? "consolation" : "championship";
}

function matchCard(g) {
  const tie = !!(g.tie || (g.status === "final" && g.home_runs === g.away_runs && g.home && g.away));
  const homeWin = !tie && g.status === "final" && g.winner && g.winner === g.home;
  const awayWin = !tie && g.status === "final" && g.winner && g.winner === g.away;
  const meta = [g.game_id, g.field, g.time, tie ? "Tie" : g.status === "final" ? "Final" : "Scheduled"].filter(Boolean);
  return `<article class="bk-match ${escapeHtml(g.status)} ${tie ? "tie" : ""}">
    <div class="bk-team ${homeWin ? "winner" : ""} ${g.home ? "" : "tbd"}">
      <span>${escapeHtml(g.home || "TBD")}</span>
      <b>${g.status === "final" ? g.home_runs : ""}</b>
    </div>
    <div class="bk-team ${awayWin ? "winner" : ""} ${g.away ? "" : "tbd"}">
      <span>${escapeHtml(g.away || "TBD")}</span>
      <b>${g.status === "final" ? g.away_runs : ""}</b>
    </div>
    <p class="bk-meta">${escapeHtml(meta.join(" · "))}</p>
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

function rosterBlock(teams) {
  if (!teams || !teams.length) {
    return `<section class="card empty">No teams signed up yet. A team can join with or without GameChanger.</section>`;
  }
  return `<section class="card">
    <h2>Teams</h2>
    <p class="muted">Each GameChanger link is the public page the coach published. This host stores that URL. It does not scrape private GameChanger pages.</p>
    <div class="gc-grid">${teams.map((t) => `
      <article class="gc-card ${t.host ? "host" : ""}">
        <b>${escapeHtml(t.name)}${t.host ? ` <span class="badge host">host</span>` : ""}${t.seed ? ` <span class="muted">#${t.seed}</span>` : ""}</b>
        ${t.gc_linked && t.gamechanger_url
          ? `<a href="${escapeHtml(t.gamechanger_url)}" target="_blank" rel="noopener">Open on GameChanger</a>`
          : `<span class="muted">No GameChanger linked</span>`}
      </article>`).join("")}</div>
  </section>`;
}

export async function eventHome(slug) {
  const board = await fetchBoard(slug);
  const ev = board.event;
  const packet = board.packet || ev.packet;
  const champ = packet?.champion;
  eventRoot().innerHTML = eventChrome(ev, "home", `
    <section class="hero">
      <h1>${escapeHtml(ev.name)}</h1>
      <p class="muted">${escapeHtml(ev.ages || "")} · ${escapeHtml(ev.dates || packet?.dates || "")} · ${escapeHtml(ev.venue)} · ${sourceLabel(ev)}</p>
      <p>${escapeHtml(ev.status_note || packet?.status || "Live standings and a bracket that fills itself.")}</p>
      <p>
        ${ev.signup_open ? `<a class="btn" data-link href="/t/${ev.slug}/signup">Sign a team up</a>` : `<span class="muted">Signup is closed.</span>`}
        ${ev.slug === "keystone-clash-2026" ? ` <a class="btn" data-link href="/t/${ev.slug}/stats">Full stats</a> <a class="btn ghost" href="/popup/index.html">Popup site</a>` : ""}
        ${ev.tm_url ? ` <a class="btn ghost" href="${escapeHtml(ev.tm_url)}" target="_blank" rel="noopener">Official Tourney Machine bracket</a>` : ""}
      </p>
    </section>
    ${champ ? `<section class="champ-banner">
      <div class="k">Champions</div>
      <div class="t">${escapeHtml(champ.team)}</div>
      <p>${escapeHtml(champ.record || "")}${champ.line ? " — " + escapeHtml(champ.line) : ""}</p>
      ${packet?.runner_up ? `<div class="ru"><span>Runner-up</span><b>${escapeHtml(packet.runner_up.team)}</b> ${escapeHtml(packet.runner_up.record || "")}</div>` : ""}
    </section>` : ""}
    ${rosterBlock(board.roster)}
    <section class="grid two">${standingsBlock(board.standings)}</section>
    ${packet?.bracket_note || packet?.bracket_venue ? `<p class="muted">${escapeHtml([packet.bracket_venue, packet.bracket_note].filter(Boolean).join(" — "))}</p>` : ""}
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
  const packet = board.packet || board.event.packet;
  const rows = [
    ...board.schedule.map((g) => ({
      date: g.date, time: g.time, field: "", game_id: "",
      home: g.home, away: g.away, home_runs: g.home_runs, away_runs: g.away_runs, status: g.status,
    })),
    ...board.bracket.map((g) => ({
      date: g.date, time: g.time, field: g.field, game_id: g.game_id,
      home: g.home, away: g.away, home_runs: g.home_runs, away_runs: g.away_runs, status: g.status,
    })),
  ].sort((a, b) => String(a.date + a.time + a.game_id).localeCompare(String(b.date + b.time + b.game_id)));
  eventRoot().innerHTML = eventChrome(board.event, "schedule", `
    <section class="card">
      <h2>Schedule</h2>
      ${packet?.info?.pool_note ? `<p class="muted">${escapeHtml(packet.info.pool_note)}</p>` : ""}
      ${packet?.bracket_venue ? `<p class="muted">${escapeHtml(packet.bracket_venue)}${packet.bracket_note ? " — " + escapeHtml(packet.bracket_note) : ""}</p>` : ""}
      ${rows.length ? table(["When", "Field", "Home", "Away", "Score", ""], rows.map((g) => `<tr>
        <td>${escapeHtml(g.date || "")} ${escapeHtml(g.time || "")}</td>
        <td>${escapeHtml([g.game_id, g.field].filter(Boolean).join(" · "))}</td>
        <td>${escapeHtml(g.home)}</td><td>${escapeHtml(g.away)}</td>
        <td>${g.status === "final" ? `${g.home_runs}–${g.away_runs}` : "—"}</td>
        <td>${escapeHtml(g.status)}</td>
      </tr>`)) : `<p class="empty">No scored games on the public board yet.</p>`}
    </section>`);
}

export async function eventLeaders(slug) {
  const board = await fetchBoard(slug);
  const publishedHit = board.leaders.published_hitting || [];
  const publishedPit = board.leaders.published_pitching || [];
  const fullHit = board.leaders.full_hitting || [];
  const hit = (publishedHit.length ? publishedHit : board.leaders.hitting).map((r) => `<tr>
    <td>${escapeHtml(r.player || r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ab ?? ""}</td><td>${r.h ?? ""}</td><td>${r.rbi ?? ""}</td>
    <td>${r.avg || r.avg_display || ""}</td><td>${r.ops || ""}</td>
  </tr>`);
  const pit = (publishedPit.length ? publishedPit : board.leaders.pitching).map((r) => `<tr>
    <td>${escapeHtml(r.player || r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ip ?? ""}</td><td>${r.k ?? r.so ?? ""}</td><td>${r.era || r.era_display || ""}</td>
  </tr>`);
  const full = fullHit.filter((r) => r.q !== false).concat(fullHit.filter((r) => r.q === false));
  const counts = board.leaders.pitch_counts.map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ip}</td><td>${board.event.pitch_limit_ip}.0</td>
    <td>${r.ip_outs > board.event.pitch_limit_ip * 3 ? `<span class="badge l">over</span>` : `<span class="badge w">ok</span>`}</td>
  </tr>`);
  eventRoot().innerHTML = eventChrome(board.event, "leaders", `
    <section class="hero">
      <h1>Stat leaders</h1>
      <p class="muted">${escapeHtml(board.leaders.stats_note || "Qualifying minimums are 8 at-bats and 5 innings. Lines come from each team’s published scorebook.")}</p>
    </section>
    <section class="grid two">
      <div class="card"><h2>Hitting leaders</h2><p class="muted">Min ${board.leaders.min_ab || 8} AB · ranked by OPS on the popup</p>
        ${table(["Player", "Team", "AB", "H", "RBI", "AVG", "OPS"], hit)}</div>
      <div class="card"><h2>Pitching leaders</h2><p class="muted">Min ${board.leaders.min_ip || 5} IP · ERA as published</p>
        ${table(["Player", "Team", "IP", "K", "ERA"], pit)}</div>
    </section>
    ${full.length ? `<section class="card"><h2>Full published hitting board</h2>
      <p class="muted">Every line the popup posted. Qualifiers first.</p>
      ${table(["Player", "Team", "AB", "H", "RBI", "AVG", "OPS", ""], full.map((r) => `<tr>
        <td>${escapeHtml(r.player)}</td><td>${escapeHtml(r.team)}</td>
        <td>${r.ab}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.avg}</td><td>${r.ops}</td>
        <td>${r.q ? `<span class="badge w">qual</span>` : `<span class="badge t">below</span>`}</td>
      </tr>`))}</section>` : ""}
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
      <p>Public boards only. Same club across weekends rolls into the year board.</p>
      <p><a class="btn" data-link href="/start">Create a tournament</a> <a class="btn ghost" data-link href="/year/2026">2026 leaderboard</a></p>
    </section>
    <section class="grid cards">${events.map((ev) => `
      <a class="card team-card" data-link href="/t/${ev.slug}">
        <h3>${escapeHtml(ev.name)}</h3>
        <p class="muted">${escapeHtml(ev.ages || "")} · ${escapeHtml(ev.venue || "")} · ${sourceLabel(ev)}</p>
      </a>`).join("") || `<div class="card empty">No public events. <a data-link href="/start">Start one</a>.</div>`}
    </section>`);
}

function directorGate() {
  const u = eventPb.authStore.record;
  if (u && u.role !== "bot") return true;
  eventRoot().innerHTML = eventChrome(null, "", `
    <section class="card">
      <h2>Log in to create a tournament</h2>
      <p>Create an account first. Then you can open a weekend or join one that is already live.</p>
      <p><a class="btn" data-link href="/login">Log in</a> <a class="btn ghost" data-link href="/register">Create an account</a></p>
    </section>`);
  return false;
}

export async function startTournament() {
  eventRoot().innerHTML = eventChrome(null, "", `
    <section class="hero">
      <h1>Start a tournament</h1>
      <p>This host is the board of record. Link a Tourney Machine page you already published, or run the event natively here. Teams then sign up with a GameChanger URL — that is where stats come from.</p>
    </section>
    <section class="grid two">
      <a class="card team-card" data-link href="/directors/new">
        <h3>Run it here</h3>
        <p class="muted">Native</p>
        <p>Name, venue, age group. Pools, bracket, and signup live on this site.</p>
      </a>
      <a class="card team-card" data-link href="/directors/link-tm">
        <h3>Link Tourney Machine</h3>
        <p class="muted">Public TM URL</p>
        <p>Paste the public tournament page. We store the link and refresh it from this host.</p>
      </a>
      <a class="card team-card" data-link href="/directors/import-popup">
        <h3>Import Keystone Clash</h3>
        <p class="muted">thedr21.github.io/KeystoneClash</p>
        <p>Pull the public popup JSON — teams, GameChanger links, pool records, and the Sunday bracket.</p>
      </a>
    </section>
  `);
}

export async function directorImportPopup() {
  if (!directorGate()) return;
  eventRoot().innerHTML = eventChrome(null, "", `
    <section class="hero">
      <h1>Import the Keystone Clash popup</h1>
      <p>Public GitHub Pages JSON only. Teams, GameChanger URLs, published pool records, and Sunday scores. Individual Friday/Saturday pool boxes are not on that site, so they are not invented here.</p>
    </section>
    <section class="card">
      <form class="form wide" id="popup-form">
        <label>Popup URL
          <input name="url" type="url" value="https://thedr21.github.io/KeystoneClash/" required>
        </label>
        <button class="btn" type="submit">Import / refresh</button>
        <p class="error" id="popup-err" hidden></p>
      </form>
    </section>`);
  document.getElementById("popup-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    const res = await fetch("/api/events/import-popup", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      document.getElementById("popup-err").hidden = false;
      document.getElementById("popup-err").textContent = await res.text();
      return;
    }
    goEvent("/t/keystone-clash-2026");
  });
}

export async function eventStats(slug) {
  const board = await fetchBoard(slug);
  const hitting = board.leaders.full_hitting || [];
  const pitching = board.leaders.full_pitching || [];
  const teams = [...new Set([...hitting, ...pitching].map((r) => r.team).filter(Boolean))].sort();
  eventRoot().innerHTML = eventChrome(board.event, "stats", `
    <section class="hero">
      <h1>Full stats board</h1>
      <p class="muted">${escapeHtml(board.leaders.stats_note || "Published scorebook lines. Filter by team. Qualifying line is 8 AB / 5 IP.")}</p>
      <p><a class="btn ghost" href="/popup/stats.html">Open the original stats page</a></p>
    </section>
    <section class="card">
      <div class="tabs" role="tablist">
        <button class="tab active" type="button" data-stats-tab="hit">Hitting</button>
        <button class="tab" type="button" data-stats-tab="pit">Pitching</button>
      </div>
      <div class="chips" id="stats-chips">
        <button class="chip on" type="button" data-team="">All teams</button>
        ${teams.map((t) => `<button class="chip" type="button" data-team="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>
      <label class="check stats-opt"><input type="checkbox" id="stats-qual" checked> Qualifiers only</label>
      <div id="stats-table"></div>
    </section>
  `);
  const state = { tab: "hit", team: "", qual: true };
  const paint = () => {
    const rows = (state.tab === "hit" ? hitting : pitching).filter((r) => {
      if (state.team && r.team !== state.team) return false;
      if (state.qual && r.q === false) return false;
      return true;
    });
    const box = document.getElementById("stats-table");
    if (state.tab === "hit") {
      box.innerHTML = table(["#", "Player", "Team", "AB", "H", "RBI", "AVG", "OPS", ""], rows.map((r, i) => `<tr class="${r.q === false ? "muted-row" : ""}">
        <td>${i + 1}</td><td>${escapeHtml(r.player)}</td><td>${escapeHtml(r.team)}</td>
        <td>${r.ab}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.avg}</td><td>${r.ops}</td>
        <td>${r.q ? `<span class="badge w">qual</span>` : `<span class="badge t">below</span>`}</td>
      </tr>`));
    } else {
      box.innerHTML = table(["#", "Player", "Team", "IP", "K", "ERA", ""], rows.map((r, i) => `<tr class="${r.q === false ? "muted-row" : ""}">
        <td>${i + 1}</td><td>${escapeHtml(r.player)}</td><td>${escapeHtml(r.team)}</td>
        <td>${r.ip}</td><td>${r.k}</td><td>${r.era}</td>
        <td>${r.q ? `<span class="badge w">qual</span>` : `<span class="badge t">below</span>`}</td>
      </tr>`));
    }
  };
  eventRoot().querySelectorAll("[data-stats-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.tab = btn.dataset.statsTab;
      eventRoot().querySelectorAll("[data-stats-tab]").forEach((b) => b.classList.toggle("active", b === btn));
      paint();
    });
  });
  eventRoot().querySelectorAll("#stats-chips [data-team]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.team = btn.dataset.team;
      eventRoot().querySelectorAll("#stats-chips [data-team]").forEach((b) => b.classList.toggle("on", b === btn));
      paint();
    });
  });
  document.getElementById("stats-qual").addEventListener("change", (ev) => {
    state.qual = ev.target.checked;
    paint();
  });
  paint();
}

export async function eventInfo(slug) {
  const board = await fetchBoard(slug);
  const packet = board.packet || board.event.packet;
  const info = packet?.info || {};
  const raffle = packet?.raffle;
  const local = board.event.slug === "keystone-clash-2026";
  const rulesHref = local ? "/popup/full-rules.html" : info.full_rules;
  const packetHref = local ? "/popup/coaches-packet.pdf" : info.coaches_packet;
  const mapHref = local ? "/popup/parking-map.png" : info.parking_map;
  eventRoot().innerHTML = eventChrome(board.event, "info", `
    <section class="hero">
      <h1>Tournament info</h1>
      <p>${escapeHtml(packet?.status || board.event.status_note || "")}</p>
      ${local ? `<p>
        <a class="btn ghost" href="/popup/index.html">Popup home</a>
        <a class="btn ghost" href="/popup/rain-update.html">Rain / Sunday venue</a>
        <a class="btn ghost" href="/popup/raffle.html">50/50 raffle</a>
        <a class="btn ghost" href="/popup/draw.html">Draw verification</a>
      </p>` : ""}
    </section>
    ${local ? `<section class="card infomap">
      <h2>Parking</h2>
      <img src="/popup/parking-map.png" alt="Aerial map of East End Park showing the main lot off Meadow St and the Field 2 lot.">
      <p class="muted">Both lots are marked in orange. Enter off Meadow St. Overflow parking is on East O’Hara St.</p>
    </section>` : ""}
    <section class="card facts">
      ${[
        ["Dates", packet?.dates || "September 11–13, 2026"],
        ["Where", info.where || board.event.venue],
        ["Parking", info.parking],
        ["Rules", info.rules],
        ["Format", info.format],
        ["On site", info.on_site],
        ["Questions", info.questions || board.event.contact],
      ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}
      <p>
        ${rulesHref ? `<a href="${escapeHtml(rulesHref)}">Full rules</a>` : ""}
        ${packetHref ? ` · <a href="${escapeHtml(packetHref)}">Coaches packet (PDF)</a>` : ""}
        ${mapHref ? ` · <a href="${escapeHtml(mapHref)}">Parking map</a>` : ""}
      </p>
    </section>
    ${raffle ? `<section class="card raffle-card">
      <h2>50/50 raffle</h2>
      <p>Winner takes half. The other half goes back to Lady Dukes Softball Club.</p>
      <p class="pot">${Number(raffle.raised) > 0 ? `$${Number(raffle.raised).toFixed(0)} in the pot` : "Tickets on sale"}</p>
      <p>${local ? `<a class="btn ghost" href="/popup/raffle.html">Raffle page</a> ` : ""}${info.raffle_buy ? `<a class="btn" href="${escapeHtml(info.raffle_buy)}" target="_blank" rel="noopener">Buy raffle tickets</a>` : ""}</p>
    </section>` : ""}
  `);
}

export async function directorNative() {
  if (!directorGate()) return;
  eventRoot().innerHTML = eventChrome(null, "", `
    <section class="hero">
      <h1>Run it on this site</h1>
      <p>Native tournament. After you open it, directors or teams sign up — each team must link GameChanger.</p>
    </section>
    <section class="card">
      <form class="form wide" id="native-form">
        <label>Tournament name <input name="name" required placeholder="Labor Day Classic"></label>
        <label>Venue <input name="venue" placeholder="Central Park Complex"></label>
        <label>Age group <input name="ages" value="10U"></label>
        <label>Slug (optional) <input name="slug" placeholder="labor-day-classic"></label>
        <button class="btn" type="submit">Open signup</button>
        <p class="error" id="native-err" hidden></p>
      </form>
    </section>`);
  document.getElementById("native-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    const res = await fetch("/api/events/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ ...data, source: "native" }),
    });
    if (!res.ok) {
      document.getElementById("native-err").hidden = false;
      document.getElementById("native-err").textContent = await res.text();
      return;
    }
    const out = await res.json();
    goEvent("/t/" + out.event.slug + "/admin");
  });
}

export async function directorLinkTm() {
  if (!directorGate()) return;
  eventRoot().innerHTML = eventChrome(null, "", `
    <section class="hero">
      <h1>Link a Tourney Machine site</h1>
      <p>Public tournament URL only. We do not log into Tourney Machine. This host stores the link and refreshes the public page.</p>
    </section>
    <section class="card">
      <form class="form wide" id="tm-form">
        <label>Tourney Machine URL
          <input name="tm_url" type="url" required placeholder="https://www.tourneymachine.com/Public/Results/Tournament.aspx?IDTournament=…">
        </label>
        <label>Name override (optional) <input name="name" placeholder="Leave blank to use the public page title"></label>
        <label>Venue <input name="venue"></label>
        <label>Age group <input name="ages" value="10U"></label>
        <button class="btn" type="submit">Link and open signup</button>
        <p class="error" id="tm-err" hidden></p>
      </form>
    </section>`);
  document.getElementById("tm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    const res = await fetch("/api/events/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ ...data, source: "tourneymachine" }),
    });
    if (!res.ok) {
      document.getElementById("tm-err").hidden = false;
      document.getElementById("tm-err").textContent = await res.text();
      return;
    }
    const out = await res.json();
    goEvent("/t/" + out.event.slug + "/admin");
  });
}

export async function eventSignup(slug) {
  const roster = await fetch("/api/events/" + encodeURIComponent(slug) + "/roster").then((r) => {
    if (!r.ok) throw new Error("Event not found");
    return r.json();
  });
  const ev = roster.event;
  const director = isDirector();
  eventRoot().innerHTML = eventChrome(ev, "sign up", `
    <section class="hero">
      <h1>Sign up · ${escapeHtml(ev.name)}</h1>
      <p>${ev.signup_open ? "Director or team can add a roster. GameChanger is optional — the team profile exists either way. If they have a public GC page, link it so this host can pull that page later." : "Signup is closed."}</p>
    </section>
    ${ev.signup_open ? `<section class="card">
      <form class="form wide" id="signup-form">
        <label>Team name <input name="team_name" required placeholder="Hawks 10U"></label>
        <label>Pool (optional) <input name="pool" placeholder="A"></label>
        <label>GameChanger team URL (optional)
          <input name="gamechanger_url" type="url" placeholder="https://web.gc.com/team/…">
        </label>
        <label>Contact name <input name="contact_name" ${director ? "" : "required"}></label>
        <label>Contact email <input name="contact_email" type="email"></label>
        ${director ? `<label class="check"><input type="checkbox" name="as_director" checked> I am the director adding this team</label>` : ""}
        <button class="btn" type="submit">Join the tournament</button>
        <p class="error" id="signup-err" hidden></p>
      </form>
    </section>` : `<section class="card empty">The director closed signup.</section>`}
    ${rosterBlock(roster.teams)}
  `);
  const form = document.getElementById("signup-form");
  if (!form) return;
  form.addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const raw = Object.fromEntries(new FormData(evnt.target));
    const body = {
      team_name: raw.team_name,
      pool: raw.pool,
      gamechanger_url: raw.gamechanger_url,
      contact_name: raw.contact_name,
      contact_email: raw.contact_email,
      as_director: !!raw.as_director,
    };
    const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      document.getElementById("signup-err").hidden = false;
      document.getElementById("signup-err").textContent = await res.text();
      return;
    }
    goEvent("/t/" + slug);
  });
}

export async function eventAdmin(slug) {
  if (!directorGate()) return;
  const roster = await fetch("/api/events/" + encodeURIComponent(slug) + "/roster", {
    headers: authHeader(),
  }).then((r) => {
    if (!r.ok) throw new Error("Event not found");
    return r.json();
  });
  const ev = roster.event;
  eventRoot().innerHTML = eventChrome(ev, "admin", `
    <section class="hero">
      <h1>Director · ${escapeHtml(ev.name)}</h1>
      <p class="muted">${ev.source === "tourneymachine" ? "Linked Tourney Machine" : "Native host"} · signup ${ev.signup_open ? "open" : "closed"} · auto-sync ${ev.auto_sync ? "on" : "off"}</p>
      <p>Refresh pulls the public Tourney Machine page and each team's public GameChanger page. Boxes still sit in review until a coach confirms numbers.</p>
      <p>
        <button class="btn" id="sync-now">Refresh GameChanger + TM</button>
        <button class="btn ghost" id="toggle-signup">${ev.signup_open ? "Close signup" : "Reopen signup"}</button>
        <a class="btn ghost" data-link href="/t/${ev.slug}/signup">Add a team</a>
        <a class="btn ghost" data-link href="/directors/import">Import a grid</a>
        ${ev.source === "popup" ? `<button class="btn ghost" id="refresh-popup">Refresh from popup</button>` : ""}
      </p>
      <p class="error" id="admin-err" hidden></p>
      <p class="muted" id="admin-note"></p>
    </section>
    ${rosterBlock(roster.teams)}
  `);
  document.getElementById("sync-now").addEventListener("click", async (btnEv) => {
    const btn = btnEv.currentTarget;
    btn.disabled = true;
    const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: "{}",
    });
    btn.disabled = false;
    const note = document.getElementById("admin-note");
    const err = document.getElementById("admin-err");
    if (!res.ok) {
      err.hidden = false;
      err.textContent = await res.text();
      return;
    }
    const out = await res.json();
    note.textContent = "Refresh finished · " + (out.results || []).map((r) => (r.team || r.kind) + " " + (r.ok ? "ok" : "miss")).join(", ");
    eventAdmin(slug);
  });
  document.getElementById("toggle-signup").addEventListener("click", async () => {
    const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ signup_open: !ev.signup_open }),
    });
    if (!res.ok) {
      document.getElementById("admin-err").hidden = false;
      document.getElementById("admin-err").textContent = await res.text();
      return;
    }
    eventAdmin(slug);
  });
  const refresh = document.getElementById("refresh-popup");
  if (refresh) {
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      const res = await fetch("/api/events/import-popup", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ url: ev.source_url || "https://thedr21.github.io/KeystoneClash/" }),
      });
      refresh.disabled = false;
      if (!res.ok) {
        document.getElementById("admin-err").hidden = false;
        document.getElementById("admin-err").textContent = await res.text();
        return;
      }
      const out = await res.json();
      document.getElementById("admin-note").textContent = "Popup refresh · " + out.teams + " teams · " + out.games + " Sunday games";
    });
  }
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
