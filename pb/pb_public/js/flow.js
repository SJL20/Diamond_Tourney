import { flashSaved, isSiteAdmin, loginWithPassword, pageShell } from "./chrome.js";
import { apiSend, authHeader, markSiteAdminRecord, pb as flowPb } from "./client.js";
import { stampDataTh } from "./display.js";

const flowRoot = () => document.getElementById("app");

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
    <p>PocketBase admin · admin@local.test / SoftballAdmin1!</p>
  </div>`;
}

function takeAfterLogin() {
  let next = "";
  try {
    next = sessionStorage.getItem("dt-after-login") || "";
    sessionStorage.removeItem("dt-after-login");
  } catch (err) {
    return "";
  }
  if (!next.startsWith("/t/")) return "";
  if (next.indexOf("..") !== -1 || /[^A-Za-z0-9/_-]/.test(next)) return "";
  return next;
}

function bindLogin(form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(ev.target);
    const err = document.getElementById("gate-error");
    try {
      await loginWithPassword(flowPb, data.get("email"), data.get("password"));
      const next = takeAfterLogin();
      if (next) location.assign(next);
      else goFlow("/account");
    } catch (e) {
      err.hidden = false;
      err.textContent = "Login failed. Check the email and password.";
    }
  });
}

function mailFailureText(reason) {
  const raw = String(reason || "");
  if (!raw || raw === "smtp_not_configured" || raw.indexOf("smtp_not_configured") !== -1) {
    return "Account created. Confirmation email is not set up on this server yet. Use Resend confirmation on this page once mail is configured.";
  }
  if (/not verified/i.test(raw)) {
    return "Account created. The mail provider refused the confirmation email because the sending domain is not verified. Use Resend confirmation on this page after that is fixed.";
  }
  return "Account created, but the confirmation email did not send. Use Resend confirmation on this page.";
}

function bindRegister(form) {
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(ev.target));
    const err = document.getElementById("gate-error");
    err.className = "error";
    if (data.password !== data.passwordConfirm) {
      err.hidden = false;
      err.textContent = "Type the same password in both password fields.";
      return;
    }
    const res = await fetch("/api/account/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const raw = await res.text();
      let message = raw;
      try { message = JSON.parse(raw).message || raw; } catch (e) {}
      err.hidden = false;
      err.textContent = message;
      return;
    }
    const out = await res.json();
    try {
      sessionStorage.setItem("dt-just-registered", JSON.stringify({
        verify_sent: !!out.verify_sent,
        verify_reason: out.verify_reason || "",
      }));
    } catch (e) {}
    try {
      await loginWithPassword(flowPb, data.email, data.password);
    } catch (e) {
      err.hidden = false;
      err.className = "muted";
      err.textContent = out.verify_sent
        ? "Account created. Check your email for the confirmation link, then log in. Your account page is where you update your password."
        : mailFailureText(out.verify_reason) + " Log in to open the account page.";
      return;
    }
    location.assign(takeAfterLogin() || "/account");
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
          <label>Email <input name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
          <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn" type="submit">Enter account</button>
        </form>
        <p><a data-link href="/forgot">Forgot my password</a></p>
        ${localHints()}
      </section>` : ""}
    ${tab === "register" ? `
      <section class="card">
        <h2>Create an account</h2>
        <p class="muted">Directors create weekends. A team account creates its team on the account page before it can join a weekend with one click. Creating the account emails a confirmation link and opens your account page, where you can update your password.</p>
        <form class="form wide" id="register-form">
          <label>Your name <input name="display_name" required placeholder="Pat Rivera"></label>
          <label>Email <input name="email" type="email" autocomplete="email" required></label>
          <label>Password (8+ characters) <input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
          <label>Confirm password <input name="passwordConfirm" type="password" autocomplete="new-password" required minlength="8"></label>
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

function viaLine(row) {
  if (row.via === "team") {
    return row.team ? `Because you follow ${row.team}` : "A team you follow is in this tournament";
  }
  if (row.via === "both") {
    return row.team ? `You follow this tournament and ${row.team}` : "You follow this tournament";
  }
  return "You follow this tournament";
}

function followingBlocks(following) {
  const tournaments = following.tournaments || [];
  const teams = following.teams || [];
  const tournamentList = tournaments.length ? `<ul class="list">${tournaments.map((row) => `
    <li>
      <div>
        <b>${escapeHtml(row.name)}</b>
        <span class="muted">${escapeHtml(viaLine(row))}</span>
      </div>
      <div class="list-actions">
        <a class="btn" data-link href="/t/${escapeHtml(row.slug)}">Open board</a>
        ${row.via === "event" || row.via === "both"
          ? `<button class="btn ghost" type="button" data-unfollow-event="${escapeHtml(row.slug)}">Unfollow</button>`
          : ""}
      </div>
    </li>`).join("")}</ul>` : `<section class="empty">You are not following a tournament yet. Open a board and choose Follow this tournament, or follow a team that is in one.</section>`;
  const teamList = teams.length ? `<ul class="list">${teams.map((row) => `
    <li>
      <div>
        <b>${escapeHtml(row.name)}</b>
        <span class="muted">On this team's fan list. Your email stays off the public page.</span>
      </div>
      <div class="list-actions">
        <button class="btn ghost" type="button" data-unfollow-team="${escapeHtml(row.id)}">Leave fan list</button>
      </div>
    </li>`).join("")}</ul>` : `<section class="empty">You are not on a team fan list yet.</section>`;
  return `
    <section id="following-tournaments">
      <h2>Tournaments you follow</h2>
      ${tournamentList}
    </section>
    <section id="following-teams">
      <h2>Teams you follow</h2>
      <p class="muted">Following a team adds you to its fan list. This page does not email that list, and your address is not shown on the public team page.</p>
      ${teamList}
    </section>`;
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
  const res = await apiSend("/api/account/home");
  if (!res.ok || !res.data || !res.data.user) {
    flowRoot().innerHTML = gateChrome("account", `<section class="card empty">
      <p>Could not load this account.</p>
      <p class="muted">${escapeHtml(res.message || "The account page did not come back. Try again on this same login.")}</p>
      <p><button class="btn" type="button" id="account-retry">Try again</button></p>
    </section>`);
    const retry = document.getElementById("account-retry");
    if (retry) retry.addEventListener("click", () => accountHome());
    return;
  }
  const home = res.data;
  const name = home.user.display_name || home.user.email;
  const admin = !!home.user.site_admin;
  if (admin) markSiteAdminRecord();
  const verified = home.user.verified !== false;
  let just = null;
  try {
    just = JSON.parse(sessionStorage.getItem("dt-just-registered") || "null");
    sessionStorage.removeItem("dt-just-registered");
  } catch (err) { just = null; }
  const justCard = !just ? "" : `<section class="card">
        <h2>Account created</h2>
        <p>${escapeHtml(just.verify_sent
          ? "A confirmation link is on the way to this email. Open that message to confirm the address. You are already signed in, and you can update your password below."
          : mailFailureText(just.verify_reason))}</p>
      </section>`;
  const confirmCard = verified ? "" : `<section class="card">
        <h2>Confirm your email</h2>
        <p>Director tools, scores, team contacts, and packets stay closed until this address is confirmed.</p>
        <button class="btn" id="resend-confirm" type="button">Resend confirmation</button>
        <p class="muted" id="resend-note" hidden></p>
      </section>`;
  let book = "";
  const mine = home.user.team;
  const ageOptions = ["6U", "8U", "10U", "12U", "14U", "16U", "18U"];
  const contact = (mine && mine.contact) || {};
  if (mine) {
    book = `<section class="card">
      <h2>Your team</h2>
      <p>This record is the team. Tournaments you join use it. A weekend does not keep a second copy of the name, contacts, or GameChanger link.</p>
      <form class="form wide" id="edit-team-form">
        <label>Team name <input name="name" required value="${escapeHtml(mine.name || "")}"></label>
        <label>Age group
          <select name="age_group">
            <option value="">—</option>
            ${ageOptions.map((a) => `<option value="${a}" ${mine.age_group === a ? "selected" : ""}>${a}</option>`).join("")}
          </select>
        </label>
        <label>Coach name <input name="coach_name" value="${escapeHtml(mine.coach_name || "")}"></label>
        <label>GameChanger team URL <input name="gamechanger_url" type="url" value="${escapeHtml(mine.gamechanger_url || "")}" placeholder="https://web.gc.com/team/…"></label>
        <label>Coach email <input name="coach_email" type="email" value="${escapeHtml(contact.coach_email || "")}"></label>
        <label>Coach phone <input name="coach_phone" type="text" inputmode="tel" value="${escapeHtml(contact.coach_phone || "")}"></label>
        <fieldset class="setup-block">
          <legend>Second contact</legend>
          <label>Name <input name="alt_name" value="${escapeHtml(contact.alt_name || "")}"></label>
          <label>Email <input name="alt_email" type="email" value="${escapeHtml(contact.alt_email || "")}"></label>
          <label>Phone <input name="alt_phone" type="text" inputmode="tel" value="${escapeHtml(contact.alt_phone || "")}"></label>
        </fieldset>
        <label>Co-owner emails <textarea name="co_owners" rows="2" placeholder="one email per line">${escapeHtml((mine.co_owners || []).join("\n"))}</textarea></label>
        <div class="actions">
          <button class="btn" type="submit">Save team</button>
          <a class="btn ghost" data-link href="/teams/${escapeHtml(mine.slug)}/home">Open team book</a>
        </div>
        <p class="error" id="edit-team-err" hidden></p>
      </form>
    </section>`;
  } else if (home.user.role === "team_coach" && verified) {
    book = `<section class="card" id="create-team">
      <h2>Create your team</h2>
      <p>Do this before joining a tournament. The weekend entry points at this team, so the same club is not typed in again for every event.</p>
      <form class="form wide" id="create-team-form">
        <label>Team name <input name="name" required placeholder="Hawks 10U"></label>
        <label>Age group
          <select name="age_group">
            <option value="">—</option>
            ${ageOptions.map((a) => `<option value="${a}">${a}</option>`).join("")}
          </select>
        </label>
        <label>Coach name <input name="coach_name" value="${escapeHtml(home.user.display_name || "")}"></label>
        <label>GameChanger team URL <input name="gamechanger_url" type="url" placeholder="https://web.gc.com/team/…"></label>
        <label>Coach email <input name="coach_email" type="email" value="${escapeHtml(home.user.email || "")}"></label>
        <label>Coach phone <input name="coach_phone" type="text" inputmode="tel" placeholder="412-555-0100"></label>
        <fieldset class="setup-block">
          <legend>Second contact</legend>
          <label>Name <input name="alt_name"></label>
          <label>Email <input name="alt_email" type="email"></label>
          <label>Phone <input name="alt_phone" type="text" inputmode="tel"></label>
        </fieldset>
        <label>Co-owner emails <textarea name="co_owners" rows="2" placeholder="one email per line"></textarea></label>
        <button class="btn" type="submit">Save team</button>
        <p class="error" id="create-team-err" hidden></p>
      </form>
    </section>`;
  } else if (home.user.role === "team_coach") {
    book = `<section class="card">
      <h2>Create your team</h2>
      <p>After this email is confirmed, create the team on this page. Tournaments sign up that team.</p>
    </section>`;
  } else if (!mine) {
    book = `<section class="card">
      <h2>Teams you add</h2>
      <p>On a tournament's signup page, create the team with its name, contacts, and GameChanger link, add it to the weekend, then pass ownership to the coach's email.</p>
    </section>`;
  }
  flowRoot().innerHTML = gateChrome("account", `
    <section class="page-head">
      <h1>${escapeHtml(name)}</h1>
      <p class="muted">${escapeHtml(home.user.email)} · ${admin ? "Site admin" : home.user.role === "team_coach" ? "Team account" : "Director account"}</p>
      <div class="actions">
        <a class="btn" data-link href="/start">Create a tournament</a>
        <a class="btn ghost" data-link href="/find">Find a tournament</a>
        <a class="btn ghost" data-link href="/year/2026">Year board</a>
        ${admin ? `<a class="btn ghost" data-link href="/admin/events">Remove tournaments</a>` : ""}
      </div>
    </section>
    ${justCard}
    ${book}
    ${confirmCard}
    ${followingBlocks(home.following || { teams: [], tournaments: [] })}
    <section class="card" id="update-password">
      <h2>Update your password</h2>
      <form class="form wide" id="password-form">
        <label>Current password <input name="oldPassword" type="password" autocomplete="current-password" required></label>
        <label>New password (8+ characters) <input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
        <label>Confirm new password <input name="passwordConfirm" type="password" autocomplete="new-password" required minlength="8"></label>
        <button class="btn" type="submit">Save password</button>
        <p class="muted" id="password-note" hidden></p>
      </form>
    </section>
    <section>
      <h2>${admin ? "All tournaments" : "Tournaments you run"}</h2>
      ${eventCards(home.created, "You have not opened a tournament yet.", "created")}
    </section>
    <section>
      <h2>Tournaments you joined</h2>
      ${eventCards(home.joined, "No team signups on this email yet.", "joined")}
    </section>
  `);
  const editTeam = document.getElementById("edit-team-form");
  if (editTeam && mine) {
    editTeam.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = document.getElementById("edit-team-err");
      const body = Object.fromEntries(new FormData(ev.target));
      const res = await fetch("/api/teams/" + encodeURIComponent(mine.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: flowPb.authStore.token },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        err.hidden = false;
        err.textContent = await res.text();
        return;
      }
      flashSaved("Team saved");
      accountHome();
    });
  }
  const createTeam = document.getElementById("create-team-form");
  if (createTeam) {
    createTeam.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = document.getElementById("create-team-err");
      const body = Object.fromEntries(new FormData(ev.target));
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: flowPb.authStore.token },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        err.hidden = false;
        err.textContent = await res.text();
        return;
      }
      try { await flowPb.collection("users").authRefresh(); } catch (e) {}
      flashSaved("Team saved");
      accountHome();
    });
  }
  const resend = document.getElementById("resend-confirm");
  if (resend) {
    resend.addEventListener("click", async () => {
      const note = document.getElementById("resend-note");
      const sent = await fetch("/api/account/resend", {
        method: "POST",
        headers: authHeader(),
      });
      const out = await sent.json().catch(() => ({}));
      note.hidden = false;
      if (!sent.ok) {
        note.textContent = out.message || "Could not resend confirmation.";
        return;
      }
      if (out.verified) note.textContent = "This email is already confirmed.";
      else if (out.mail === "not_configured") note.textContent = "Confirmation email is not set up on this server yet.";
      else if (out.verify_sent) note.textContent = "Check your email for a new confirmation link.";
      else note.textContent = "The confirmation email did not send. Try again in a little while.";
    });
  }
  const dropFollow = async (body) => {
    const sent = await fetch("/api/account/unfollow", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    if (sent.ok) accountHome();
  };
  flowRoot().querySelectorAll("[data-unfollow-event]").forEach((btn) => {
    btn.addEventListener("click", () => dropFollow({ kind: "event", slug: btn.dataset.unfollowEvent }));
  });
  flowRoot().querySelectorAll("[data-unfollow-team]").forEach((btn) => {
    btn.addEventListener("click", () => dropFollow({ kind: "club", id: btn.dataset.unfollowTeam }));
  });
  document.getElementById("password-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = document.getElementById("password-note");
    const data = Object.fromEntries(new FormData(ev.target));
    note.hidden = false;
    if (data.password !== data.passwordConfirm) {
      note.textContent = "The new passwords do not match.";
      return;
    }
    const collection = (u && u.collectionName) || "users";
    try {
      await flowPb.collection(collection).update(u.id, {
        oldPassword: data.oldPassword,
        password: data.password,
        passwordConfirm: data.passwordConfirm,
      });
      note.textContent = "Password saved. Use it the next time you log in.";
      ev.target.reset();
    } catch (err) {
      note.textContent = "Could not change the password. Check the current one and try again.";
    }
  });
}

export async function findPage() {
  return startGate("find");
}

function teamAdminError(text) {
  const box = document.getElementById("team-admin-err");
  if (!box) return;
  box.hidden = !text;
  box.textContent = text || "";
  if (text && box.scrollIntoView) box.scrollIntoView({ block: "center" });
}

async function teamAdminFail(res, local) {
  let text = "";
  try { text = await res.text(); } catch (err) { text = ""; }
  try {
    const body = JSON.parse(text);
    text = body.message || text;
  } catch (err) {}
  text = text || "Could not save that change.";
  teamAdminError(text);
  if (local) {
    local.hidden = false;
    local.textContent = text;
  }
}

export async function adminTeams() {
  const u = who();
  if (!isSiteAdmin(u)) {
    flowRoot().innerHTML = gateChrome("admin", `<section class="card"><p>Site admin only.</p><p><a class="btn" data-link href="/login">Log in</a></p></section>`);
    return;
  }
  const headers = { ...authHeader() };
  const [clubRes, masterRes, attachRes] = await Promise.all([
    fetch("/api/admin/clubs", { headers }),
    fetch("/api/admin/teams", { headers }),
    fetch("/api/admin/teams/attach", { headers }),
  ]);
  if (!clubRes.ok || !masterRes.ok || !attachRes.ok) {
    flowRoot().innerHTML = gateChrome("admin", `<section class="card empty">Could not load team profiles.</section>`);
    return;
  }
  const clubs = (await clubRes.json()).clubs || [];
  const masterBody = await masterRes.json();
  const masters = masterBody.teams || [];
  const preview = await attachRes.json();
  const eventLine = (preview.events || []).map((ev) => `${escapeHtml(ev.name || ev.slug)} (${ev.rows})`).join(", ");
  const suggestionLabel = (g) => {
    if (g.action === "create") return "Suggested: new master team";
    if (g.action === "link") return "Suggested: " + (g.master_name || "existing team");
    return "Suggested: leave unlinked";
  };
  const groupRows = (preview.groups || []).map((g) => {
    const why = g.reason || (g.match === "gamechanger" ? "Same GameChanger link" : g.match === "name" ? "Exact name" : "");
    const places = (g.weekends || []).slice(0, 3).map((w) => w.event_name || w.name).filter(Boolean);
    const extra = (g.weekends || []).length > places.length ? " +" + ((g.weekends || []).length - places.length) : "";
    return `<tr data-attach-row="${escapeHtml(g.key)}">
      <td><b>${escapeHtml(g.name)}</b><br><span class="muted">${escapeHtml(why)}${places.length ? " · " + escapeHtml(places.join(", ") + extra) : ""}</span></td>
      <td>${(g.weekends || []).length}</td>
      <td>
        <select data-attach-mode="${escapeHtml(g.key)}">
          <option value="suggested">${escapeHtml(suggestionLabel(g))}</option>
          <option value="create">Create a new master team</option>
          <option value="skip">Leave unlinked</option>
          <option value="pick">Choose a different master team</option>
        </select>
        <div data-attach-pick="${escapeHtml(g.key)}" hidden>
          <input data-attach-find="${escapeHtml(g.key)}" placeholder="Type a master team name" autocomplete="off">
          <div class="attach-hits" data-attach-hits="${escapeHtml(g.key)}"></div>
        </div>
      </td>
    </tr>`;
  }).join("");
  flowRoot().innerHTML = gateChrome("admin", `
    <section class="page-head">
      <h1>Team profiles</h1>
      <p class="muted">Site admin only. Open Details to edit a master team. Remove deletes that team, its roster, and its season book, and takes it off every weekend. <a data-link href="/admin/events">Remove tournaments</a> before attaching leftover weekend teams.</p>
      <p class="error" id="team-admin-err" hidden></p>
    </section>
    <section class="card" id="attach-card">
      <h2>Attach leftover weekend teams</h2>
      <p class="muted">Each row starts on the suggestion. Switch a row to another master team, a new master team, or leave it unlinked. Delete the test tournament and Keystone Clash first if those clubs should stay off the master list. Scores and player lines stay as they are.</p>
      <p>${preview.unlinked
        ? `${preview.unlinked} weekend teams are not on a master team yet. Suggestions: ${preview.will_link} join one that already exists. ${preview.will_create} new master teams cover ${preview.create_rows} weekend rows. ${preview.skipped} left unlinked.`
        : "Every weekend team already points at a master team."}</p>
      ${eventLine ? `<p class="muted">Tournaments in this pass: ${eventLine}</p>` : ""}
      ${groupRows ? `<label>Find a leftover <input id="attach-find" placeholder="Type a name"></label>
      <div class="table-wrap"><table>
        <thead><tr><th>Weekend team</th><th>Weekends</th><th>Master team</th></tr></thead>
        <tbody>${groupRows}</tbody>
      </table></div>` : ""}
      ${preview.groups_truncated ? `<p class="muted">Showing the first 400 groups. The rest use the suggestion.</p>` : ""}
      <button class="btn" type="button" id="attach-go" ${preview.unlinked ? "" : "disabled"}>Attach leftover teams</button>
    </section>
    <section class="card">
      <h2>Master teams</h2>
      <p class="muted">This is the team a coach owns. ${masters.length} on file${masterBody.truncated ? " (first 2,000)" : ""}.</p>
      <label>Find a team <input id="master-find" placeholder="Type a name"></label>
      <div id="master-list"></div>
    </section>
    <section class="card">
      <h2>Year-board profiles</h2>
      <p class="muted">Older club rows used by the year board. Removing one drops that profile. Weekend teams and scores stay.</p>
      <form class="form wide" id="club-new">
        <h3>Add a profile</h3>
        <label>Team name <input name="name" required placeholder="Hawks 10U"></label>
        <label>Age group <input name="ages" placeholder="10U"></label>
        <label>GameChanger URL (optional) <input name="gamechanger_url" type="url" placeholder="https://web.gc.com/team/…"></label>
        <label>Contact email <input name="contact_email" type="email"></label>
        <label>Notes <input name="notes" placeholder="No GC this season; scorebook at the field"></label>
        <button class="btn" type="submit">Save team</button>
      </form>
      <label>Find a profile <input id="club-find" placeholder="Type a name"></label>
      <div id="club-list"></div>
    </section>
  `);

  const showMasters = (query) => {
    const q = String(query || "").trim().toLowerCase();
    const matched = masters.filter((t) => !q || String(t.name || "").toLowerCase().includes(q));
    const slice = matched.slice(0, 40);
    const box = document.getElementById("master-list");
    const ages = ["6U", "8U", "10U", "12U", "14U", "16U", "18U"];
    box.innerHTML = slice.map((t) => `
      <article class="card" data-master-card="${t.id}">
        <h3>${escapeHtml(t.name)}</h3>
        <p class="muted">${escapeHtml(t.age_group || "Age not set")} · ${t.gc_linked ? "GameChanger linked" : "No GameChanger"} · ${t.owner_state === "owner" ? "Has an owner" : t.owner_state === "pending" ? "Waiting on an email" : "No owner yet"} · ${escapeHtml(t.slug)}</p>
        <div class="actions">
          <button class="btn ghost" type="button" data-expand-master="${t.id}">Details</button>
          <button class="btn danger" type="button" data-remove-master="${t.id}" data-remove-name="${escapeHtml(t.name)}">Remove</button>
        </div>
        <form class="form wide" data-master-edit="${t.id}" hidden>
          <label>Team name <input name="name" required></label>
          <label>Age group
            <select name="age_group">
              <option value="">—</option>
              ${ages.map((a) => `<option value="${a}">${a}</option>`).join("")}
            </select>
          </label>
          <label>Coach name <input name="coach_name"></label>
          <label>GameChanger team URL <input name="gamechanger_url" type="url" placeholder="https://web.gc.com/team/…"></label>
          <label>Coach email <input name="coach_email" type="email" autocomplete="off"></label>
          <label>Coach phone <input name="coach_phone" type="text" inputmode="tel" autocomplete="off"></label>
          <fieldset class="setup-block">
            <legend>Second contact</legend>
            <label>Name <input name="alt_name"></label>
            <label>Email <input name="alt_email" type="email" autocomplete="off"></label>
            <label>Phone <input name="alt_phone" type="text" inputmode="tel" autocomplete="off"></label>
          </fieldset>
          <label>Co-owner emails <textarea name="co_owners" rows="2" placeholder="one email per line"></textarea></label>
          <p class="muted">Coach email and phone stay off the public team page.</p>
          <p class="error" data-master-err hidden></p>
          <button class="btn" type="submit">Save team</button>
        </form>
      </article>`).join("") || `<p class="empty">${q ? "No master team matches that name." : "No master teams yet."}</p>`;
    if (matched.length > slice.length) {
      box.insertAdjacentHTML("beforeend", `<p class="muted">Showing 40 of ${matched.length}. Type more of the name.</p>`);
    }
    box.querySelectorAll("[data-expand-master]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const form = box.querySelector('[data-master-edit="' + btn.dataset.expandMaster + '"]');
        if (!form) return;
        if (!form.hidden) {
          form.hidden = true;
          btn.textContent = "Details";
          return;
        }
        if (!form.dataset.loaded) {
          const res2 = await fetch("/api/teams/" + btn.dataset.expandMaster, { headers: authHeader() });
          if (!res2.ok) return teamAdminFail(res2, form.querySelector("[data-master-err]"));
          const team = await res2.json();
          const contact = team.contact || {};
          form.elements.name.value = team.name || "";
          form.elements.age_group.value = team.age_group || "";
          form.elements.coach_name.value = team.coach_name || "";
          form.elements.gamechanger_url.value = team.gamechanger_url || "";
          form.elements.coach_email.value = contact.coach_email || "";
          form.elements.coach_phone.value = contact.coach_phone || "";
          form.elements.alt_name.value = contact.alt_name || "";
          form.elements.alt_email.value = contact.alt_email || "";
          form.elements.alt_phone.value = contact.alt_phone || "";
          form.elements.co_owners.value = (team.co_owners || []).join("\n");
          form.dataset.loaded = "1";
        }
        form.hidden = false;
        btn.textContent = "Hide details";
      });
    });
    box.querySelectorAll("[data-master-edit]").forEach((form) => {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const local = form.querySelector("[data-master-err]");
        if (local) {
          local.hidden = true;
          local.textContent = "";
        }
        const data = Object.fromEntries(new FormData(form));
        const res2 = await fetch("/api/teams/" + form.dataset.masterEdit, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(data),
        });
        if (!res2.ok) return teamAdminFail(res2, local);
        flashSaved("Team saved");
        adminTeams();
      });
    });
    box.querySelectorAll("[data-remove-master]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.removeName || "this team";
        if (!confirm("Delete " + name + "? This removes the master team, its roster, and its season book, and takes it off any weekend.")) return;
        const res2 = await fetch("/api/admin/teams/" + btn.dataset.removeMaster + "/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ confirm: true }),
        });
        if (!res2.ok) return teamAdminFail(res2);
        flashSaved("Team removed");
        adminTeams();
      });
    });
  };

  const showClubs = (query) => {
    const q = String(query || "").trim().toLowerCase();
    const matched = clubs.filter((c) => !q || String(c.name || "").toLowerCase().includes(q));
    const slice = matched.slice(0, 40);
    const box = document.getElementById("club-list");
    box.innerHTML = slice.map((c) => `
      <form class="card form wide" data-club="${c.id}">
        <h3>${escapeHtml(c.name)}</h3>
        <p class="muted">${c.gc_linked ? "GameChanger linked" : "No GameChanger — stats from this host only"} · ${escapeHtml(c.slug)}</p>
        <label>Name <input name="name" value="${escapeHtml(c.name)}" required></label>
        <label>Age <input name="ages" value="${escapeHtml(c.ages)}"></label>
        <label>GameChanger URL <input name="gamechanger_url" type="url" value="${escapeHtml(c.gamechanger_url)}"></label>
        <label>Contact email <input name="contact_email" type="email" value="${escapeHtml(c.contact_email)}"></label>
        <label>Notes <input name="notes" value="${escapeHtml(c.notes)}"></label>
        <div class="actions">
          <button class="btn ghost" type="submit">Update</button>
          <button class="btn danger" type="button" data-remove-club="${c.id}" data-remove-name="${escapeHtml(c.name)}">Remove</button>
        </div>
      </form>`).join("") || `<p class="empty">${q ? "No profile matches that name." : "No team profiles yet."}</p>`;
    if (matched.length > slice.length) {
      box.insertAdjacentHTML("beforeend", `<p class="muted">Showing 40 of ${matched.length}. Type more of the name.</p>`);
    }
    box.querySelectorAll("[data-club]").forEach((form) => {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const body = Object.fromEntries(new FormData(form));
        const res2 = await fetch("/api/admin/clubs/" + form.dataset.club, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
        if (!res2.ok) return teamAdminFail(res2);
        flashSaved("Club saved");
        adminTeams();
      });
    });
    box.querySelectorAll("[data-remove-club]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.removeName || "this profile";
        if (!confirm("Remove " + name + " from the year board? Weekend teams and scores stay.")) return;
        const res2 = await fetch("/api/admin/clubs/" + btn.dataset.removeClub + "/remove", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ confirm: true }),
        });
        if (!res2.ok) return teamAdminFail(res2);
        flashSaved("Profile removed");
        adminTeams();
      });
    });
  };

  showMasters("");
  showClubs("");
  document.getElementById("master-find").addEventListener("input", (ev) => showMasters(ev.target.value));
  document.getElementById("club-find").addEventListener("input", (ev) => showClubs(ev.target.value));
  document.getElementById("club-new").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(ev.target));
    const res2 = await fetch("/api/admin/clubs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!res2.ok) return teamAdminFail(res2);
    flashSaved("Club saved");
    adminTeams();
  });
  const attachFind = document.getElementById("attach-find");
  if (attachFind) {
    attachFind.addEventListener("input", () => {
      const q = attachFind.value.trim().toLowerCase();
      flowRoot().querySelectorAll("[data-attach-row]").forEach((row) => {
        row.hidden = !!(q && row.textContent.toLowerCase().indexOf(q) < 0);
      });
    });
  }
  const pickBoxes = {};
  const findBoxes = {};
  const hitBoxes = {};
  flowRoot().querySelectorAll("[data-attach-pick]").forEach((el) => { pickBoxes[el.dataset.attachPick] = el; });
  flowRoot().querySelectorAll("[data-attach-find]").forEach((el) => { findBoxes[el.dataset.attachFind] = el; });
  flowRoot().querySelectorAll("[data-attach-hits]").forEach((el) => { hitBoxes[el.dataset.attachHits] = el; });
  flowRoot().querySelectorAll("[data-attach-mode]").forEach((sel) => {
    const key = sel.dataset.attachMode;
    const pick = pickBoxes[key];
    const find = findBoxes[key];
    const hitBox = hitBoxes[key];
    sel.addEventListener("change", () => {
      const choosing = sel.value === "pick";
      if (pick) pick.hidden = !choosing;
      if (!choosing) delete sel.dataset.masterId;
    });
    if (!find || !hitBox) return;
    find.addEventListener("input", () => {
      const q = find.value.trim().toLowerCase();
      const matched = q ? masters.filter((t) => String(t.name || "").toLowerCase().includes(q)).slice(0, 8) : [];
      hitBox.innerHTML = matched.map((t) => `<button type="button" class="btn ghost" data-pick-id="${t.id}">${escapeHtml(t.name)}${t.age_group ? " · " + escapeHtml(t.age_group) : ""}</button>`).join("")
        || (q ? `<p class="muted">No master team matches.</p>` : "");
      hitBox.querySelectorAll("[data-pick-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          sel.dataset.masterId = btn.dataset.pickId;
          find.value = btn.textContent;
          hitBox.innerHTML = "";
        });
      });
    });
  });
  document.getElementById("attach-go").addEventListener("click", async () => {
    const choices = [];
    const missing = [];
    flowRoot().querySelectorAll("[data-attach-mode]").forEach((sel) => {
      const key = sel.dataset.attachMode;
      if (sel.value === "suggested") return;
      if (sel.value === "create") choices.push({ key, action: "create" });
      else if (sel.value === "skip") choices.push({ key, action: "skip" });
      else if (sel.value === "pick") {
        if (!sel.dataset.masterId) missing.push(key);
        else choices.push({ key, master_id: sel.dataset.masterId });
      }
    });
    if (missing.length) {
      teamAdminError("Choose a master team for each row set to a different team, or switch that row back to the suggestion.");
      return;
    }
    const names = (preview.events || []).map((ev) => ev.name || ev.slug).filter(Boolean);
    const listed = names.slice(0, 8).join(", ");
    const more = names.length > 8 ? " and " + (names.length - 8) + " more" : "";
    if (!confirm("Attach leftover weekend teams" + (listed ? " from " + listed + more : "") + "? Rows you changed use your choice. The others use the suggestion. Scores and player lines stay.")) return;
    const res2 = await fetch("/api/admin/teams/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ confirm: true, choices }),
    });
    if (!res2.ok) return teamAdminFail(res2);
    flashSaved("Weekend teams attached");
    adminTeams();
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
    <td>${r.ab ?? "—"}</td><td>${r.h ?? "—"}</td><td>${r.rbi ?? "—"}</td><td>${r.avg_display ?? "—"}</td>
  </tr>`);
  const pit = (board.pitching || []).map((r) => `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${escapeHtml(r.team)}</td>
    <td>${r.ip}</td><td>${r.er}</td><td>${r.so}</td><td>${r.era_display}</td>
  </tr>`);
  function table(headers, rows) {
    const stamped = (rows || []).map((r) => stampDataTh(r, headers));
    return `<div class="table-wrap"><table class="card-table desktop-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${stamped.join("") || `<tr><td colspan="${headers.length}" class="empty">No qualifying lines yet.</td></tr>`}</tbody></table></div>`;
  }
  const teamList = (board.teams || []).map((t) => `<li class="stat-row">
    <span class="stat-seed">${t.rank}</span>
    <div class="stat-main"><b class="stat-name">${escapeHtml(t.name)}</b>
      <span class="stat-meta">RS ${t.rs} · RA ${t.ra} · ${t.diff > 0 ? "+" : ""}${t.diff} · ${t.events} weekends</span></div>
    <span class="stat-val">${t.w}-${t.l}</span>
  </li>`);
  const hitList = (board.hitting || []).map((r) => `<li class="stat-row">
    <div class="stat-main"><b class="stat-name">${escapeHtml(r.name_key)}</b>
      <span class="stat-meta">${escapeHtml(r.team)} · ${r.ab} AB · ${r.h} H</span></div>
    <span class="stat-val">${escapeHtml(String(r.avg_display || "—"))}</span>
  </li>`);
  const pitList = (board.pitching || []).map((r) => `<li class="stat-row">
    <div class="stat-main"><b class="stat-name">${escapeHtml(r.name_key)}</b>
      <span class="stat-meta">${escapeHtml(r.team)} · ${r.ip} IP · ${r.so} K</span></div>
    <span class="stat-val">${escapeHtml(String(r.era_display || "—"))}</span>
  </li>`);
  flowRoot().innerHTML = gateChrome("year", `
    <section class="page-head">
      <h1>${escapeHtml(year)} series board</h1>
      <p class="muted">Same club across weekends stays one row. Totals come from final event scores and approved boxes — nothing invented.</p>
      <p class="year-links">${(board.events || []).map((ev) => `<a data-link href="/t/${ev.slug}">${escapeHtml(ev.name)}</a>`).join(" · ") || "No public events in this year yet."}</p>
    </section>
    <section class="card">
      <h2>Team standings</h2>
      <p class="muted">Wins, then losses, then runs allowed, then runs scored. Events column is how many weekends that club appeared.</p>
      ${table(["#", "Club", "W", "L", "RS", "RA", "Diff", "Events", ""], teams)}
      ${teamList.length ? `<ul class="stat-list phone-stat-list">${teamList.join("")}</ul>` : ""}
    </section>
    <section class="grid two">
      <div class="card"><h2>Hitting</h2><p class="muted">Min 8 AB across the year</p>
        ${table(["Player", "Team", "AB", "H", "RBI", "AVG"], hit)}
        ${hitList.length ? `<ul class="stat-list phone-stat-list">${hitList.join("")}</ul>` : ""}</div>
      <div class="card"><h2>Pitching</h2><p class="muted">Min 3.0 IP · youth ERA base 7</p>
        ${table(["Player", "Team", "IP", "ER", "SO", "ERA"], pit)}
        ${pitList.length ? `<ul class="stat-list phone-stat-list">${pitList.join("")}</ul>` : ""}</div>
    </section>
  `);
}

export async function verifyPage() {
  const token = new URLSearchParams(location.search).get("token") || "";
  flowRoot().innerHTML = pageShell({
    pb: flowPb,
    site: "verify",
    body: `<section class="page-head"><h1>Confirm your email</h1></section>
      <section class="card">
        <p class="muted" id="verify-note">This link confirms the address on the new account.</p>
        <button class="btn" id="verify-go" type="button">Confirm my email</button>
      </section>`,
  });
  const note = document.getElementById("verify-note");
  const button = document.getElementById("verify-go");
  if (!token) {
    note.textContent = "That confirmation link is missing a token.";
    button.hidden = true;
    return;
  }
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const res = await fetch("/api/account/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.message || "That confirmation link is expired or already used.");
      note.innerHTML = `Email confirmed${out.email ? " for " + escapeHtml(out.email) : ""}. <a class="btn" data-link href="/account">Open your account</a>`;
      button.hidden = true;
    } catch (err) {
      button.disabled = false;
      note.textContent = err.message || String(err);
    }
  });
}

export async function forgotPage() {
  flowRoot().innerHTML = gateChrome("login", `
    <section class="page-head">
      <h1>Forgot my password</h1>
      <p class="muted">We email a reset link when PocketBase Admin mail is on. The same form works for a regular login or the PocketBase admin account.</p>
    </section>
    <section class="card">
      <form class="form wide" id="forgot-form">
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <button class="btn" type="submit">Send reset link</button>
      </form>
      <p><a data-link href="/login">Back to log in</a></p>
    </section>
    <p class="error" id="gate-error" hidden></p>
  `);
  document.getElementById("forgot-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = document.getElementById("gate-error");
    const email = new FormData(ev.target).get("email");
    const res = await fetch("/api/account/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    err.hidden = false;
    err.className = res.ok ? "muted" : "error";
    if (!res.ok) {
      err.textContent = await res.text();
      return;
    }
    const out = await res.json();
    err.textContent = out.mail === "not_configured"
      ? "PocketBase mail is not configured, so no reset link was sent."
      : "If that email is on this site, a reset link is on the way.";
  });
}

export async function resetPage() {
  const token = new URLSearchParams(location.search).get("token") || "";
  flowRoot().innerHTML = gateChrome("login", `
    <section class="page-head">
      <h1>Choose a new password</h1>
      <p class="muted">Use the link from your email. Then log in with the new password.</p>
    </section>
    <section class="card">
      <form class="form wide" id="reset-form">
        <label>New password (8+ characters) <input name="password" type="password" autocomplete="new-password" required minlength="8"></label>
        <label>Confirm password <input name="password_confirm" type="password" autocomplete="new-password" required minlength="8"></label>
        <button class="btn" type="submit">Save password</button>
      </form>
    </section>
    <p class="error" id="gate-error" hidden></p>
  `);
  document.getElementById("reset-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = document.getElementById("gate-error");
    const data = Object.fromEntries(new FormData(ev.target));
    if (data.password !== data.password_confirm) {
      err.hidden = false;
      err.textContent = "Those passwords do not match.";
      return;
    }
    if (!token) {
      err.hidden = false;
      err.textContent = "That reset link is missing a token.";
      return;
    }
    const res = await fetch("/api/account/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: data.password }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      err.hidden = false;
      err.textContent = out.message || await res.text();
      return;
    }
    flashSaved("Password saved");
    goFlow("/login");
  });
}

export async function adminEvents() {
  const u = who();
  if (!isSiteAdmin(u)) {
    flowRoot().innerHTML = gateChrome("adminEvents", `<section class="card"><p>Site admin only.</p><p><a class="btn" data-link href="/login">Log in</a></p></section>`);
    return;
  }
  const res = await fetch("/api/admin/events", { headers: { ...authHeader() } });
  if (!res.ok) {
    flowRoot().innerHTML = gateChrome("adminEvents", `<section class="card empty">Could not load tournaments.</section>`);
    return;
  }
  const data = await res.json();
  const rows = (data.events || []).map((ev) => `
    <tr>
      <td><a data-link href="/t/${escapeHtml(ev.slug)}">${escapeHtml(ev.name)}</a></td>
      <td>${escapeHtml(ev.slug)}</td>
      <td>${escapeHtml(ev.status || "")}${ev.public ? "" : " · hidden"}</td>
      <td>${escapeHtml(ev.venue || "")}</td>
      <td>
        <div class="actions">
          <a class="btn ghost" data-link href="/t/${escapeHtml(ev.slug)}/admin">Desk</a>
          ${ev.status === "archived"
            ? `<span class="muted">Removed from Find</span>`
            : `<button class="btn ghost" type="button" data-archive="${escapeHtml(ev.slug)}">Remove from Find</button>`}
          <form class="inline-delete" data-delete="${escapeHtml(ev.slug)}">
            <label class="sr-only">Type ${escapeHtml(ev.slug)} to delete</label>
            <input name="slug" placeholder="Type slug to delete" autocomplete="off">
            <button class="btn danger" type="submit">Delete</button>
          </form>
        </div>
      </td>
    </tr>`).join("");
  flowRoot().innerHTML = gateChrome("adminEvents", `
    <section class="page-head">
      <h1>Remove tournaments</h1>
      <p class="muted">Site admin only. Remove hides the board from Find. Delete erases the weekend. Type the slug to confirm a delete. Directors cannot do this.</p>
      <p><a data-link href="/admin/teams">Team profiles</a></p>
    </section>
    <section class="card">
      <div class="table-wrap"><table>
        <thead><tr><th>Tournament</th><th>Slug</th><th>Status</th><th>Venue</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">No tournaments.</td></tr>`}</tbody>
      </table></div>
      <p class="error" id="admin-event-err" hidden></p>
    </section>
  `);
  const showErr = async (res2) => {
    const box = document.getElementById("admin-event-err");
    box.hidden = false;
    box.textContent = await res2.text();
  };
  flowRoot().querySelectorAll("[data-archive]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Hide " + btn.dataset.archive + " from Find? The public link stops listing it.")) return;
      const res2 = await fetch("/api/admin/events/" + encodeURIComponent(btn.dataset.archive) + "/archive", {
        method: "POST",
        headers: { ...authHeader() },
      });
      if (!res2.ok) return showErr(res2);
      flashSaved("Tournament removed from Find");
      adminEvents();
    });
  });
  flowRoot().querySelectorAll("[data-delete]").forEach((form) => {
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const slug = form.dataset.delete;
      const typed = new FormData(form).get("slug");
      if (typed !== slug) {
        const box = document.getElementById("admin-event-err");
        box.hidden = false;
        box.textContent = "Type the slug " + slug + " to delete this tournament.";
        return;
      }
      if (!confirm("Permanently delete " + slug + "? This cannot be undone.")) return;
      const res2 = await fetch("/api/admin/events/" + encodeURIComponent(slug) + "/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify({ confirm: true, slug }),
      });
      if (!res2.ok) return showErr(res2);
      flashSaved("Tournament deleted");
      adminEvents();
    });
  });
}
