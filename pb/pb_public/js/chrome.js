export function isSiteAdmin(rec) {
  if (!rec) return false;
  if (rec.role === "region_admin") return true;
  return rec.collectionName === "_superusers";
}

export function canAdminEvent(rec, event) {
  if (!rec || rec.role === "bot") return false;
  if (isSiteAdmin(rec)) return true;
  return !!(event && event.created_by && rec.id === event.created_by);
}

export function isDirector(rec, event) {
  if (event) return canAdminEvent(rec, event);
  return !!(rec && (isSiteAdmin(rec) || rec.role === "event_td"));
}

export async function loginWithPassword(pb, email, password) {
  try {
    return await pb.collection("users").authWithPassword(email, password);
  } catch (err) {
    return await pb.collection("_superusers").authWithPassword(email, password);
  }
}

export function siteBar(pb, active = "") {
  const u = pb.authStore.record;
  const item = (href, key, label) =>
    `<a class="${active === key ? "active" : ""}" data-link href="${href}">${label}</a>`;
  const links = `
    ${item("/find", "find", "Find")}
    ${item("/year/2026", "year", "Year")}
    ${u
      ? `${item("/account", "account", "Account")}
         ${isSiteAdmin(u) ? item("/admin/events", "adminEvents", "Tournaments") : ""}
         ${isSiteAdmin(u) ? item("/admin/teams", "admin", "Teams") : ""}
         ${item("/start", "create", "Create")}
         <button class="link" id="logout" type="button">Sign out</button>`
      : `${item("/login", "login", "Log in")}
         ${item("/register", "register", "Create account")}`}`;
  return `
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-bar">
      <div class="wrap site-bar-inner">
        <a class="brand" data-link href="/">
          <b>Diamond Tourney</b>
          <span>Site</span>
        </a>
        <nav class="nav site-nav" aria-label="Site">${links}</nav>
        <details class="site-menu">
          <summary>Menu</summary>
          <nav aria-label="Site">${links}</nav>
        </details>
      </div>
    </header>`;
}

export function eventBar(event, page = "", pb = null) {
  if (!event?.slug) return "";
  const slug = event.slug;
  const rec = pb?.authStore?.record;
  const isDir = canAdminEvent(rec, event);
  const statsOn = ["stats", "leaders", "awards"].includes(page);
  const links = [
    [`/t/${slug}`, "home", "Home"],
    [`/t/${slug}/standings`, "standings", "Standings"],
    [`/t/${slug}/overall`, "overall", "Schedule"],
    [`/t/${slug}/schedule`, "schedule", "Games"],
    [`/t/${slug}/bracket`, "bracket", "Bracket"],
    [`/t/${slug}/stats`, "stats", "Stats"],
    [`/t/${slug}/info`, "info", "Info"],
  ];
  if (event.signup_open !== false) links.push([`/t/${slug}/signup`, "signup", "Sign up"]);
  if (isDir) links.push([`/t/${slug}/admin`, "admin", "Admin"]);
  const meta = [event.ages, event.governing_label, event.venue].filter(Boolean).join(" · ");
  return `
    <div class="event-bar">
      <div class="wrap event-bar-inner">
        <div class="event-ident">
          <p class="kicker">Tournament</p>
          <a class="event-name" data-link href="/t/${slug}">${escapeText(event.name)}</a>
          ${meta ? `<p class="event-meta">${escapeText(meta)}</p>` : ""}
        </div>
        <nav class="event-nav" aria-label="Tournament">
          ${links.map(([href, key, label]) => {
            const on = page === key || (key === "stats" && statsOn) || (key === "standings" && page === "pools") || (key === "signup" && page === "sign up");
            return `<a class="${on ? "active" : ""}" data-link href="${href}">${label}</a>`;
          }).join("")}
        </nav>
      </div>
    </div>`;
}

export function teamBar(team, page = "", pb = null) {
  if (!team?.slug) return "";
  const slug = team.slug;
  const rec = pb?.authStore?.record;
  const canReview = rec && (isSiteAdmin(rec) || (rec.role === "team_coach" && rec.team === team.id));
  const links = [
    [`/teams/${slug}/home`, "home", "Home"],
    [`/teams/${slug}/roster`, "roster", "Roster"],
    [`/teams/${slug}/hitting`, "hitting", "Hitting"],
    [`/teams/${slug}/pitching`, "pitching", "Pitching"],
    [`/teams/${slug}/games`, "games", "Games"],
  ];
  if (canReview) links.push([`/teams/${slug}/admin/review`, "review", "Review"]);
  return `
    <div class="event-bar team-bar">
      <div class="wrap event-bar-inner">
        <div class="event-ident">
          <p class="kicker">Season book</p>
          <a class="event-name" data-link href="/teams/${slug}/home">${escapeText(team.name)}</a>
          <p class="event-meta">${escapeText([team.age_group, team.coach_name].filter(Boolean).join(" · "))}</p>
        </div>
        <nav class="event-nav" aria-label="Team book">
          ${links.map(([href, key, label]) =>
            `<a class="${page === key ? "active" : ""}" data-link href="${href}">${label}</a>`).join("")}
        </nav>
      </div>
    </div>`;
}

export function pageShell({ pb, site = "", event = null, team = null, page = "", body = "", footer = "" }) {
  const shell = event ? "event" : team ? "team" : "site";
  document.body.dataset.shell = shell;
  const who = pb.authStore.record;
  const foot = footer || (event
    ? `Tournament board${event.venue ? " · " + event.venue : ""}`
    : team
      ? "Season book · stats stay in staging until a coach approves"
      : (who ? who.email : "Signed out") + " · Profiles are teams. Email is a login.");
  return `
    ${siteBar(pb, site)}
    ${event ? eventBar(event, page, pb) : ""}
    ${team ? teamBar(team, page, pb) : ""}
    <main id="main" class="wrap page">${body}</main>
    <footer class="wrap footer">${escapeText(foot)}</footer>
  `;
}

function escapeText(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

export function flashSaved(message = "Saved") {
  let host = document.getElementById("save-toast");
  if (!host) {
    host = document.createElement("div");
    host.id = "save-toast";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.hidden = false;
  host.classList.add("show");
  clearTimeout(host._hide);
  host._hide = setTimeout(() => host.classList.remove("show"), 2800);
}
