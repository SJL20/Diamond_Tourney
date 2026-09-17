import { pageShell } from "./chrome.js";

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

function eventChrome(event, page, body) {
  const site = event ? "" : (page === "create" ? "create" : page);
  return pageShell({ pb: eventPb, site, event, page, body });
}

function dateInput(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function fieldRow(f = {}, i = 0) {
  return `<fieldset class="field-row">
    <legend>Field ${i + 1}</legend>
    <input type="hidden" name="field_id_${i}" value="${escapeHtml(f.id || "")}">
    <div class="form-grid two">
      <label>Name <input name="field_name_${i}" value="${escapeHtml(f.name || "")}" placeholder="East End 1"></label>
      <label>Surface <input name="field_surface_${i}" value="${escapeHtml(f.surface || "")}" placeholder="grass"></label>
    </div>
    <label>Field address <input name="field_address_${i}" value="${escapeHtml(f.address || "")}" placeholder="Same as the park if blank"></label>
    <div class="form-grid two">
      <label>Latitude <input name="field_lat_${i}" value="${f.lat || ""}" placeholder="40.3668"></label>
      <label>Longitude <input name="field_lng_${i}" value="${f.lng || ""}" placeholder="-80.2345"></label>
    </div>
    <label class="check"><input type="checkbox" name="field_lights_${i}" ${f.lights ? "checked" : ""}> Lights</label>
  </fieldset>`;
}

function bindFieldRows(root, startCount) {
  let n = startCount;
  const add = root.querySelector("#add-field");
  if (!add) return;
  add.addEventListener("click", () => {
    const box = root.querySelector("#field-rows");
    box.insertAdjacentHTML("beforeend", fieldRow({}, n));
    n += 1;
  });
}

function setupLocationFields(ev = {}, fields = []) {
  const rows = fields.length ? fields : [{}, {}];
  const fmt = ev.format || "pool-to-bracket";
  return `
    <details class="setup-block" open>
      <summary>Venue, address, and fields</summary>
      <label>Complex / park name <input name="venue" value="${escapeHtml(ev.venue || "")}" placeholder="East End Park"></label>
      <label>Street address <input name="address" value="${escapeHtml(ev.address || "")}" placeholder="51 Meadow St, McDonald, PA 15057"></label>
      <div class="form-grid two">
        <label>Latitude <input name="lat" value="${ev.lat || ""}" placeholder="40.3668"></label>
        <label>Longitude <input name="lng" value="${ev.lng || ""}" placeholder="-80.2345"></label>
      </div>
      <div class="form-grid two">
        <label>First day <input name="start" type="date" value="${dateInput(ev.start)}"></label>
        <label>Last day <input name="end" type="date" value="${dateInput(ev.end)}"></label>
      </div>
      <p class="muted">Use GPS or a street address. Each diamond can have its own pin; blank fields inherit the park.</p>
      <div id="field-rows">${rows.map((f, i) => fieldRow(f, i)).join("")}</div>
      <button class="btn ghost" type="button" id="add-field">Add another field</button>
    </details>
    <details class="setup-block" open>
      <summary>Bracket type and pool play</summary>
      <label>Format
        <select name="format">
          <option value="pool-to-bracket" ${fmt === "pool-to-bracket" ? "selected" : ""}>Pool play, then single-elim bracket</option>
          <option value="pool-only" ${fmt === "pool-only" ? "selected" : ""}>Pool play only</option>
          <option value="single-elim" ${fmt === "single-elim" ? "selected" : ""}>Single elimination</option>
          <option value="double-elim" ${fmt === "double-elim" ? "selected" : ""}>Double elimination</option>
          <option value="imported" ${fmt === "imported" ? "selected" : ""}>Imported / already drawn</option>
        </select>
      </label>
      <p class="muted">Pool games are scheduled per field. Auto-schedule builds a round-robin inside each pool, then draws the bracket if you chose one.</p>
    </details>
  `;
}

function rainBanner(ev) {
  if (!ev) return "";
  const st = ev.rain_status || "clear";
  if (st === "clear" && !ev.rain_note) return "";
  const labels = {
    watch: "Weather watch",
    delay: "Rain delay",
    postponed: "Postponed",
    moved: "Venue moved",
    clear: "Weather",
  };
  return `<section class="rain-banner ${escapeHtml(st)}">
    <div class="k">${labels[st] || "Weather"}</div>
    <p>${escapeHtml(ev.rain_note || ev.status_note || "")}</p>
  </section>`;
}

function fieldsBlock(ev, fields) {
  const list = fields || ev.fields || [];
  if (!list.length && !ev.address && !ev.venue) return "";
  return `<section class="card facts">
    <h2>Fields</h2>
    ${[
      ["Park", ev.venue],
      ["Address", ev.address],
    ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}${ev.map_url && k === "Address" ? ` · <a href="${escapeHtml(ev.map_url)}" target="_blank" rel="noopener">Map</a>` : ""}</dd></div>`).join("")}
    ${list.length ? `<ul class="field-list">${list.map((f) => `<li>
      <b>${escapeHtml(f.name)}</b>
      <span class="muted">${escapeHtml([f.surface, f.lights ? "lights" : "", f.status !== "open" ? f.status : ""].filter(Boolean).join(" · "))}</span>
      ${f.map_url ? `<a href="${escapeHtml(f.map_url)}" target="_blank" rel="noopener">Map</a>` : ""}
    </li>`).join("")}</ul>` : ""}
  </section>`;
}

function scoreText(g) {
  if (g.home_runs == null && g.away_runs == null) return "—";
  return `${g.home_runs ?? "—"}–${g.away_runs ?? "—"}`;
}

function realPoolGames(games) {
  return (games || []).filter((g) => g.home && g.away && g.id);
}

function scheduleByField(games, slug) {
  const list = realPoolGames(games);
  if (!list.length) return `<p class="empty">No pool games on the board yet. Empty bracket slots stay on the Bracket tab until those games are actually scheduled.</p>`;
  const groups = {};
  for (const g of list) {
    const key = g.field || "Unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(g);
  }
  return Object.keys(groups).sort().map((name) => `
    <div class="sched-field">
      <h3>${escapeHtml(name)}</h3>
      ${table(["When", "Pool", "Home", "Away", "Score", ""], groups[name].map((g) => `<tr>
        <td>${escapeHtml(g.date || "")} ${escapeHtml(g.time || "")}${g.delayed_from ? ` <span class="muted">(was ${escapeHtml(g.delayed_from)})</span>` : ""}</td>
        <td>${escapeHtml(g.pool || "")}</td>
        <td>${escapeHtml(g.home)}</td><td>${escapeHtml(g.away)}</td>
        <td>${scoreText(g)}</td>
        <td>${escapeHtml(g.status)}${g.has_box ? " · box" : ""}
          ${g.id ? ` · <a data-link href="/t/${escapeHtml(slug)}/games/${g.id}">${g.can_score ? "Post score" : "Open"}</a>` : ""}
        </td>
      </tr>`))}
    </div>`).join("");
}

function setupGuidelinesFields(ev = {}) {
  const sel = (name, value, opts) => `<select name="${name}">${opts.map(([v, l]) =>
    `<option value="${v}" ${String(ev[name] || value) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const check = (name, label) => `<label class="check"><input type="checkbox" name="${name}" ${ev[name] ? "checked" : ""}> ${label}</label>`;
  return `
    <details class="setup-block" open>
      <summary>Governing body</summary>
      <label>Sanction
        ${sel("governing_body", "usa_softball", [
          ["usa_softball", "USA Softball"],
          ["usssa", "USSSA"],
          ["pgf", "PGF"],
          ["triple_crown", "Triple Crown"],
          ["rec", "Rec / house"],
          ["other", "Other"],
        ])}
      </label>
      <label>Sanction number / notes <input name="governing_notes" value="${escapeHtml(ev.governing_notes || "")}" placeholder="USA Softball, finish the inning, two umpires"></label>
    </details>
    <details class="setup-block">
      <summary>Pitching limits</summary>
      <label>How you cap pitching
        ${sel("pitch_limit_mode", ev.pitch_limit_mode || "ip", [
          ["ip", "Innings pitched"],
          ["pitch_count", "Pitch count"],
          ["both", "IP and pitch count"],
          ["none", "No posted weekend cap"],
        ])}
      </label>
      <div class="form-grid two">
        <label>Weekend IP cap <input name="pitch_limit_ip" type="number" min="0" step="0.1" value="${ev.pitch_limit_ip ?? 6}"></label>
        <label>Weekend pitch cap <input name="pitch_limit_pitches" type="number" min="0" value="${ev.pitch_limit_pitches || ""}" placeholder="Leave blank if IP only"></label>
      </div>
      <label>How it is enforced <textarea name="pitch_limit_notes" rows="2" placeholder="6.0 IP for the weekend. A pitcher may finish the batter.">${escapeHtml(ev.pitch_limit_notes || "")}</textarea></label>
    </details>
    <details class="setup-block">
      <summary>Game rules</summary>
      <div class="form-grid two">
        <label>Game length (minutes) <input name="game_length_minutes" type="number" min="0" value="${ev.game_length_minutes || 90}"></label>
        <label>Inning cap <input name="innings_cap" type="number" min="0" value="${ev.innings_cap || 7}"></label>
        <label>Umpires per game <input name="umpire_count" type="number" min="0" value="${ev.umpire_count || 2}"></label>
        <label>Run / mercy rule <input name="mercy_rule" value="${escapeHtml(ev.mercy_rule || "12 after 3, 10 after 4, 8 after 5")}"></label>
      </div>
      <label>Rules notes <textarea name="rules_notes" rows="3">${escapeHtml(ev.rules_notes || "")}</textarea></label>
      <label>Rules attachment (PDF or photo) <input name="rules_file" type="file" accept=".pdf,image/jpeg,image/png,image/webp"></label>
      ${ev.rules_file_url ? `<p class="muted"><a href="${escapeHtml(ev.rules_file_url)}">Current rules file</a></p>` : ""}
    </details>
    <details class="setup-block">
      <summary>Team packet</summary>
      <p class="muted">Turn on only what this weekend requires. Birth certificates stay off unless you will check them.</p>
      ${check("require_insurance", "Certificate of insurance")}
      ${check("require_roster", "Official roster")}
      ${check("require_birth_certs", "Birth certificates / age proof")}
      ${check("require_waiver", "Waiver / medical release")}
      ${check("require_coach_cert", "Coach certification / background")}
      <label>Notes to coaches <textarea name="packet_notes" rows="3" placeholder="Insurance and roster before first pitch. Bring birth certificates to the plate meeting only if asked.">${escapeHtml(ev.packet_notes || "")}</textarea></label>
    </details>
  `;
}

function guidelinesBlock(ev) {
  if (!ev) return "";
  const req = ev.required_doc_labels || [];
  const pitch = ev.pitch_limit_mode === "none"
    ? "No posted weekend pitching cap"
    : ev.pitch_limit_mode === "pitch_count"
      ? `${ev.pitch_limit_pitches || "—"} pitches`
      : ev.pitch_limit_mode === "both"
        ? `${ev.pitch_limit_ip || 6}.0 IP and ${ev.pitch_limit_pitches || "—"} pitches`
        : `${ev.pitch_limit_ip || 6}.0 IP`;
  return `<section class="card facts">
    <h2>Weekend guidelines</h2>
    ${[
      ["Governing body", [ev.governing_label, ev.governing_notes].filter(Boolean).join(" — ")],
      ["Format", ev.format_label],
      ["Pitching cap", [pitch, ev.pitch_limit_notes].filter(Boolean).join(" — ")],
      ["Game length", ev.game_length_minutes ? ev.game_length_minutes + " minutes" : ""],
      ["Innings", ev.innings_cap ? String(ev.innings_cap) : ""],
      ["Umpires", ev.umpire_count ? String(ev.umpire_count) : ""],
      ["Mercy rule", ev.mercy_rule],
      ["Rules", ev.rules_notes],
      ["Team must upload", req.join(", ")],
      ["Packet notes", ev.packet_notes],
    ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}${k === "Rules" && ev.rules_file_url ? ` · <a href="${escapeHtml(ev.rules_file_url)}">Download attachment</a>` : ""}</dd></div>`).join("")}
  </section>`;
}

async function fetchBoard(slug) {
  const res = await fetch("/api/event/" + encodeURIComponent(slug) + "/board", {
    headers: authHeader(),
  });
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
    ${isDirector() && g.id && g.home && g.away ? `<form class="bk-score" data-bk-id="${escapeHtml(g.id)}">
      <input name="home_runs" type="number" min="0" value="${g.home_runs ?? ""}" aria-label="Home runs">
      <input name="away_runs" type="number" min="0" value="${g.away_runs ?? ""}" aria-label="Away runs">
      <button class="btn ghost" type="submit">Final</button>
    </form>` : ""}
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
    return `<section class="empty">No teams signed up yet. A team can join with or without GameChanger.</section>`;
  }
  return `<section class="card">
    <h2>Teams</h2>
    <p class="muted">GameChanger links are the public pages coaches published. This host stores the URL. It does not scrape private pages.</p>
    ${table(["Team", "Seed", "GameChanger"], teams.map((t) => `<tr>
      <td>${escapeHtml(t.name)}${t.host ? ` <span class="badge host">host</span>` : ""}</td>
      <td class="num">${t.seed || "—"}</td>
      <td>${t.gc_linked && t.gamechanger_url
        ? `<a href="${escapeHtml(t.gamechanger_url)}" target="_blank" rel="noopener">Open book</a>`
        : `<span class="muted">Not linked</span>`}</td>
    </tr>`))}
  </section>`;
}

export async function eventHome(slug) {
  const board = await fetchBoard(slug);
  const ev = board.event;
  const packet = board.packet || ev.packet;
  const champ = packet?.champion;
  eventRoot().innerHTML = eventChrome(ev, "home", `
    <section class="page-head">
      <p class="lede">${escapeHtml(ev.status_note || packet?.status || "Live standings. The bracket fills when scores are final.")}</p>
      <p class="muted">${escapeHtml([ev.dates || packet?.dates, ev.format_label, sourceLabel(ev)].filter(Boolean).join(" · "))}</p>
      <div class="actions">
        ${ev.signup_open ? `<a class="btn" data-link href="/t/${ev.slug}/signup">Sign a team up</a>` : `<span class="muted">Signup is closed.</span>`}
        <a class="btn ghost" data-link href="/t/${ev.slug}/bracket">Open bracket</a>
        ${ev.slug === "keystone-clash-2026" ? `<a class="btn ghost" href="/popup/index.html">Popup site</a>` : ""}
        ${ev.tm_url ? `<a class="btn ghost" href="${escapeHtml(ev.tm_url)}" target="_blank" rel="noopener">Tourney Machine</a>` : ""}
      </div>
    </section>
    ${rainBanner(ev)}
    ${fieldsBlock(ev, board.fields)}
    ${champ ? `<section class="champ-banner">
      <div class="k">Champions</div>
      <div class="t">${escapeHtml(champ.team)}</div>
      <p>${escapeHtml(champ.record || "")}${champ.line ? " — " + escapeHtml(champ.line) : ""}</p>
      ${packet?.runner_up ? `<div class="ru"><span>Runner-up</span><b>${escapeHtml(packet.runner_up.team)}</b> ${escapeHtml(packet.runner_up.record || "")}</div>` : ""}
    </section>` : ""}
    <section class="grid two">${standingsBlock(board.standings)}</section>
    ${rosterBlock(board.roster)}
  `);
}

export async function eventPools(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "pools", `<section class="grid two">${standingsBlock(board.standings)}</section>`);
}

export async function eventBracket(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "bracket", `
    <section class="page-head">
      <h1>Bracket</h1>
      <p class="muted">Championship on top. Consolation sits to the side and never feeds the title game.</p>
    </section>
    ${board.bracket.length ? bracketBoards(board.bracket) : `<section class="card empty">No bracket games yet. Draw the bracket from Admin after pool play.</section>`}
  `);
  eventRoot().querySelectorAll("[data-bk-id]").forEach((form) => {
    form.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/bracket/" + form.dataset.bkId + "/score", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        alert(await res.text());
        return;
      }
      eventBracket(slug);
    });
  });
}

export async function eventSchedule(slug) {
  const board = await fetchBoard(slug);
  const packet = board.packet || board.event.packet;
  const rows = realPoolGames(board.schedule).sort((a, b) =>
    String(a.date + a.time + a.field + a.home).localeCompare(String(b.date + b.time + b.field + b.home)));
  eventRoot().innerHTML = eventChrome(board.event, "schedule", `
    <section class="page-head">
      <h1>Games</h1>
      <p class="muted">Pool games by diamond. Bracket placeholders stay on Bracket until those games have teams and a time. Directors and team managers post scores from a game.</p>
    </section>
    ${rainBanner(board.event)}
    <section class="card">
      ${packet?.info?.pool_note ? `<p class="muted">${escapeHtml(packet.info.pool_note)}</p>` : ""}
      ${packet?.bracket_venue ? `<p class="muted">${escapeHtml(packet.bracket_venue)}${packet.bracket_note ? " — " + escapeHtml(packet.bracket_note) : ""}</p>` : ""}
      ${scheduleByField(rows, board.event.slug)}
    </section>`);
}

export async function eventGame(slug, id) {
  const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/schedule/" + encodeURIComponent(id), {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(await res.text());
  const detail = await res.json();
  const ev = (await fetchBoard(slug)).event;
  const g = detail.game;
  const box = detail.box;
  const can = !!g.can_score;
  eventRoot().innerHTML = eventChrome(ev, "schedule", `
    <section class="page-head">
      <h1>${escapeHtml(g.home)} vs ${escapeHtml(g.away)}</h1>
      <p class="muted">${escapeHtml([g.date, g.time, g.field, g.pool ? "Pool " + g.pool : ""].filter(Boolean).join(" · "))}</p>
      <p><a data-link href="/t/${escapeHtml(slug)}/schedule">Back to games</a></p>
    </section>
    <section class="card">
      <h2>Score</h2>
      ${can ? `<form class="form wide" id="score-form">
        <div class="form-grid two">
          <label>${escapeHtml(g.home)} <input name="home_runs" type="number" min="0" value="${g.home_runs ?? ""}" required></label>
          <label>${escapeHtml(g.away)} <input name="away_runs" type="number" min="0" value="${g.away_runs ?? ""}" required></label>
        </div>
        ${detail.director ? `<label>Status
          <select name="status">
            <option value="scheduled" ${g.status === "scheduled" ? "selected" : ""}>Scheduled</option>
            <option value="live" ${g.status === "live" ? "selected" : ""}>Live</option>
            <option value="submitted" ${g.status === "submitted" ? "selected" : ""}>Submitted — waiting on director</option>
            <option value="final" ${g.status === "final" ? "selected" : ""}>Final</option>
          </select>
        </label>` : `<p class="muted">A team manager post waits as submitted until the director marks it final. The director can override any score.</p>`}
        <label>Note <input name="notes" value="${escapeHtml(g.notes || "")}"></label>
        <button class="btn" type="submit">Save score</button>
        <p class="error" id="score-err" hidden></p>
        <p class="muted" id="score-note"></p>
      </form>` : `<p>${scoreText(g)} · ${escapeHtml(g.status)}</p>
        <p class="muted">${eventPb.authStore.record ? "This is not your game to score." : "Log in as the director or a team manager to post a result."}</p>`}
    </section>
    <section class="card">
      <h2>Box score</h2>
      <p class="muted">Upload the scorebook photo or PDF. Optional hitting and pitching lines are stored as posted — nothing is invented from the picture.</p>
      ${box ? `<p>${box.url ? `<a href="${escapeHtml(box.url)}" target="_blank" rel="noopener">${escapeHtml(box.original_name || "Current box")}</a>` : "Lines on file"} · ${escapeHtml(box.status)}${box.note ? " · " + escapeHtml(box.note) : ""}</p>` : `<p class="empty">No box uploaded yet.</p>`}
      ${can ? `<form class="form wide" id="box-form">
        <label>Scorebook photo or PDF <input name="file" type="file" accept=".pdf,image/jpeg,image/png,image/webp"></label>
        <label>Hitting lines (optional)
          <textarea name="hitting" rows="4" placeholder="home,hit,4,Maeve D,4,1,2,1,0,0">${box && Array.isArray(box.hitting) && box.hitting.length ? escapeHtml(JSON.stringify(box.hitting)) : ""}</textarea>
        </label>
        <label>Pitching lines (optional)
          <textarea name="pitching" rows="3" placeholder="home,pit,7,Sam P,4.0,3,1,1,1,5">${box && Array.isArray(box.pitching) && box.pitching.length ? escapeHtml(JSON.stringify(box.pitching)) : ""}</textarea>
        </label>
        <p class="muted">CSV: side,hit or pit,jersey,name, then AB R H RBI BB SO — or IP H R ER BB SO.</p>
        <label>Note <input name="note" value="${escapeHtml(box?.note || "")}"></label>
        <button class="btn" type="submit">Upload box</button>
        <p class="error" id="box-err" hidden></p>
      </form>` : ""}
    </section>
  `);
  const show = (id, err) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    el.textContent = err.message || String(err);
  };
  const scoreForm = document.getElementById("score-form");
  if (scoreForm) {
    scoreForm.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const data = Object.fromEntries(new FormData(evnt.target));
      if (detail.director && data.status === "final") data.confirm = true;
      const out = await fetch("/api/events/" + encodeURIComponent(slug) + "/schedule/" + encodeURIComponent(id) + "/score", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body: JSON.stringify(data),
      });
      if (!out.ok) return show("score-err", new Error(await out.text()));
      eventGame(slug, id);
    });
  }
  const boxForm = document.getElementById("box-form");
  if (boxForm) {
    boxForm.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const out = await fetch("/api/events/" + encodeURIComponent(slug) + "/schedule/" + encodeURIComponent(id) + "/box", {
        method: "POST",
        headers: { ...authHeader() },
        body: new FormData(evnt.target),
      });
      if (!out.ok) return show("box-err", new Error(await out.text()));
      eventGame(slug, id);
    });
  }
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
  eventRoot().innerHTML = eventChrome(board.event, "stats", `
    <section class="page-head">
      <h1>Stat leaders</h1>
      <p class="muted">${escapeHtml(board.leaders.stats_note || "Qualifying minimums are 8 at-bats and 5 innings. Lines come from each team’s published scorebook.")}</p>
      <div class="actions">
        <a class="btn ghost" data-link href="/t/${board.event.slug}/stats">Full board</a>
        <a class="btn ghost" data-link href="/t/${board.event.slug}/awards">Awards</a>
      </div>
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
    <section class="page-head print-sheet">
      <h1>All-tournament</h1>
      <p class="muted">Picked on numbers, not on which kid the director happened to watch.</p>
      <div class="actions"><button class="btn" type="button" onclick="window.print()">Print award sheet</button></div>
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
  eventRoot().innerHTML = eventChrome(null, "find", `
    <section class="page-head">
      <h1>Tournaments</h1>
      <p class="muted">Public boards. Same club across weekends rolls into the year board.</p>
      <div class="actions">
        <a class="btn" data-link href="/start">Create a tournament</a>
        <a class="btn ghost" data-link href="/year/2026">Open year board</a>
      </div>
    </section>
    ${events.length ? `<ul class="list">${events.map((ev) => `
      <li>
        <div>
          <b>${escapeHtml(ev.name)}</b>
          <span class="muted">${escapeHtml([ev.ages, ev.venue, sourceLabel(ev)].filter(Boolean).join(" · "))}</span>
        </div>
        <div class="list-actions"><a class="btn" data-link href="/t/${ev.slug}">Open board</a></div>
      </li>`).join("")}</ul>`
      : `<section class="empty">No public events. <a data-link href="/start">Create a tournament</a> after you log in.</section>`}
  `);
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
  eventRoot().innerHTML = eventChrome(null, "create", `
    <section class="page-head">
      <h1>Start a tournament</h1>
      <p>This host is the board of record. Pick one door. Teams sign up after you open it.</p>
    </section>
    <section class="choice-grid">
      <a class="choice" data-link href="/directors/new">
        <p class="muted">Native</p>
        <h3>Run it here</h3>
        <p>Name, fields with GPS or address, bracket type, guidelines, and the team packet. Auto-schedule and rain updates live on Admin.</p>
      </a>
      <a class="choice" data-link href="/directors/link-tm">
        <p class="muted">Tourney Machine</p>
        <h3>Link a public page</h3>
        <p>Paste the TM URL. Guidelines and uploads stay on this host.</p>
      </a>
      <a class="choice" data-link href="/directors/import-popup">
        <p class="muted">Keystone Clash</p>
        <h3>Import the popup</h3>
        <p>Public JSON only — teams, GameChanger links, pool records, and Sunday scores.</p>
      </a>
    </section>
  `);
}

export async function directorImportPopup() {
  if (!directorGate()) return;
  eventRoot().innerHTML = eventChrome(null, "create", `
    <section class="page-head">
      <h1>Import the Keystone Clash popup</h1>
      <p class="muted">Public GitHub Pages JSON only. Friday/Saturday pool boxes that are not on that site are not invented here.</p>
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
    <section class="page-head">
      <h1>Full stats board</h1>
      <p class="muted">${escapeHtml(board.leaders.stats_note || "Published scorebook lines. Filter by team. Qualifying line is 8 AB / 5 IP.")}</p>
      <div class="actions">
        <a class="btn ghost" data-link href="/t/${board.event.slug}/leaders">Leaders</a>
        <a class="btn ghost" data-link href="/t/${board.event.slug}/awards">Awards</a>
        ${board.event.slug === "keystone-clash-2026" ? `<a class="btn ghost" href="/popup/stats.html">Popup stats</a>` : ""}
      </div>
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
    <section class="page-head">
      <h1>Tournament info</h1>
      <p class="muted">${escapeHtml(packet?.status || board.event.status_note || "")}</p>
      ${local ? `<div class="actions">
        <a class="btn ghost" href="/popup/index.html">Popup home</a>
        <a class="btn ghost" href="/popup/rain-update.html">Rain / Sunday venue</a>
        <a class="btn ghost" href="/popup/raffle.html">50/50 raffle</a>
        <a class="btn ghost" href="/popup/draw.html">Draw verification</a>
      </div>` : ""}
    </section>
    ${rainBanner(board.event)}
    ${fieldsBlock(board.event, board.fields)}
    ${guidelinesBlock(board.event)}
    ${local ? `<section class="card infomap">
      <h2>Parking</h2>
      <img src="/popup/parking-map.png" alt="Aerial map of East End Park showing the main lot off Meadow St and the Field 2 lot.">
      <p class="muted">Both lots are marked in orange. Enter off Meadow St. Overflow parking is on East O’Hara St.</p>
    </section>` : ""}
    <section class="card facts">
      ${[
        ["Dates", packet?.dates || "September 11–13, 2026"],
        ["Where", info.where || [board.event.venue, board.event.address].filter(Boolean).join(" — ")],
        ["Format", info.format || board.event.format_label],
        ["Parking", info.parking],
        ["Rules", info.rules],
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

function packGuidelines(form) {
  const fd = new FormData(form);
  for (const k of ["require_insurance", "require_roster", "require_birth_certs", "require_waiver", "require_coach_cert"]) {
    fd.set(k, form.querySelector(`[name="${k}"]`)?.checked ? "true" : "false");
  }
  return fd;
}

export async function directorNative() {
  if (!directorGate()) return;
  eventRoot().innerHTML = eventChrome(null, "create", `
    <section class="page-head">
      <h1>Run it on this site</h1>
      <p class="muted">Name the weekend, then open the sections you need. Insurance and roster are on by default.</p>
    </section>
    <section class="card">
      <form class="form wide" id="native-form">
        <div class="form-grid two">
          <label>Tournament name <input name="name" required placeholder="Labor Day Classic"></label>
          <label>Age group <input name="ages" value="10U"></label>
        </div>
        <label>Slug (optional) <input name="slug" placeholder="labor-day-classic"></label>
        ${setupLocationFields({ format: "pool-to-bracket" })}
        ${setupGuidelinesFields({ require_insurance: true, require_roster: true })}
        <button class="btn" type="submit">Open signup</button>
        <p class="error" id="native-err" hidden></p>
      </form>
    </section>`);
  bindFieldRows(eventRoot(), 2);
  document.getElementById("native-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = packGuidelines(ev.target);
    fd.set("source", "native");
    const res = await fetch("/api/events/create", {
      method: "POST",
      headers: { ...authHeader() },
      body: fd,
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
  eventRoot().innerHTML = eventChrome(null, "create", `
    <section class="page-head">
      <h1>Link Tourney Machine</h1>
      <p class="muted">Public TM URL for the bracket. Guidelines and the team packet live here.</p>
    </section>
    <section class="card">
      <form class="form wide" id="tm-form">
        <label>Tourney Machine URL
          <input name="tm_url" type="url" required placeholder="https://www.tourneymachine.com/Public/Results/Tournament.aspx?IDTournament=">
        </label>
        <div class="form-grid two">
          <label>Name override (optional) <input name="name" placeholder="Public page title if blank"></label>
          <label>Age group <input name="ages" value="10U"></label>
        </div>
        ${setupLocationFields({ format: "imported" })}
        ${setupGuidelinesFields({ require_insurance: true, require_roster: true })}
        <button class="btn" type="submit">Link and open signup</button>
        <p class="error" id="tm-err" hidden></p>
      </form>
    </section>`);
  bindFieldRows(eventRoot(), 2);
  document.getElementById("tm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = packGuidelines(ev.target);
    fd.set("source", "tourneymachine");
    const res = await fetch("/api/events/create", {
      method: "POST",
      headers: { ...authHeader() },
      body: fd,
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
  const req = ev.required_docs || [];
  const labels = {
    insurance: "Certificate of insurance",
    roster: "Official roster",
    birth_certs: "Birth certificates / age proof",
    waiver: "Waiver / medical release",
    coach_cert: "Coach certification / background",
  };
  eventRoot().innerHTML = eventChrome(ev, "signup", `
    <section class="page-head">
      <h1>Sign a team up</h1>
      <p>${ev.signup_open
        ? `GameChanger is optional. ${req.length ? "Upload the required packet below." : "The director did not require a team packet."}`
        : "Signup is closed."}</p>
    </section>
    ${guidelinesBlock(ev)}
    ${ev.signup_open ? `<section class="card">
      <form class="form wide" id="signup-form">
        <label>Team name <input name="team_name" required placeholder="Hawks 10U"></label>
        <label>Pool (optional) <input name="pool" placeholder="A"></label>
        <label>GameChanger team URL (optional)
          <input name="gamechanger_url" type="url" placeholder="https://web.gc.com/team/…">
        </label>
        <label>Contact name <input name="contact_name" ${director ? "" : "required"}></label>
        <label>Contact email <input name="contact_email" type="email"></label>
        ${req.length ? `<fieldset class="setup-block">
          <legend>Required uploads</legend>
          <p class="muted">${escapeHtml(ev.packet_notes || "PDF or photo. The director reviews these before first pitch.")}</p>
          ${req.map((k) => `<label>${labels[k] || k} <input name="${k}" type="file" accept=".pdf,image/jpeg,image/png,image/webp" ${director ? "" : "required"}></label>`).join("")}
        </fieldset>` : ""}
        ${director ? `<label class="check"><input type="checkbox" name="as_director" checked> I am the director adding this team — collect the packet later</label>` : ""}
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
    const fd = new FormData(evnt.target);
    if (director && fd.get("as_director")) fd.set("as_director", "true");
    const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/signup", {
      method: "POST",
      headers: { ...authHeader() },
      body: fd,
    });
    if (!res.ok) {
      document.getElementById("signup-err").hidden = false;
      document.getElementById("signup-err").textContent = await res.text();
      return;
    }
    goEvent("/t/" + slug);
  });
}

async function adminPost(slug, path, body, json = true) {
  const headers = { ...authHeader() };
  if (json) headers["Content-Type"] = "application/json";
  const res = await fetch("/api/events/" + encodeURIComponent(slug) + path, {
    method: "POST",
    headers,
    body: json ? JSON.stringify(body || {}) : body,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function eventAdmin(slug) {
  if (!directorGate()) return;
  const plan = await fetch("/api/events/" + encodeURIComponent(slug) + "/plan", {
    headers: authHeader(),
  }).then((r) => {
    if (!r.ok) throw new Error("Event not found");
    return r.json();
  });
  const ev = plan.event;
  const fields = plan.fields || ev.fields || [];
  const games = plan.schedule || [];
  const teams = plan.teams || [];
  const showErr = async (err) => {
    const box = document.getElementById("admin-err");
    box.hidden = false;
    box.textContent = err.message || String(err);
  };
  const fieldOpts = fields.map((f) => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join("");
  eventRoot().innerHTML = eventChrome(ev, "admin", `
    <section class="page-head">
      <h1>Director desk</h1>
      <p class="muted">${ev.source === "tourneymachine" ? "Linked Tourney Machine" : ev.source === "popup" ? "Imported popup" : "Native host"} · ${escapeHtml(ev.format_label || ev.format || "format unset")} · signup ${ev.signup_open ? "open" : "closed"}</p>
      <p>Add diamonds and an address first. Auto-schedule fills pool games per field. Rain updates shift, move, or postpone that grid.</p>
      <div class="actions">
        <button class="btn" id="sync-now" type="button">Refresh links</button>
        <button class="btn ghost" id="toggle-signup" type="button">${ev.signup_open ? "Close signup" : "Reopen signup"}</button>
        <a class="btn ghost" data-link href="/t/${ev.slug}/signup">Add a team</a>
        <a class="btn ghost" data-link href="/directors/import">Import a grid</a>
        ${ev.source === "popup" ? `<button class="btn ghost" id="refresh-popup" type="button">Refresh from popup</button>` : ""}
      </div>
      <p class="error" id="admin-err" hidden></p>
      <p class="muted" id="admin-note"></p>
    </section>
    ${rainBanner(ev)}
    <section class="card">
      <h2>Fields and format</h2>
      <form class="form wide" id="fields-form">
        ${setupLocationFields(ev, fields.length ? fields : [{}, {}])}
        <button class="btn" type="submit">Save fields</button>
      </form>
    </section>
    <section class="card">
      <h2>Auto-schedule</h2>
      <p class="muted">Round-robin inside each pool. Teams never play two games at the same time. Open fields take the next available slot.</p>
      <form class="form wide" id="auto-form">
        <div class="form-grid two">
          <label>Days (one per line or comma) <textarea name="days" rows="2">${escapeHtml([ev.start, ev.end].filter(Boolean).join("\n") || "")}</textarea></label>
          <label>Games per team in pool <input name="games_per_team" type="number" min="1" value="2"></label>
          <label>First pitch <input name="start_time" type="time" value="08:00"></label>
          <label>No start after <input name="end_time" type="time" value="18:00"></label>
        </div>
        <label class="check"><input type="checkbox" name="consolation" checked> If you draw a bracket, include consolation games</label>
        <label class="check"><input type="checkbox" name="replace" checked> Replace unplayed pool games</label>
        <label class="check"><input type="checkbox" name="draw_bracket"> Also draw empty bracket slots now</label>
        <div class="actions">
          <button class="btn" type="submit">Build pool schedule</button>
          <button class="btn ghost" id="build-bracket" type="button">Draw bracket from standings</button>
        </div>
      </form>
    </section>
    <section class="card">
      <h2>Rain desk</h2>
      <form class="form wide" id="rain-form">
        <label>Status
          <select name="rain_status">
            ${[["clear", "Clear — play as scheduled"], ["watch", "Weather watch"], ["delay", "Rain delay"], ["postponed", "Postponed"], ["moved", "Venue / day moved"]].map(([v, l]) =>
              `<option value="${v}" ${ev.rain_status === v ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
        <label>Public note <textarea name="rain_note" rows="2" placeholder="Lightning delay. First pitch 10:00. Sunday moves to No Offseason.">${escapeHtml(ev.rain_note || "")}</textarea></label>
        <div class="form-grid two">
          <label>Delay minutes <input name="delay_minutes" type="number" min="0" placeholder="60"></label>
          <label>Only games after <input name="after_time" type="time" value="00:00"></label>
          <label>Only this date <input name="date" type="date"></label>
          <label>Close this field
            <select name="close_field">
              <option value="">Keep all diamonds open</option>
              ${fields.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join("")}
            </select>
          </label>
          <label>Move games from <input name="move_from" type="date"></label>
          <label>Move games to <input name="move_to" type="date"></label>
        </div>
        <label class="check"><input type="checkbox" name="postpone"> Mark matching games postponed</label>
        <button class="btn" type="submit">Post rain update</button>
      </form>
    </section>
    <section class="card">
      <h2>Schedule per field</h2>
      ${games.length ? table(["When", "Field", "Home", "Away", "Score", ""], games.map((g) => `<tr>
        <td><input data-edit="${g.id}" name="when_date" type="date" value="${escapeHtml(g.date || "")}" style="width:auto">
            <input data-edit="${g.id}" name="when_time" type="time" value="${escapeHtml(g.time || "")}" style="width:auto"></td>
        <td><select data-edit="${g.id}" name="field">${fieldOpts.replace(`value="${escapeHtml(g.field)}"`, `value="${escapeHtml(g.field)}" selected`)}</select></td>
        <td>${escapeHtml(g.home)}</td><td>${escapeHtml(g.away)}</td>
        <td><input data-edit="${g.id}" name="home_runs" type="number" min="0" value="${g.home_runs ?? ""}" style="width:4.2rem">
            <input data-edit="${g.id}" name="away_runs" type="number" min="0" value="${g.away_runs ?? ""}" style="width:4.2rem"></td>
        <td>
          <button class="btn ghost" type="button" data-save-game="${g.id}">Save</button>
          <button class="btn ghost" type="button" data-score-game="${g.id}">Final</button>
          <a data-link href="/t/${ev.slug}/games/${g.id}">Box</a>
          <button class="btn ghost" type="button" data-delete-game="${g.id}">Remove</button>
          ${escapeHtml(g.status)}
        </td>
      </tr>`)) : `<p class="empty">No pool games yet. Sign up teams in the same pool, then auto-schedule or add a game below.</p>`}
      <form class="form wide" id="add-game-form">
        <h3>Add one game</h3>
        <div class="form-grid two">
          <label>Home <input name="home" required placeholder="Hawks 10U"></label>
          <label>Away <input name="away" required placeholder="Passion"></label>
          <label>Date <input name="date" type="date" value="${dateInput(ev.start)}"></label>
          <label>Time <input name="time" type="time" value="09:00"></label>
          <label>Field
            <select name="field">${fieldOpts || `<option value="">Add a field first</option>`}</select>
          </label>
          <label>Pool <input name="pool" placeholder="A"></label>
        </div>
        <button class="btn" type="submit">Add game</button>
      </form>
    </section>
    <section class="card">
      <h2>Guidelines</h2>
      <form class="form wide" id="guide-form">
        ${setupGuidelinesFields(ev)}
        <button class="btn" type="submit">Save guidelines</button>
      </form>
    </section>
    <section class="card">
      <h2>Team packets</h2>
      ${table(["Team", "Packet", "Missing", "Files"], teams.map((t) => {
        const p = t.packet || {};
        return `<tr>
          <td>${escapeHtml(t.name)}</td>
          <td><span class="badge ${p.status || "incomplete"}">${escapeHtml(p.status || "incomplete")}</span></td>
          <td>${(p.missing || []).map((k) => escapeHtml(k)).join(", ") || "—"}</td>
          <td>${(p.docs || []).map((d) => `${escapeHtml(d.label)} · ${escapeHtml(d.status)}${d.url ? ` · <a href="${escapeHtml(d.url)}">file</a>` : ""} ${d.status !== "approved" ? `<button class="btn ghost" data-approve="${d.id}">Approve</button>` : ""}`).join("<br>") || "—"}</td>
        </tr>`;
      }))}
    </section>
    ${rosterBlock(teams)}
  `);
  bindFieldRows(eventRoot(), Math.max(fields.length, 2));
  const note = (msg) => { document.getElementById("admin-note").textContent = msg; };

  document.getElementById("fields-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    try {
      await fetch("/api/events/" + encodeURIComponent(slug) + "/settings", {
        method: "POST",
        headers: { ...authHeader() },
        body: new FormData(evnt.target),
      }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); });
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("auto-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const fd = new FormData(evnt.target);
    try {
      const out = await adminPost(slug, "/schedule/auto", {
        days: String(fd.get("days") || ""),
        games_per_team: Number(fd.get("games_per_team") || 2),
        start_time: fd.get("start_time") || "08:00",
        end_time: fd.get("end_time") || "18:00",
        consolation: fd.get("consolation") === "on",
        replace: fd.get("replace") === "on",
        draw_bracket: fd.get("draw_bracket") === "on",
        format: ev.format || "pool-to-bracket",
      });
      note("Scheduled " + out.games + " game(s) on " + (out.fields || []).join(", ") + (out.leftover ? " · " + out.leftover + " leftover" : ""));
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("build-bracket").addEventListener("click", async () => {
    try {
      const out = await adminPost(slug, "/bracket/build", { consolation: true, replace: true, format: ev.format || "pool-to-bracket" });
      note("Bracket drawn · " + out.games + " games from " + out.seeds + " seeds");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("rain-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const fd = new FormData(evnt.target);
    try {
      const out = await adminPost(slug, "/rain", {
        rain_status: fd.get("rain_status"),
        rain_note: fd.get("rain_note"),
        delay_minutes: Number(fd.get("delay_minutes") || 0),
        after_time: fd.get("after_time") || "00:00",
        date: fd.get("date") || "",
        close_field: fd.get("close_field") || "",
        move_from: fd.get("move_from") || "",
        move_to: fd.get("move_to") || "",
        postpone: fd.get("postpone") === "on",
      });
      note("Rain posted · shifted " + out.shifted + " · moved " + out.moved + " · postponed " + out.postponed + " · reassigned " + out.reassigned);
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("add-game-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const data = Object.fromEntries(new FormData(evnt.target));
    try {
      await adminPost(slug, "/schedule/game", data);
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  eventRoot().querySelectorAll("[data-save-game]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.saveGame;
      const inputs = eventRoot().querySelectorAll(`[data-edit="${id}"]`);
      const body = {};
      inputs.forEach((el) => {
        if (el.name === "when_date") body.date = el.value;
        if (el.name === "when_time") body.time = el.value;
        if (el.name === "field") body.field = el.value;
        if (el.name === "home_runs") body.home_runs = el.value;
        if (el.name === "away_runs") body.away_runs = el.value;
      });
      try {
        await adminPost(slug, "/schedule/" + id, body);
        note("Game updated");
      } catch (err) { showErr(err); }
    });
  });
  eventRoot().querySelectorAll("[data-score-game]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.scoreGame;
      const inputs = eventRoot().querySelectorAll(`[data-edit="${id}"]`);
      const body = { status: "final", confirm: true };
      inputs.forEach((el) => {
        if (el.name === "home_runs") body.home_runs = el.value;
        if (el.name === "away_runs") body.away_runs = el.value;
      });
      try {
        await adminPost(slug, "/schedule/" + id + "/score", body);
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
  eventRoot().querySelectorAll("[data-delete-game]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this pool game from the schedule?")) return;
      try {
        await adminPost(slug, "/schedule/" + btn.dataset.deleteGame + "/delete", {});
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
  const guide = document.getElementById("guide-form");
  if (guide) {
    guide.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      try {
        const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/settings", {
          method: "POST",
          headers: { ...authHeader() },
          body: packGuidelines(evnt.target),
        });
        if (!res.ok) throw new Error(await res.text());
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  }
  eventRoot().querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await adminPost(slug, "/docs/" + btn.dataset.approve + "/review", { status: "approved" });
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
  document.getElementById("sync-now").addEventListener("click", async (btnEv) => {
    const btn = btnEv.currentTarget;
    btn.disabled = true;
    try {
      const out = await adminPost(slug, "/sync", {});
      note("Refresh finished · " + (out.results || []).map((r) => (r.team || r.kind) + " " + (r.ok ? "ok" : "miss")).join(", "));
      eventAdmin(slug);
    } catch (err) { showErr(err); }
    btn.disabled = false;
  });
  document.getElementById("toggle-signup").addEventListener("click", async () => {
    try {
      await adminPost(slug, "/settings", { signup_open: !ev.signup_open });
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  const refresh = document.getElementById("refresh-popup");
  if (refresh) {
    refresh.addEventListener("click", async () => {
      refresh.disabled = true;
      try {
        const res = await fetch("/api/events/import-popup", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ url: ev.source_url || "https://thedr21.github.io/KeystoneClash/" }),
        });
        if (!res.ok) throw new Error(await res.text());
        const out = await res.json();
        note("Popup refresh · " + out.teams + " teams · " + out.games + " Sunday games");
      } catch (err) { showErr(err); }
      refresh.disabled = false;
    });
  }
}

export async function directorImport() {
  const u = eventPb.authStore.record;
  if (!u || (u.role !== "region_admin" && u.role !== "event_td")) {
    eventRoot().innerHTML = eventChrome(null, "", `<section class="card"><p>Director login required.</p><p><a class="btn" data-link href="/login">Log in</a></p></section>`);
    return;
  }
  eventRoot().innerHTML = eventChrome(null, "create", `
    <section class="page-head">
      <h1>You already have a schedule</h1>
      <p class="muted">Bring the grid from Excel, Tourney Machine, or a legal pad.</p>
    </section>
    <section class="card">
      <form class="form" id="import-form" style="max-width:none">
        <label>Event slug <input name="event_slug" value="clipboard-open" required></label>
        <label>Event name <input name="event_name" value="Clipboard Open"></label>
        <label>CSV (header required)
          <textarea name="csv" rows="10">date,time,home,away,pool,field,home_runs,away_runs,status
2026-09-20,09:00,Northside,West End,A,Harbor 1,5,3,final
2026-09-20,09:00,Eastside,South Ridge,B,Harbor 2,,,scheduled</textarea>
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
