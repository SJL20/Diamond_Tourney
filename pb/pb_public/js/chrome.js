export function isSiteAdmin(rec) {
  if (!rec) return false;
  if (rec.collectionName === "_superusers") return true;
  if (rec.verified && String(rec.email || "").toLowerCase() === "ladydukeslafever@gmail.com") return true;
  return rec.role === "region_admin" && rec.verified !== false;
}

export function canAdminEvent(rec, event) {
  if (!rec || rec.role === "bot") return false;
  if (isSiteAdmin(rec)) return true;
  if (event && event.can_admin === true) return true;
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
         ${isDirector(u) ? item("/start", "create", "Create") : ""}
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

function tabIcon(kind) {
  const paths = {
    home: '<path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
    overall: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M4 10h16M8 4v4M16 4v4"/>',
    standings: '<path d="M5 7h14M5 12h14M5 17h10"/>',
    bracket: '<path d="M5 5h6v6H5zM13 13h6v6h-6zM8 11v5h5"/>',
    more: '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>',
    hitting: '<path d="M7 17 16 6M9 6h8v8"/>',
    pitching: '<circle cx="12" cy="8" r="3"/><path d="M12 11v3M8 20c1.5-4 6.5-4 8 0"/>',
    games: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M8 6V4M16 6V4"/>',
    schedule: '<rect x="4" y="6" width="16" height="13" rx="2"/><path d="M8 6V4M16 6V4"/>',
  };
  return `<svg class="tab-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round">${paths[kind] || paths.more}</svg>`;
}

function destOn(item, page) {
  return page === item.key
    || (item.key === "stats" && ["stats", "leaders", "awards"].includes(page))
    || (item.key === "standings" && page === "pools")
    || (item.key === "signup" && page === "sign up")
    || (item.key === "overall" && page === "overall")
    || (item.key === "schedule" && (page === "schedule" || page === "game"));
}

function destLink(item) {
  return `<a class="${item.on ? "active" : ""}" data-link href="${item.href}"${item.on ? ' aria-current="page"' : ""}>${item.label}</a>`;
}

export function eventDestinations(event, page = "", pb = null) {
  if (!event?.slug) return [];
  const slug = event.slug;
  const rec = pb?.authStore?.record;
  const isDir = canAdminEvent(rec, event);
  const items = [
    { href: `/t/${slug}`, key: "home", label: "Home", tab: true },
    { href: `/t/${slug}/overall`, key: "overall", label: "Schedule", tab: true },
    { href: `/t/${slug}/standings`, key: "standings", label: "Standings", tab: true },
    { href: `/t/${slug}/bracket`, key: "bracket", label: "Bracket", tab: true },
    { href: `/t/${slug}/schedule`, key: "schedule", label: "Games", tab: false },
    { href: `/t/${slug}/stats`, key: "stats", label: "Stats", tab: false },
    { href: `/t/${slug}/info`, key: "info", label: "Info", tab: false },
  ];
  if (event.signup_open !== false) items.push({ href: `/t/${slug}/signup`, key: "signup", label: "Sign up", tab: false });
  if (isDir) items.push({ href: `/t/${slug}/admin`, key: "admin", label: "Admin", tab: false });
  return items.map((item) => ({ ...item, on: destOn(item, page) }));
}

export function teamDestinations(team, page = "", pb = null) {
  if (!team?.slug) return [];
  const slug = team.slug;
  const rec = pb?.authStore?.record;
  const canReview = rec && (isSiteAdmin(rec) || (rec.role === "team_coach" && rec.team === team.id));
  const items = [
    { href: `/teams/${slug}/home`, key: "home", label: "Home", tab: true },
    { href: `/teams/${slug}/hitting`, key: "hitting", label: "Hitting", tab: true },
    { href: `/teams/${slug}/pitching`, key: "pitching", label: "Pitching", tab: true },
    { href: `/teams/${slug}/games`, key: "games", label: "Games", tab: true },
    { href: `/teams/${slug}/roster`, key: "roster", label: "Roster", tab: false },
  ];
  if (canReview) items.push({ href: `/teams/${slug}/admin/review`, key: "review", label: "Review", tab: false });
  return items.map((item) => ({ ...item, on: page === item.key }));
}

function moreSheet(items, title) {
  return `
    <div class="tourney-more-sheet" id="tourney-more-sheet" hidden>
      <button type="button" class="more-backdrop" data-more-close aria-label="Close More"></button>
      <div class="more-panel" role="dialog" aria-modal="true" aria-labelledby="more-title">
        <h2 id="more-title">${escapeText(title)}</h2>
        <nav class="more-list" aria-label="More">
          ${items.map((item) =>
            `<a data-link href="${item.href}"${item.on ? ' aria-current="page" class="on"' : ""}>${escapeText(item.label)}</a>`).join("")}
        </nav>
        <button type="button" class="btn more-done" data-more-close>Done</button>
      </div>
    </div>`;
}

function tourneyTabbar(items, page, moreTitle) {
  const tabs = items.filter((item) => item.tab);
  const extra = items.filter((item) => !item.tab);
  const moreOn = extra.some((item) => item.on);
  return `
    <nav class="tourney-tabbar" aria-label="${escapeText(moreTitle === "Season book" ? "Season book" : "Tournament")}">
      ${tabs.map((item) => `
        <a class="tourney-tab${item.on ? " active" : ""}" data-link href="${item.href}"${item.on ? ' aria-current="page"' : ""}>
          ${tabIcon(item.key)}<span>${escapeText(item.label)}</span>
        </a>`).join("")}
      ${extra.length ? `
        <button type="button" class="tourney-tab${moreOn ? " active" : ""}" id="tourney-more" aria-expanded="false" aria-controls="tourney-more-sheet"${moreOn ? ' aria-current="page"' : ""}>
          ${tabIcon("more")}<span>More</span>
        </button>` : ""}
    </nav>
    ${extra.length ? moreSheet(extra, moreTitle) : ""}`;
}

export function eventBar(event, page = "", pb = null) {
  if (!event?.slug) return "";
  const slug = event.slug;
  const items = eventDestinations(event, page, pb);
  const meta = [event.ages, event.governing_label, event.venue].filter(Boolean).join(" · ");
  return `
    <div class="event-bar">
      <div class="wrap event-bar-inner">
        <div class="event-ident">
          <p class="kicker">Tournament</p>
          <a class="event-name" data-link href="/t/${slug}">${escapeText(event.name)}</a>
          ${meta ? `<p class="event-meta">${escapeText(meta)}</p>` : ""}
        </div>
        <nav class="event-nav event-nav-desk" aria-label="Tournament">
          ${items.map(destLink).join("")}
        </nav>
      </div>
    </div>
    ${tourneyTabbar(items, page, "More")}`;
}

export function teamBar(team, page = "", pb = null) {
  if (!team?.slug) return "";
  const slug = team.slug;
  const items = teamDestinations(team, page, pb);
  return `
    <div class="event-bar team-bar">
      <div class="wrap event-bar-inner">
        <div class="event-ident">
          <p class="kicker">Season book</p>
          <a class="event-name" data-link href="/teams/${slug}/home">${escapeText(team.name)}</a>
          <p class="event-meta">${escapeText([team.age_group, team.coach_name].filter(Boolean).join(" · "))}</p>
        </div>
        <nav class="event-nav event-nav-desk" aria-label="Team book">
          ${items.map(destLink).join("")}
        </nav>
      </div>
    </div>
    ${tourneyTabbar(items, page, "Season book")}`;
}

export function pageShell({ pb, site = "", event = null, team = null, page = "", body = "", footer = "", slim = false }) {
  const shell = slim ? "slim" : event ? "event" : team ? "team" : "site";
  document.body.dataset.shell = shell;
  const who = pb.authStore.record;
  const foot = footer || (event
    ? `Tournament board${event.venue ? " · " + event.venue : ""}`
    : team
      ? "Season book · stats stay in staging until a coach approves"
      : (who ? who.email : "Signed out") + " · Profiles are teams. Email is a login.");
  return `
    ${siteBar(pb, site)}
    ${!slim && event ? eventBar(event, page, pb) : ""}
    ${!slim && team ? teamBar(team, page, pb) : ""}
    <main id="main" class="wrap page">${body}</main>
    <footer class="wrap footer">${escapeText(foot)}</footer>
  `;
}

export function bindEventChrome() {
  const more = document.getElementById("tourney-more");
  const sheet = document.getElementById("tourney-more-sheet");
  if (!more || !sheet) return;
  const open = () => {
    sheet.hidden = false;
    more.setAttribute("aria-expanded", "true");
    document.body.dataset.moreOpen = "1";
  };
  const close = () => {
    sheet.hidden = true;
    more.setAttribute("aria-expanded", "false");
    delete document.body.dataset.moreOpen;
  };
  more.addEventListener("click", () => {
    if (sheet.hidden) open();
    else close();
  });
  sheet.querySelectorAll("[data-more-close]").forEach((el) => el.addEventListener("click", close));
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

let chromeWatch = null;

function writeChromeVars() {
  const root = document.documentElement;
  const site = document.querySelector(".site-bar");
  const event = document.querySelector(".event-bar");
  const tab = document.querySelector(".tourney-tabbar");
  const siteH = site ? Math.round(site.getBoundingClientRect().height) : 52;
  const eventH = event ? Math.round(event.getBoundingClientRect().height) : 0;
  const tabH = tab ? Math.round(tab.getBoundingClientRect().height) : 0;
  root.style.setProperty("--site-h", siteH + "px");
  root.style.setProperty("--event-bar-h", eventH + "px");
  root.style.setProperty("--tabbar-h", tabH + "px");
  root.style.setProperty("--chrome-h", (siteH + eventH) + "px");
  return { site, event, tab };
}

export function measureChrome() {
  const { site, event, tab } = writeChromeVars();
  if (typeof ResizeObserver === "undefined") return;
  if (chromeWatch) chromeWatch.disconnect();
  chromeWatch = new ResizeObserver(() => writeChromeVars());
  if (site) chromeWatch.observe(site);
  if (event) chromeWatch.observe(event);
  if (tab) chromeWatch.observe(tab);
}

export function collapseSetupOnPhone() {
  if (!window.matchMedia || !window.matchMedia("(max-width: 720px)").matches) return;
  document.querySelectorAll("details.setup-block[open]").forEach((el, i) => {
    if (i > 0) el.open = false;
  });
}
