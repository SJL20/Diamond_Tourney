import { pageShell } from "./chrome.js";

const flowRoot = () => document.getElementById("app");
const flowPb = new PocketBase(location.origin);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function goFlow(href) {
  history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function who() {
  return flowPb.authStore.record;
}

function tabFromPath() {
  const q = new URLSearchParams(location.search);
  return q.get("tab") || (location.pathname === "/register" ? "register" : location.pathname === "/find" ? "find" : "login");
}

function gateChrome(page, body) {
  return pageShell({ pb: flowPb, site: page, page, body });
}

function localHints() {
  if (!["localhost", "127.0.0.1"].includes(location.hostname)) return "";
  return `<div class="accounts">
    <p><b>Local sample logins</b></p>
    <p>Director · td@local.test / EventTd1!</p>
    <p>Hawks coach · coach.hawks@local.test / CoachHawks1!</p>
    <p>Region · owner@local.test / RegionAdmin1!</p>
  </div>`;
}

function bindLogin(form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(ev.target);
    const err = document.getElementById("gate-error");
    try {
      await flowPb.collection("users").authWithPassword(data.get("email"), data.get("password"));
      goFlow("/account");
    } catch (e) {
      err.hidden = false;
      err.textContent = "Login failed. Check the email and password.";
    }
  });
}

function bindRegister(form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    const err = document.getElementById("gate-error");
    const res = await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      err.hidden = false;
      err.textContent = await res.text();
      return;
    }
    try {
      await flowPb.collection("users").authWithPassword(data.email, data.password);
      goFlow("/account");
    } catch (e) {
      err.hidden = false;
      err.textContent = "Account created. Log in with that email.";
    }
  });
}

function renderFindResults(events) {
  const box = document.getElementById("find-results");
  if (!box) return;
  if (!events.length) {
    box.innerHTML = `<div class="card empty">No public tournaments match. Create one after you log in.</div>`;
    return;
  }
  const featured = events.find((ev) => ev.slug === "keystone-clash-2026");
  const rest = events.filter((ev) => ev.slug !== "keystone-clash-2026");
  const row = (ev) => `
    <li>
      <div>
        <b>${escapeHtml(ev.name)}</b>
        <span class="muted">${escapeHtml([ev.ages, ev.venue, ev.source === "popup" ? "Keystone Clash popup" : ev.source === "tourneymachine" ? "Tourney Machine" : "Hosted"].filter(Boolean).join(" · "))}</span>
      </div>
      <div class="list-actions">
        <a class="btn" data-link href="/t/${ev.slug}">Open board</a>
        ${ev.signup_open ? `<a class="btn ghost" data-link href="/t/${ev.slug}/signup">Sign up</a>` : `<span class="muted">Signup closed</span>`}
      </div>
    </li>`;
  box.innerHTML = `
    ${featured ? `<section class="page-head"><h2>Featured weekend</h2></section><ul class="list">${row(featured)}</ul>` : ""}
    ${(featured ? rest : events).length ? `<ul class="list">${(featured ? rest : events).map(row).join("")}</ul>` : ""}`;
}

async function runFind(q) {
  const res = await fetch("/api/events/search?q=" + encodeURIComponent(q || ""));
  if (!res.ok) throw new Error("Search failed");
  const out = await res.json();
  renderFindResults(out.events || []);
}

function bindFind(form) {
  const run = () => runFind(new FormData(form).get("q") || "");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = document.getElementById("gate-error");
    try { await run(); } catch (e) {
      if (err) { err.hidden = false; err.textContent = "Could not search tournaments."; }
    }
  });
  run().catch(() => {});
}

export async function startGate(forcedTab) {
  const u = who();
  if (u && !forcedTab) {
    return accountHome();
  }
  const tab = forcedTab || tabFromPath();
  flowRoot().innerHTML = gateChrome(tab, `
    <section class="page-head">
      <h1>Log in, create an account, or find a tournament.</h1>
      <p class="muted">Directors open a weekend here. Teams join with a GameChanger link. One account keeps both.</p>
    </section>
    <nav class="tabs" role="tablist">
      <a class="tab ${tab === "login" ? "active" : ""}" data-link href="/login">Log in</a>
      <a class="tab ${tab === "register" ? "active" : ""}" data-link href="/register">Create account</a>
      <a class="tab ${tab === "find" ? "active" : ""}" data-link href="/find">Find a tournament</a>
    </nav>
    ${tab === "login" ? `
      <section class="card">
        <h2>Log in</h2>
        <p class="muted">Opens your tournaments and any season book on this account.</p>
        <form class="form wide" id="login-form">
          <label>Email <input name="email" type="email" autocomplete="username" required></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn" type="submit">Enter account</button>
        </form>
        ${localHints()}
      </section>` : ""}
    ${tab === "register" ? `
      <section class="card">
        <h2>Create an account</h2>
        <p class="muted">Directors create weekends. Teams join them. You can do both from the same login.</p>
        <form class="form wide" id="register-form">
          <label>Your name <input name="display_name" required placeholder="Pat Rivera"></label>
          <label>Email <input name="email" type="email" autocomplete="email" required></label>
          <label>Password (8+ characters) <input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
          <label>I am here to
            <select name="intent">
              <option value="director">Run tournaments</option>
              <option value="team">Sign a team up</option>
            </select>
          </label>
          <button class="btn" type="submit">Create account</button>
        </form>
      </section>` : ""}
    ${tab === "find" ? `
      <section class="card">
        <h2>Find a tournament</h2>
        <p class="muted">Search public boards. Join with a GameChanger URL, or open the live standings.</p>
        <form class="form wide" id="find-form">
          <label>Name, venue, or age <input name="q" placeholder="Keystone, Harbor Eight, 10U"></label>
          <button class="btn" type="submit">Search</button>
        </form>
      </section>
      <div id="find-results"></div>` : ""}
    <p class="error" id="gate-error" hidden></p>
  `);
  if (document.getElementById("login-form")) bindLogin(document.getElementById("login-form"));
  if (document.getElementById("register-form")) bindRegister(document.getElementById("register-form"));
  if (document.getElementById("find-form")) bindFind(document.getElementById("find-form"));
}

function eventCards(events, empty, mode) {
  if (!events.length) return `<section class="empty">${empty}</section>`;
  return `<ul class="list">${events.map((ev) => `
    <li>
      <div>
        <b>${escapeHtml(ev.name)}</b>
        <span class="muted">${escapeHtml([ev.ages, ev.venue, ev.team_name].filter(Boolean).join(" · "))}</span>
      </div>
      <div class="list-actions">
        <a class="btn" data-link href="/t/${ev.slug}">${mode === "created" ? "Open board" : "Open board"}</a>
        ${mode === "created"
          ? `<a class="btn ghost" data-link href="/t/${ev.slug}/admin">Admin</a>`
          : ev.signup_open ? `<a class="btn ghost" data-link href="/t/${ev.slug}/signup">Sign up</a>` : ""}
      </div>
    </li>`).join("")}</ul>`;
}

export async function accountHome() {
  const u = who();
  if (!u) {
    goFlow("/login");
    return;
  }
  const res = await fetch("/api/account/home", {
    headers: { Authorization: flowPb.authStore.token },
  });
  if (!res.ok) {
    flowRoot().innerHTML = gateChrome("account", `<section class="card empty">Could not load this account.</section>`);
    return;
  }
  const home = await res.json();
  const name = home.user.display_name || home.user.email;
  let book = "";
  if (u.role === "team_coach" && u.team) {
    try {
      const team = await flowPb.collection("teams").getOne(u.team);
      book = `<section class="card">
        <h2>Season book</h2>
        <p>${escapeHtml(team.name)} stays behind this login. Approve staged boxes before they publish.</p>
        <p><a class="btn" data-link href="/teams/${team.slug}/home">Open team book</a></p>
      </section>`;
    } catch (err) {}
  }
  flowRoot().innerHTML = gateChrome("account", `
    <section class="page-head">
      <h1>${escapeHtml(name)}</h1>
      <p class="muted">${escapeHtml(home.user.email)} · ${home.user.role === "team_coach" ? "Team account" : "Director account"}</p>
      <div class="actions">
        <a class="btn" data-link href="/start">Create a tournament</a>
        <a class="btn ghost" data-link href="/find">Find a tournament</a>
        <a class="btn ghost" data-link href="/year/2026">Year board</a>
      </div>
    </section>
    ${book}
    <section>
      <h2>Tournaments you run</h2>
      ${eventCards(home.created, "You have not opened a tournament yet.", "created")}
    </section>
    <section>
      <h2>Tournaments you joined</h2>
      ${eventCards(home.joined, "No team signups on this email yet.", "joined")}
    </section>
  `);
}

export async function findPage() {
  return startGate("find");
}

export async function adminTeams() {
  const u = who();
  if (!u || u.role !== "region_admin") {
    flowRoot().innerHTML = gateChrome("admin", `<section class="card"><p>Site admin only.</p><p><a class="btn" data-link href="/login">Log in</a></p></section>`);
    return;
  }
  const res = await fetch("/api/admin/clubs", { headers: { Authorization: flowPb.authStore.token } });
  if (!res.ok) {
    flowRoot().innerHTML = gateChrome("admin", `<section class="card empty">Could not load team profiles.</section>`);
    return;
  }
  const data = await res.json();
  flowRoot().innerHTML = gateChrome("admin", `
    <section class="page-head">
      <h1>Team profiles</h1>
      <p class="muted">Admin is by team, not by email. A login can attach later. GameChanger is optional — leave it blank if they score on paper.</p>
    </section>
    <section class="card">
      <h2>Add a team</h2>
      <form class="form wide" id="club-new">
        <label>Team name <input name="name" required placeholder="Hawks 10U"></label>
        <label>Age group <input name="ages" placeholder="10U"></label>
        <label>GameChanger URL (optional) <input name="gamechanger_url" type="url" placeholder="https://web.gc.com/team/…"></label>
        <label>Contact email <input name="contact_email" type="email"></label>
        <label>Notes <input name="notes" placeholder="No GC this season; scorebook at the field"></label>
        <button class="btn" type="submit">Save team</button>
        <p class="error" id="club-err" hidden></p>
      </form>
    </section>
    <section class="grid">${(data.clubs || []).map((c) => `
      <form class="card form wide" data-club="${c.id}">
        <h3>${escapeHtml(c.name)}</h3>
        <p class="muted">${c.gc_linked ? "GameChanger linked" : "No GameChanger — stats from this host only"} · ${escapeHtml(c.slug)}</p>
        <label>Name <input name="name" value="${escapeHtml(c.name)}" required></label>
        <label>Age <input name="ages" value="${escapeHtml(c.ages)}"></label>
        <label>GameChanger URL <input name="gamechanger_url" type="url" value="${escapeHtml(c.gamechanger_url)}"></label>
        <label>Contact email <input name="contact_email" type="email" value="${escapeHtml(c.contact_email)}"></label>
        <label>Notes <input name="notes" value="${escapeHtml(c.notes)}"></label>
        <button class="btn ghost" type="submit">Update</button>
      </form>`).join("") || `<div class="card empty">No team profiles yet.</div>`}
    </section>
  `);
  const send = async (id, form) => {
    const body = Object.fromEntries(new FormData(form));
    const res2 = await fetch(id ? "/api/admin/clubs/" + id : "/api/admin/clubs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: flowPb.authStore.token },
      body: JSON.stringify(body),
    });
    if (!res2.ok) {
      const err = document.getElementById("club-err");
      if (err) { err.hidden = false; err.textContent = await res2.text(); }
      return;
    }
    adminTeams();
  };
  document.getElementById("club-new").addEventListener("submit", (ev) => {
    ev.preventDefault();
    send("", ev.target);
  });
  flowRoot().querySelectorAll("[data-club]").forEach((form) => {
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      send(form.dataset.club, form);
    });
  });
}

export async function yearPage(year) {
  year = year || "2026";
  const res = await fetch("/api/year/" + encodeURIComponent(year) + "/board");
  if (!res.ok) {
    flowRoot().innerHTML = gateChrome("year", `<section class="card empty">Could not load the ${escapeHtml(year)} board.</section>`);
    return;
  }
  const board = await res.json();
  const teams = (board.teams || []).map((t) => `<tr>
    <td>${t.rank}</td><td>${escapeHtml(t.name)}</td>
    <td>${t.w}</td><td>${t.l}</td><td>${t.rs}</td><td>${t.ra}</td><td>${t.diff}</td>
    <td>${t.events}</td>
    <td>${t.gc_linked ? `<span class="badge linked">GC</span>` : ""}</td>
  </tr>`);
  const hit = (board.hitting || []).map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ab}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.avg_display}</td>
  </tr>`);
  const pit = (board.pitching || []).map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ip}</td><td>${r.er}</td><td>${r.so}</td><td>${r.era_display}</td>
  </tr>`);
  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("") || `<tr><td colspan="${headers.length}" class="empty">No qualifying lines yet.</td></tr>`}</tbody></table></div>`;
  }
  flowRoot().innerHTML = gateChrome("year", `
    <section class="page-head">
      <h1>${escapeHtml(year)} series board</h1>
      <p class="muted">Same club across weekends stays one row. Totals come from final event scores and approved boxes — nothing invented.</p>
      <p>${(board.events || []).map((ev) => `<a data-link href="/t/${ev.slug}">${escapeHtml(ev.name)}</a>`).join(" · ") || "No public events in this year yet."}</p>
    </section>
    <section class="card">
      <h2>Team standings</h2>
      <p class="muted">Wins, then losses, then runs allowed, then runs scored. Events column is how many weekends that club appeared.</p>
      ${table(["#", "Club", "W", "L", "RS", "RA", "Diff", "Events", ""], teams)}
    </section>
    <section class="grid two">
      <div class="card"><h2>Hitting</h2><p class="muted">Min 8 AB across the year</p>
        ${table(["Player", "Team", "AB", "H", "RBI", "AVG"], hit)}</div>
      <div class="card"><h2>Pitching</h2><p class="muted">Min 3.0 IP · youth ERA base 7</p>
        ${table(["Player", "Team", "IP", "ER", "SO", "ERA"], pit)}</div>
    </section>
  `);
}
