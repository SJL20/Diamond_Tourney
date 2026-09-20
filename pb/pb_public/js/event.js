import { canAdminEvent, flashSaved, isDirector as recordIsDirector, isSiteAdmin, pageShell } from "./chrome.js";
import {
  formatDateDisplay,
  formatHoursRange,
  formatTimeDisplay,
  formatWhen,
  formatWeekendDates as formatWeekendDatesDisplay,
  stampDataTh,
} from "./display.js";

const eventRoot = () => document.getElementById("app");
const eventPb = new PocketBase(location.origin);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function table(headers, rows, extras = {}) {
  const cls = extras.className != null ? extras.className : "card-table";
  const wrap = ["table-wrap", extras.wrapClass].filter(Boolean).join(" ");
  const stamped = (rows || []).map((r) => stampDataTh(r, headers));
  return `<div class="${wrap}"><table${cls ? ` class="${escapeHtml(cls)}"` : ""}><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${stamped.join("")}</tbody></table></div>`;
}

function goEvent(href) {
  history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

let currentEvent = null;

function isDirector(ev) {
  return canAdminEvent(eventPb.authStore.record, ev || currentEvent);
}

function isTeamScorer() {
  const rec = eventPb.authStore.record;
  return !!(rec && (rec.role === "team_coach" || rec.role === "team_manager"));
}

function formatWeekendDates(start, end) {
  return formatWeekendDatesDisplay(start, end);
}

function directorBoardActions(slug) {
  return `<div class="actions board-director-actions">
    <a class="btn" data-link href="/directors/import?into=${encodeURIComponent(slug)}">Import a schedule</a>
    <a class="btn ghost" data-link href="/t/${escapeHtml(slug)}/admin#admin-scheduler">Build pool play</a>
    <a class="btn ghost" data-link href="/t/${escapeHtml(slug)}/admin#admin-scheduler">Draw bracket from standings</a>
  </div>`;
}

function tabEmpty(ev, slug, kind) {
  const admin = canAdminEvent(eventPb.authStore.record, ev);
  if (admin) {
    const lead = {
      schedule: "No games on the weekend board yet.",
      standings: "Standings appear after scores are entered.",
      bracket: "No bracket games yet. Publish a blank bracket for the fence, import a CSV, or draw from standings after a pool result.",
      stats: "No published box lines yet.",
      games: "No pool games on the board yet.",
    }[kind] || "Nothing posted yet.";
    return `<div class="empty"><p>${lead}</p>${directorBoardActions(slug)}</div>`;
  }
  if (isTeamScorer() && (kind === "schedule" || kind === "games")) {
    return `<p class="empty">No games to score yet. Check back when the director posts the schedule.</p>`;
  }
  const back = {
    schedule: "The schedule isn't posted yet. Check back closer to the weekend.",
    standings: "Standings appear once scores are entered. Check back after pool play starts.",
    bracket: "The bracket isn't posted yet. Check back after pool play.",
    stats: "Stats appear after coaches confirm box scores. Check back during the weekend.",
    games: "The schedule isn't posted yet. Check back closer to the weekend.",
  };
  return `<p class="empty">${back[kind] || "Check back closer to the weekend."}</p>`;
}

function authHeader() {
  return eventPb.authStore.token ? { Authorization: eventPb.authStore.token } : {};
}

// Packet files (insurance, rosters, birth certificates) are protected, so a
// plain /api/files link 403s. Mint a short-lived file token for this director.
async function fileToken() {
  if (!eventPb.authStore.token) return "";
  try {
    return await eventPb.files.getToken();
  } catch (err) {
    return "";
  }
}

function withFileToken(url, token) {
  if (!url) return "";
  if (!token) return url;
  return url + (url.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
}

function eventChrome(event, page, body, opts = {}) {
  currentEvent = event || null;
  const site = event ? "" : (page === "create" ? "create" : page);
  return pageShell({ pb: eventPb, site, event, page, body, slim: !!opts.slim });
}

function rememberEvent(event) {
  currentEvent = event || null;
  return event;
}

function dateInput(v) {
  if (!v) return "";
  return String(v).slice(0, 10);
}

function datesBetween(start, end) {
  const out = [];
  const first = dateInput(start);
  if (!first) return out;
  const last = dateInput(end) || first;
  let cur = first;
  for (let i = 0; i < 8; i++) {
    out.push(cur);
    if (cur >= last) break;
    const d = new Date(cur + "T12:00:00");
    d.setDate(d.getDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return out;
}

function fieldAvailDays(f = {}, i = 0, dates = [], globalStart = "08:00", globalEnd = "18:00") {
  if (!dates.length) {
    return `<p class="muted">Set first and last day above to unlock per-date hours for this diamond.</p>`;
  }
  const byDate = {};
  for (const row of f.availability || f.windows || []) {
    if (row?.date) byDate[String(row.date).slice(0, 10)] = row;
  }
  return dates.map((d, di) => {
    const row = byDate[d] || {};
    const on = row.available !== false;
    return `<div class="avail-day">
      <label class="check"><input type="checkbox" name="field_day_${i}_${di}_on" ${on ? "checked" : ""}> ${escapeHtml(formatDateDisplay(d) || d)}</label>
      <input type="hidden" name="field_day_${i}_${di}_date" value="${escapeHtml(d)}">
      <label>Open <input type="time" name="field_day_${i}_${di}_start" value="${escapeHtml(row.start || globalStart)}"></label>
      <label>Close <input type="time" name="field_day_${i}_${di}_end" value="${escapeHtml(row.end || globalEnd)}"></label>
    </div>`;
  }).join("");
}

function fieldRow(f = {}, i = 0, dates = [], globalStart = "08:00", globalEnd = "18:00") {
  return `<fieldset class="field-row">
    <legend>Field ${i + 1}</legend>
    <button class="btn ghost field-remove" type="button" data-remove-field>Remove field</button>
    <input type="hidden" name="field_id_${i}" value="${escapeHtml(f.id || "")}">
    <div class="form-grid two">
      <label>Name <input name="field_name_${i}" value="${escapeHtml(f.name || "")}" placeholder="East End 1"></label>
      <label>Surface <input name="field_surface_${i}" value="${escapeHtml(f.surface || "")}" placeholder="grass"></label>
    </div>
    <label>Field address <input name="field_address_${i}" value="${escapeHtml(f.address || "")}" placeholder="Same as the park if blank"></label>
    <p class="muted">The map pin is geocoded from this address, or from the park, when you save.</p>
    <label class="check"><input type="checkbox" name="field_lights_${i}" ${f.lights ? "checked" : ""}> Lights</label>
    <p class="muted">This diamond’s hours. Uncheck a day if it is dark or rented out. Times narrower than the global window are allowed; times outside it are not used.</p>
    <div class="field-avail">${fieldAvailDays(f, i, dates, globalStart, globalEnd)}</div>
  </fieldset>`;
}

function weekendFromForm(root, ev = {}) {
  const start = root.querySelector("[name=start]")?.value || dateInput(ev.start);
  const end = root.querySelector("[name=end]")?.value || dateInput(ev.end);
  return {
    dates: datesBetween(start, end),
    hoursStart: root.querySelector("[name=hours_start]")?.value || ev.hours_start || "08:00",
    hoursEnd: root.querySelector("[name=hours_end]")?.value || ev.hours_end || "18:00",
  };
}

function rewriteFieldInputName(name, next) {
  const raw = String(name || "");
  const day = raw.match(/^field_day_(\d+)_(\d+)_(.+)$/);
  if (day) return "field_day_" + next + "_" + day[2] + "_" + day[3];
  const row = raw.match(/^field_([a-z_]+)_(\d+)$/);
  if (row) return "field_" + row[1] + "_" + next;
  return raw;
}

function renumberFieldRows(root) {
  [...root.querySelectorAll(".field-row")].forEach((fs, i) => {
    const legend = fs.querySelector("legend");
    if (legend) legend.textContent = "Field " + (i + 1);
    fs.querySelectorAll("[name]").forEach((el) => {
      el.setAttribute("name", rewriteFieldInputName(el.getAttribute("name"), i));
    });
  });
}

function bindFieldRows(root, startCount, ev = {}) {
  const add = root.querySelector("#add-field");
  const syncRemoves = () => {
    const rows = root.querySelectorAll(".field-row");
    rows.forEach((fs) => {
      const btn = fs.querySelector("[data-remove-field]");
      if (btn) btn.hidden = rows.length <= 1;
    });
  };
  const paintDays = () => {
    const { dates, hoursStart, hoursEnd } = weekendFromForm(root, ev);
    root.querySelectorAll(".field-row").forEach((fs) => {
      const box = fs.querySelector(".field-avail");
      const idx = [...root.querySelectorAll(".field-row")].indexOf(fs);
      if (!box) return;
      const saved = {};
      box.querySelectorAll("input[type=hidden][name$='_date']").forEach((h) => {
        const prefix = h.name.replace(/_date$/, "");
        saved[h.value] = {
          date: h.value,
          available: !!fs.querySelector(`[name="${prefix}_on"]`)?.checked,
          start: fs.querySelector(`[name="${prefix}_start"]`)?.value,
          end: fs.querySelector(`[name="${prefix}_end"]`)?.value,
        };
      });
      box.innerHTML = fieldAvailDays({ availability: Object.values(saved) }, idx, dates, hoursStart, hoursEnd);
    });
  };
  if (add) {
    add.addEventListener("click", () => {
      const box = root.querySelector("#field-rows");
      const { dates, hoursStart, hoursEnd } = weekendFromForm(root, ev);
      const next = root.querySelectorAll(".field-row").length;
      box.insertAdjacentHTML("beforeend", fieldRow({}, next, dates, hoursStart, hoursEnd));
      renumberFieldRows(root);
      syncRemoves();
    });
  }
  root.addEventListener("click", (evnt) => {
    const btn = evnt.target.closest("[data-remove-field]");
    if (!btn || !root.contains(btn)) return;
    const rows = root.querySelectorAll(".field-row");
    if (rows.length <= 1) return;
    btn.closest(".field-row")?.remove();
    renumberFieldRows(root);
    syncRemoves();
  });
  ["start", "end", "hours_start", "hours_end"].forEach((name) => {
    root.querySelector(`[name=${name}]`)?.addEventListener("change", paintDays);
  });
  syncRemoves();
}

function setupFormatFields(ev = {}) {
  const fmt = !ev.format || ev.format === "imported" ? "pool-to-bracket" : ev.format;
  const flights = ev.bracket_flights || "none";
  return `
    <label>Format
      <select name="format">
        <option value="pool-to-bracket" ${fmt === "pool-to-bracket" ? "selected" : ""}>Pool play, then single-elim bracket</option>
        <option value="pool-double-elim" ${fmt === "pool-double-elim" ? "selected" : ""}>Pool play, then double-elim bracket</option>
        <option value="round-robin" ${fmt === "round-robin" ? "selected" : ""}>Round robin</option>
        <option value="pool-only" ${fmt === "pool-only" ? "selected" : ""}>Pool play only</option>
        <option value="single-elim" ${fmt === "single-elim" ? "selected" : ""}>Single elimination</option>
        <option value="double-elim" ${fmt === "double-elim" ? "selected" : ""}>Double elimination</option>
      </select>
    </label>
    <label>Bracket levels
      <select name="bracket_flights">
        <option value="none" ${flights === "none" || !flights ? "selected" : ""}>One bracket (overall seeds)</option>
        <option value="gold-silver" ${flights === "gold-silver" ? "selected" : ""}>Gold / Silver (split by overall ranking)</option>
        <option value="platinum-gold-silver" ${flights === "platinum-gold-silver" ? "selected" : ""}>Platinum / Gold / Silver (split by overall ranking)</option>
      </select>
    </label>
    <p class="muted">Pool games are scheduled per field. Round robin plays every team in a pool. Gold/Silver and Platinum/Gold/Silver cut the overall seed list from the top. Double-elim adds a losers bracket. Changing this format or drawing a bracket does not rewrite an imported pool grid. Use the custom bracket builder on Scheduler to place teams by hand.</p>
  `;
}

function setupVenueFields(ev = {}, fields = []) {
  const rows = fields.length ? fields : [{}];
  const hoursStart = ev.hours_start || "08:00";
  const hoursEnd = ev.hours_end || "18:00";
  const dates = datesBetween(ev.start, ev.end);
  return `
    <label>Complex / park name <input name="venue" value="${escapeHtml(ev.venue || "")}" placeholder="East End Park"></label>
    <label>Street address <input name="address" value="${escapeHtml(ev.address || "")}" placeholder="51 Meadow St, McDonald, PA 15057"></label>
    <p class="muted">The map pin is geocoded from the street address when you save. You never type latitude or longitude.</p>
    <div class="form-grid two">
      <label>First day <input name="start" type="date" value="${dateInput(ev.start)}"></label>
      <label>Last day <input name="end" type="date" value="${dateInput(ev.end)}"></label>
    </div>
    <div class="hours-global">
      <p class="muted">Park hours. Applies to every diamond unless a diamond sets its own. A field that is closed Saturday will not get Saturday games.</p>
      <div class="form-grid two">
        <label>First pitch <input name="hours_start" type="time" value="${escapeHtml(hoursStart)}"></label>
        <label>No start after / last out <input name="hours_end" type="time" value="${escapeHtml(hoursEnd)}"></label>
      </div>
    </div>
    <p class="muted">Start with one diamond. Add as many as you need. You must keep at least one.</p>
    <div id="field-rows">${rows.map((f, i) => fieldRow(f, i, dates, hoursStart, hoursEnd)).join("")}</div>
    <button class="btn ghost" type="button" id="add-field">Add another field</button>
  `;
}

function setupLocationFields(ev = {}, fields = [], photos = []) {
  return `
    <details class="setup-block" open>
      <summary>Venue, address, and fields</summary>
      ${setupVenueFields(ev, fields)}
      ${ev.slug ? venuePhotoDesk(ev.slug, photos) : `<div class="venue-photo-desk" id="create-photo-desk">
        <h3>Field map and parking photos</h3>
        <p class="muted">Fields and facilities only, please — no photos of players. After you open signup, this same page lets you upload a complex map, entrance, or parking photo (JPG, PNG, WebP, HEIC, or PDF). GPS / EXIF is stripped.</p>
      </div>`}
    </details>
    <details class="setup-block" open>
      <summary>Bracket type and pool play</summary>
      ${setupFormatFields(ev)}
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

function photoGallery(photos) {
  const list = (photos || []).filter((p) => p.public && p.url);
  if (!list.length) return "";
  return `<section class="card venue-photos">
    <h2>Fields and parking</h2>
    <div class="photo-grid">${list.map((p) => `<figure>
      <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || p.kind || "Field")}">
      ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""}
    </figure>`).join("")}</div>
  </section>`;
}

function fieldsBlock(ev, fields, opts = {}) {
  const list = fields || ev.fields || [];
  if (!list.length && !ev.address && !ev.venue) return "";
  const hours = (ev.hours_start || ev.hours_end)
    ? formatHoursRange(ev.hours_start || "08:00", ev.hours_end || "18:00")
    : "";
  const body = `
    ${[
      ["Park", ev.venue],
      ["Address", ev.address],
    ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}${ev.map_url && k === "Address" ? ` · <a href="${escapeHtml(ev.map_url)}" target="_blank" rel="noopener">Map</a>` : ""}</dd></div>`).join("")}
    ${hours ? `<div><dt>Park hours</dt><dd>${escapeHtml(hours)}</dd></div>` : ""}
    ${list.length ? `<ul class="field-list">${list.map((f) => {
      const fieldHours = (f.windows || []).map((w) =>
        w.available === false
          ? `${formatDateDisplay(w.date) || w.date} closed`
          : (w.inherited ? "" : `${formatDateDisplay(w.date) || w.date} ${formatHoursRange(w.start, w.end)}`)
      ).filter(Boolean).join(" · ");
      return `<li>
      <b>${escapeHtml(f.name)}</b>
      <span class="muted">${escapeHtml([f.surface, f.lights ? "lights" : "", f.status !== "open" ? f.status : "", fieldHours].filter(Boolean).join(" · "))}</span>
      ${f.map_url ? `<a href="${escapeHtml(f.map_url)}" target="_blank" rel="noopener">Map</a>` : ""}
    </li>`;
    }).join("")}</ul>` : ""}`;
  if (opts.demote) {
    return `<details class="card facts fields-block demoted">
      <summary>Park hours and fields</summary>
      ${body}
    </details>`;
  }
  return `<section class="card facts fields-block">
    <h2>Fields</h2>
    ${body}
  </section>`;
}

function scoreText(g) {
  if (g.score_source === "conflict" || g.book_state === "conflict") return "—";
  if (g.home_runs == null && g.away_runs == null) return "—";
  return `${g.home_runs ?? "—"}–${g.away_runs ?? "—"}`;
}

function bookMark(g) {
  if (g.score_source === "verified" || g.book_state === "verified") {
    return ` <span class="badge w">verified</span>`;
  }
  if (g.score_source === "one_book") return ` <span class="badge t">one book</span>`;
  if (g.score_source === "conflict" || g.book_state === "conflict") {
    return ` <span class="badge l">held</span>`;
  }
  return "";
}

function scoreCell(g) {
  return scoreText(g) + bookMark(g);
}

function teamHref(eventSlug, teamSlug) {
  if (!eventSlug || !teamSlug) return "";
  return `/t/${eventSlug}/team/${teamSlug}`;
}

function teamLink(eventSlug, teamSlug, name, extra = "") {
  const label = escapeHtml(name || "TBD");
  if (!eventSlug || !teamSlug || !name || name === "TBD") return label + extra;
  return `<a data-link class="team-link" href="${escapeHtml(teamHref(eventSlug, teamSlug))}">${label}</a>${extra}`;
}

function slugForName(roster, name) {
  const hit = (roster || []).find((t) => t && t.name === name);
  return hit ? (hit.slug || "") : "";
}

function teamNameLink(eventSlug, roster, name) {
  return teamLink(eventSlug, slugForName(roster, name), name);
}

function hasPitchIpCap(ev, leaders) {
  if (leaders && leaders.has_pitch_ip_cap === true) return true;
  if (leaders && leaders.has_pitch_ip_cap === false) return false;
  const mode = (ev && ev.pitch_limit_mode) || "none";
  return (mode === "ip" || mode === "both") && Number(ev && ev.pitch_limit_ip) > 0;
}

function qualifyNote(leaders) {
  return (leaders && leaders.stats_note) || "Qualifying minimums rise with games played, up to 8 at-bats and 3.0 innings. Lines come from each team’s published scorebook.";
}

function gameNo(g) {
  const n = Number(g?.game_number || 0);
  return n > 0 ? "Game " + n : "";
}

function gameNoCell(g) {
  const label = gameNo(g);
  return label ? `<span class="game-no">${escapeHtml(label)}</span>` : "—";
}

function whenLine(g) {
  return formatWhen(g?.date, g?.time) || "TBD";
}

function gameHref(slug, g) {
  if (g?.kind === "bracket") return `/t/${escapeHtml(slug)}/bracket`;
  if (g?.id) return `/t/${escapeHtml(slug)}/games/${g.id}`;
  return `/t/${escapeHtml(slug)}/overall`;
}

function gameKindLabel(g) {
  if (g?.kind === "bracket") return ROUND_META[g.round]?.label || g.round || "Bracket";
  if (g?.round) return g.round;
  if (g?.pool) return "Pool " + g.pool;
  return "Pool";
}

function gameCard(g, slug, opts = {}) {
  const kind = opts.kind || gameKindLabel(g);
  const href = opts.href || gameHref(slug, g);
  const delayed = g.delayed_from
    ? ` <span class="muted">(was ${escapeHtml(formatTimeDisplay(g.delayed_from) || g.delayed_from)})</span>`
    : "";
  const openLabel = opts.openLabel || (g.kind === "bracket" ? "Bracket" : (g.can_score ? "Post score" : "Open"));
  return `<article class="game-card${g.status === "live" ? " live" : ""}">
    <p class="game-card-kicker">${escapeHtml([gameNo(g), kind].filter(Boolean).join(" · "))}</p>
    <p class="game-card-match">${teamLink(slug, g.home_slug, g.home || "TBD")} vs ${teamLink(slug, g.away_slug, g.away || "TBD")}</p>
    <p class="game-card-when">${escapeHtml(whenLine(g))}${g.field ? ` · ${escapeHtml(g.field)}` : ""}${delayed}</p>
    <p class="game-card-score">${scoreCell(g)} · ${escapeHtml(g.status || "")}${g.has_box ? " · box" : ""}</p>
    ${g.id || href ? `<p class="actions"><a data-link href="${href}">${escapeHtml(openLabel)}</a></p>` : ""}
  </article>`;
}

function schedulePair(headers, rows, cards) {
  return `${table(headers, rows, { className: "", wrapClass: "desktop-table" })}
    <div class="game-list">${(cards || []).join("")}</div>`;
}

function fieldSortParts(name) {
  const text = String(name || "");
  const m = text.match(/(\d+)/);
  return { n: m ? Number(m[1]) : 1000000, text: text.toLowerCase() };
}

function compareGames(a, b) {
  const dateA = String(a.date || "9999-99-99");
  const dateB = String(b.date || "9999-99-99");
  if (dateA !== dateB) return dateA < dateB ? -1 : 1;
  const timeA = String(a.time || "99:99");
  const timeB = String(b.time || "99:99");
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  const ga = Number(a.game_number || 0);
  const gb = Number(b.game_number || 0);
  if (ga && gb && ga !== gb) return ga - gb;
  if (ga && !gb) return -1;
  if (!ga && gb) return 1;
  const fa = fieldSortParts(a.field);
  const fb = fieldSortParts(b.field);
  if (fa.n !== fb.n) return fa.n - fb.n;
  if (fa.text !== fb.text) return fa.text.localeCompare(fb.text);
  return String(a.home || "").localeCompare(String(b.home || ""));
}

function compareFieldNames(a, b) {
  const fa = fieldSortParts(a);
  const fb = fieldSortParts(b);
  if (fa.n !== fb.n) return fa.n - fb.n;
  return fa.text.localeCompare(fb.text);
}

function realPoolGames(games) {
  return (games || []).filter((g) => g.home && g.away && g.id);
}

function scheduleByField(games, slug) {
  const list = realPoolGames(games);
  if (!list.length) return tabEmpty(currentEvent, slug, "games");
  const groups = {};
  for (const g of list) {
    const key = g.field || "Unassigned";
    if (!groups[key]) groups[key] = [];
    groups[key].push(g);
  }
  return Object.keys(groups).sort(compareFieldNames).map((name) => {
    const rows = groups[name].slice().sort(compareGames);
    return `
    <div class="sched-field">
      <h3>${escapeHtml(name)}</h3>
      ${schedulePair(["Game", "When", "Pool", "Home", "Away", "Score", ""], rows.map((g) => `<tr>
        <td>${gameNoCell(g)}</td>
        <td>${escapeHtml(whenLine(g))}${g.delayed_from ? ` <span class="muted">(was ${escapeHtml(formatTimeDisplay(g.delayed_from) || g.delayed_from)})</span>` : ""}</td>
        <td>${escapeHtml(g.pool || "")}</td>
        <td>${teamLink(slug, g.home_slug, g.home)}</td><td>${teamLink(slug, g.away_slug, g.away)}</td>
        <td>${scoreCell(g)}</td>
        <td>${escapeHtml(g.status)}${g.has_box ? " · box" : ""}
          ${g.id ? ` · <a data-link href="/t/${escapeHtml(slug)}/games/${g.id}">${g.can_score ? "Post score" : "Open"}</a>` : ""}
        </td>
      </tr>`), rows.map((g) => gameCard(g, slug)))}
    </div>`;
  }).join("");
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
        ${sel("pitch_limit_mode", ev.pitch_limit_mode || "none", [
          ["ip", "Innings pitched"],
          ["pitch_count", "Pitch count"],
          ["both", "IP and pitch count"],
          ["none", "No posted weekend cap"],
        ])}
      </label>
      <div class="form-grid two">
        <label>Weekend IP cap <input name="pitch_limit_ip" type="number" min="0" step="0.1" value="${ev.pitch_limit_mode && ev.pitch_limit_mode !== "none" ? (ev.pitch_limit_ip ?? 6) : (ev.pitch_limit_ip || "")}"></label>
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
    ${setupTiebreakFields(ev)}
  `;
}

function setupCoOwners(ev = {}) {
  if (!ev.can_admin) return "";
  const rows = ev.co_owners || [];
  const manage = ev.can_manage_owners;
  const list = rows.length
    ? `<ul class="co-owner-list">${rows.map((row) => `
        <li>
          <div>
            <b>${escapeHtml(row.email)}</b>
            <span class="muted">${row.has_account ? "Has a login" : "No account yet — they sign in with this email"}</span>
          </div>
          ${manage ? `<button class="btn ghost" type="button" data-remove-co-owner="${escapeHtml(row.email)}">Remove</button>` : ""}
        </li>`).join("")}</ul>`
    : `<p class="muted">No co-owners yet.</p>`;
  return `
    <details class="setup-block" open>
      <summary>Co-owners</summary>
      <p class="muted">Add another director by email. They get the Admin tab for this weekend. Public pages never show these addresses.</p>
      ${list}
      ${manage ? `<form class="form wide" id="co-owner-form">
        <label>Co-owner email <input name="email" type="email" required placeholder="coach@example.com" autocomplete="off"></label>
        <button class="btn" type="submit">Add co-owner</button>
      </form>` : `<p class="muted">Ask the owner to add or remove co-owners.</p>`}
    </details>`;
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
      ["Ages", ev.ages],
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
      ["Pool tiebreak", ev.tiebreak && ev.tiebreak.label],
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

function standingsBlock(standings, eventSlug) {
  return (standings || []).map((pool) => `
    <div class="card">
      <h2>${pool.name === "All teams" ? "Pool standings" : "Pool " + escapeHtml(pool.name)}</h2>
      ${pool.note ? `<p class="muted">${escapeHtml(pool.note)}</p>` : ""}
      ${table(["#", "Team", "W", "L", "T", "RS", "RA", "Diff"], pool.teams.map((t) => `<tr>
        <td>${t.seed != null ? t.seed : "—"}</td>
        <td>${teamLink(eventSlug, t.slug, t.name)}${t.host ? ` <span class="badge host">host</span>` : ""}</td>
        <td>${t.w}</td><td>${t.l}</td><td>${t.t || 0}</td>
        <td>${t.rs}</td><td>${t.ra}</td><td>${t.diff > 0 ? "+" : ""}${t.diff}</td>
      </tr>`))}
      ${(pool.teams || []).some((t) => t.seed_reason) ? `<ul class="seed-why">${pool.teams.filter((t) => t.seed_reason).map((t) =>
        `<li><b>Seed ${t.seed} ${teamLink(eventSlug, t.slug, t.name)}</b> — ${escapeHtml(t.seed_reason)}</li>`).join("")}</ul>` : ""}
      <p class="muted">Tiebreak: ${escapeHtml(pool.tiebreak_label || "record (tie = half), then head-to-head, then fewest runs allowed, then run differential, then most runs scored")}.</p>
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
  L1: { label: "Losers round 1", order: 1 },
  L2: { label: "Losers round 2", order: 2 },
  L3: { label: "Losers round 3", order: 3 },
  LF: { label: "Losers final", order: 4 },
};

function flightTitle(name) {
  const labels = { gold: "Gold", silver: "Silver", platinum: "Platinum" };
  return labels[name] || name || "";
}

function sourceLabel(ev) {
  if (!ev) return "Hosted";
  if (ev.source === "popup") return "Keystone Clash popup";
  if (ev.source === "tourneymachine") return "Tourney Machine";
  return "Hosted";
}

function gameSide(g) {
  if (g.bracket_kind === "losers" || g.side === "losers") return "losers";
  if (g.side === "consolation" || g.bracket_kind === "consolation") return "consolation";
  if (g.side === "winners") return "championship";
  if (g.side) return g.side;
  const r = String(g.round || "").toUpperCase();
  if (r === "LF" || /^L(\d|QF|SF)/.test(r)) return "losers";
  return /^(C|3RD|5TH|CONS)/.test(r) ? "consolation" : "championship";
}

function teamOptions(roster, selected, blank) {
  const first = `<option value="">${escapeHtml(blank == null ? "TBD" : blank)}</option>`;
  return `${first}${(roster || []).map((t) =>
    `<option value="${escapeHtml(t.id)}" ${t.id === selected ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}`;
}

function teamSelect(roster, name, selected, opts) {
  const required = !!(opts && opts.required);
  const disabled = !!(opts && opts.disabled);
  const blank = required ? "Select a registered team" : "TBD";
  return `<select name="${escapeHtml(name)}"${required ? " required" : ""}${disabled ? " disabled" : ""}>${teamOptions(roster, selected, blank)}</select>`;
}

function poolChoices(teams) {
  return [...new Set((teams || []).map((t) => t.pool).filter(Boolean))].sort();
}

function poolSelect(teams, selected) {
  const pools = poolChoices(teams);
  return `<select name="pool"><option value="">—</option>${pools.map((p) =>
    `<option value="${escapeHtml(p)}" ${p === selected ? "selected" : ""}>${escapeHtml(p)}</option>`).join("")}</select>`;
}

function flightChoices(selected) {
  const known = ["", "gold", "silver", "platinum"];
  if (selected && !known.includes(selected)) known.push(selected);
  return known;
}

function flightSelect(selected, disabled) {
  const labels = { "": "One tree", gold: "Gold", silver: "Silver", platinum: "Platinum" };
  return `<select name="flight"${disabled ? " disabled" : ""}>${flightChoices(selected).map((v) =>
    `<option value="${escapeHtml(v)}" ${v === (selected || "") ? "selected" : ""}>${escapeHtml(labels[v] || v)}</option>`).join("")}</select>`;
}

function roundChoices(selected) {
  const known = Object.keys(ROUND_META);
  if (selected && !known.includes(selected)) known.unshift(selected);
  return known;
}

function roundSelect(selected, disabled) {
  return `<select name="round"${disabled ? " disabled" : ""}>${roundChoices(selected).map((v) =>
    `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml((ROUND_META[v] && ROUND_META[v].label) || v)}</option>`).join("")}</select>`;
}

function optionList(values, selected) {
  const list = [...values];
  if (selected && !list.includes(selected)) list.unshift(selected);
  return list.map((v) =>
    `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(v)}</option>`).join("");
}

function clockMinutes(raw) {
  const s = String(raw || "").trim();
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const ap = ampm[3].toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + Number(ampm[2]);
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!hm) return 0;
  return Number(hm[1]) * 60 + Number(hm[2]);
}

function addClock(hhmm, mins) {
  const total = ((clockMinutes(hhmm) + Number(mins || 0)) % 1440 + 1440) % 1440;
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function uniqueStrings(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const v = String(item || "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function fieldWindowOn(field, date, ev) {
  const gs = ev.hours_start || "08:00";
  const ge = ev.hours_end || "18:00";
  const win = (field.windows || []).find((w) => w.date === date);
  if (win) return win;
  const hit = (field.availability || []).find((w) => w.date === date);
  if (hit) return { date, available: hit.available !== false, start: hit.start || gs, end: hit.end || ge };
  return { date, available: true, start: gs, end: ge };
}

function slotOpen(board, fieldName, date, time) {
  const ev = board.event || {};
  const gameMin = Number(ev.game_length_minutes) || 90;
  const field = (board.fields || []).find((f) => f.name === fieldName);
  if (!field) return true;
  const win = fieldWindowOn(field, date, ev);
  if (!win.available) return false;
  return clockMinutes(time) >= clockMinutes(win.start || ev.hours_start || "08:00")
    && clockMinutes(time) + gameMin <= clockMinutes(win.end || ev.hours_end || "18:00");
}

function buildDeskPlan(board) {
  const ev = board.event || {};
  const games = [...(board.schedule || []), ...(board.bracket || [])];
  const fields = uniqueStrings([
    ...(board.fields || []).map((f) => f.name),
    ...games.map((g) => g.field),
  ]);
  if (!fields.length) fields.push("Field 1");
  const times = uniqueStrings(games.map((g) => g.time));
  const span = (Number(ev.game_length_minutes) || 90) + 15;
  let t = ev.hours_start || "08:00";
  for (let i = 0; i < 16; i++) {
    if (clockMinutes(t) > clockMinutes(ev.hours_end || "20:00")) break;
    if (!times.includes(t)) times.push(t);
    t = addClock(t, span);
  }
  times.sort((a, b) => clockMinutes(a) - clockMinutes(b));
  const dates = uniqueStrings([ev.start, ev.end, ...datesBetween(ev.start, ev.end), ...games.map((g) => g.date)]);
  const booked = new Set();
  for (const g of games) {
    if (g.date && g.time && g.field) booked.add(`${g.date}|${g.time}|${g.field}`);
  }
  const datePref = ev.end || ev.start || dates[0] || "";
  const defaults = new Map();
  for (const g of board.bracket || []) {
    if (g.field && g.time && g.date) continue;
    const day = g.date || datePref;
    let found = null;
    for (const tryDay of uniqueStrings([day, ...dates])) {
      for (const time of times) {
        for (const field of fields) {
          const key = `${tryDay}|${time}|${field}`;
          if (booked.has(key)) continue;
          if (!slotOpen(board, field, tryDay, time)) continue;
          found = { field, time, date: tryDay };
          booked.add(key);
          break;
        }
        if (found) break;
      }
      if (found) break;
    }
    defaults.set(g.id, found || { field: fields[0] || "", time: times[0] || "", date: day });
  }
  return { fields, times, dates, defaults, board };
}

function slotIsSet(g) {
  return !!(g.field && g.time);
}

function matchCard(g, roster = [], plan = null) {
  const tie = !!(g.tie || (g.status === "final" && g.home_runs === g.away_runs && g.home && g.away));
  const homeWin = !tie && g.status === "final" && g.winner && g.winner === g.home;
  const awayWin = !tie && g.status === "final" && g.winner && g.winner === g.away;
  const fieldLabel = g.field || "—";
  const timeLabel = formatTimeDisplay(g.time) || g.time || "—";
  const meta = [gameNo(g), g.game_id, tie ? "Tie" : g.status === "final" ? "Final" : "Scheduled"].filter(Boolean);
  const def = plan?.defaults.get(g.id) || {};
  const chosenField = g.field || def.field || "";
  const chosenTime = g.time || def.time || "";
  const chosenDate = g.date || def.date || "";
  const set = slotIsSet(g);
  // Never start open. Field, time, sides, and the final sit behind one toggle
  // so a four-game quarterfinal column stays a tree, not a stack of forms.
  const desk = isDirector() && g.id ? `
    <details class="bk-desk-box">
      <summary>Edit game</summary>
      <form class="bk-desk" data-bk-desk="${escapeHtml(g.id)}">
        <label>Field
          <select name="field">${optionList(plan?.fields || [], chosenField)}</select>
        </label>
        <label>Time
          <select name="time">${optionList(plan?.times || [], chosenTime)}</select>
        </label>
        <label>Date
          ${plan?.dates?.length
            ? `<select name="date">${optionList(plan.dates, chosenDate)}</select>`
            : `<input name="date" type="date" value="${escapeHtml(chosenDate)}">`}
        </label>
        <label>Home <select name="home_id">${teamOptions(roster, g.home_id)}</select></label>
        <label>Away <select name="away_id">${teamOptions(roster, g.away_id)}</select></label>
        <label>Protest note <input name="protest_note" value="${escapeHtml(g.protest_note || "")}" placeholder="After protest"></label>
        <div class="actions">
          <button class="btn" type="submit">Save slot</button>
          <button class="btn ghost" type="button" data-swap>Swap sides</button>
          ${g.status === "final" ? `<button class="btn ghost" type="button" data-reopen>Reopen</button>` : ""}
        </div>
      </form>
      ${g.home && g.away ? `<form class="bk-score" data-bk-id="${escapeHtml(g.id)}">
        <input name="home_runs" type="number" min="0" value="${g.home_runs ?? ""}" aria-label="Home runs">
        <input name="away_runs" type="number" min="0" value="${g.away_runs ?? ""}" aria-label="Away runs">
        <button class="btn ghost" type="submit">Final</button>
      </form>` : ""}
    </details>` : "";
  return `<article class="bk-match ${escapeHtml(g.status)} ${tie ? "tie" : ""} ${set ? "slot-set" : "slot-open"}">
    <div class="bk-team ${homeWin ? "winner" : ""} ${g.home ? "" : "tbd"}">
      <span>${teamLink((currentEvent && currentEvent.slug) || "", g.home_slug, g.home || "TBD")}</span>
      <b>${g.status === "final" ? g.home_runs : ""}</b>
    </div>
    <div class="bk-team ${awayWin ? "winner" : ""} ${g.away ? "" : "tbd"}">
      <span>${teamLink((currentEvent && currentEvent.slug) || "", g.away_slug, g.away || "TBD")}</span>
      <b>${g.status === "final" ? g.away_runs : ""}</b>
    </div>
    ${set ? `<div class="bk-when">
      <span class="bk-chip"><em>Field</em> ${escapeHtml(fieldLabel)}</span>
      <span class="bk-chip"><em>Time</em> ${escapeHtml(timeLabel)}</span>
    </div>` : ""}
    <p class="bk-meta">${escapeHtml(meta.join(" · "))}${g.protest_note ? ` · ${escapeHtml(g.protest_note)}` : ""}</p>
    ${desk}
  </article>`;
}

function renderBracketTree(games, title, blurb, showChampion, roster, plan) {
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
          <div class="bk-round-games n${byRound[r].length}">${byRound[r].map((g) => matchCard(g, roster, plan)).join("")}</div>
        </div>`).join("")}
      ${showChampion ? `<div class="bk-round">
        <h3>Champion</h3>
        <div class="bk-trophy ${champ ? "named" : "tbd"}">${escapeHtml(champ?.winner || "TBD")}</div>
      </div>` : ""}
    </div>
  </section>`;
}

function protestSwapForm(games) {
  if (!isDirector()) return "";
  const seats = (games || []).filter((g) => g.id).flatMap((g) => {
    const label = ROUND_META[g.round]?.label || g.round || "Game";
    return [
      { id: g.id, seat: "home", label: `${label} · home · ${g.home || "TBD"}` },
      { id: g.id, seat: "away", label: `${label} · away · ${g.away || "TBD"}` },
    ];
  });
  if (!seats.length) return "";
  const opts = seats.map((s) =>
    `<option value="${escapeHtml(s.id)}|${s.seat}">${escapeHtml(s.label)}</option>`).join("");
  return `<section class="card">
    <h2>Protest / reorder</h2>
    <p class="muted">Move a team from one bracket seat to another after a protest. Games that were final reopen. Field and time stay on the card unless you change them there.</p>
    <form class="form wide" id="bk-swap">
      <div class="form-grid two">
        <label>From <select name="from">${opts}</select></label>
        <label>To <select name="to">${opts}</select></label>
      </div>
      <label>Protest note <input name="protest_note" placeholder="Umpire conference — seed 4 restored"></label>
      <button class="btn" type="submit">Swap seats</button>
    </form>
  </section>`;
}

function bracketBoards(games, roster, plan) {
  const flights = uniqueStrings((games || []).map((g) => g.flight || ""));
  const groups = flights.length ? flights : [""];
  return groups.map((flight) => {
    const slice = flights.length ? games.filter((g) => (g.flight || "") === flight) : games;
    const prefix = flight ? flightTitle(flight) + " · " : "";
    const champ = slice.filter((g) => gameSide(g) === "championship" || gameSide(g) === "winners");
    const losers = slice.filter((g) => gameSide(g) === "losers");
    const cons = slice.filter((g) => gameSide(g) === "consolation");
    return `
      ${renderBracketTree(champ, prefix + "Championship", "Winners move right when a score is final. Field and first pitch sit on every card.", true, roster, plan)}
      ${renderBracketTree(losers, prefix + "Losers", "Second-life games after a loss. These do not use consolation placement slots.", false, roster, plan)}
      ${renderBracketTree(cons, prefix + "Consolation", "Outside the championship. These games do not feed the final.", false, roster, plan)}
    `;
  }).join("");
}

function bindBracketDesk(slug, root) {
  const post = async (path, body) => {
    const res = await fetch("/api/events/" + encodeURIComponent(slug) + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      alert(await res.text());
      return false;
    }
    return true;
  };
  root.querySelectorAll("[data-bk-id]").forEach((form) => {
    form.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (await post("/bracket/" + form.dataset.bkId + "/score", data)) {
        flashSaved("Score saved");
        eventBracket(slug);
      }
    });
  });
  root.querySelectorAll("[data-bk-desk]").forEach((form) => {
    const dateEl = form.elements.date;
    const fieldEl = form.elements.field;
    const timeEl = form.elements.time;
    const filter = () => {
      if (!dateEl || !fieldEl || !timeEl || !root._deskPlan) return;
      const plan = root._deskPlan;
      const day = dateEl.value;
      const keepField = fieldEl.value;
      const keepTime = timeEl.value;
      const openFields = plan.fields.filter((name) =>
        name === keepField || plan.times.some((tm) => slotOpen(plan.board, name, day, tm)));
      const fieldChoices = uniqueStrings(openFields.length ? openFields : plan.fields);
      fieldEl.innerHTML = optionList(fieldChoices, fieldChoices.includes(keepField) ? keepField : fieldChoices[0]);
      const field = fieldEl.value;
      const openTimes = plan.times.filter((tm) => slotOpen(plan.board, field, day, tm) || tm === keepTime);
      timeEl.innerHTML = optionList(openTimes.length ? openTimes : plan.times, openTimes.includes(keepTime) ? keepTime : (openTimes[0] || keepTime));
    };
    dateEl?.addEventListener("change", filter);
    fieldEl?.addEventListener("change", filter);
    filter();
    form.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      if (await post("/bracket/" + form.dataset.bkDesk, data)) {
        flashSaved("Game saved");
        eventBracket(slug);
      }
    });
    form.querySelector("[data-swap]")?.addEventListener("click", async () => {
      if (await post("/bracket/" + form.dataset.bkDesk, { swap: true })) {
        flashSaved("Sides swapped");
        eventBracket(slug);
      }
    });
    form.querySelector("[data-reopen]")?.addEventListener("click", async () => {
      if (await post("/bracket/" + form.dataset.bkDesk, { reopen: true })) {
        flashSaved("Game reopened");
        eventBracket(slug);
      }
    });
  });
  const swap = root.querySelector("#bk-swap");
  if (swap) {
    swap.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const data = Object.fromEntries(new FormData(swap));
      const [fromId, fromSeat] = String(data.from || "").split("|");
      const [toId, toSeat] = String(data.to || "").split("|");
      if (await post("/bracket/swap", {
        from_id: fromId,
        from_seat: fromSeat,
        to_id: toId,
        to_seat: toSeat,
        protest_note: data.protest_note,
      })) {
        flashSaved("Seats swapped");
        eventBracket(slug);
      }
    });
  }
}

function rosterBlock(teams, eventSlug) {
  if (!teams || !teams.length) {
    return `<section class="empty">No teams signed up yet. A team can join with or without GameChanger.</section>`;
  }
  return `<section class="card">
    <h2>Teams</h2>
    <p class="muted">GameChanger links are the public pages coaches published. This host stores the URL. It does not scrape private pages.</p>
    ${table(["Team", "Seed", "GameChanger"], teams.map((t) => `<tr>
      <td>${teamLink(eventSlug, t.slug, t.name)}${t.host ? ` <span class="badge host">host</span>` : ""}</td>
      <td class="num">${t.seed || "—"}</td>
      <td>${t.gc_linked && t.gamechanger_url
        ? `<a href="${escapeHtml(t.gamechanger_url)}" target="_blank" rel="noopener">Open book</a>`
        : `<span class="muted">Not linked</span>`}</td>
    </tr>`))}
  </section>`;
}

function teamChips(teams, eventSlug) {
  if (!teams || !teams.length) {
    return `<section class="empty">No teams signed up yet. A team can join with or without GameChanger.</section>`;
  }
  return `<section class="card">
    <h2>Teams</h2>
    <div class="chips scroll-chips">${teams.map((t) =>
      `<a class="chip" data-link href="${escapeHtml(teamHref(eventSlug, t.slug))}">${escapeHtml(t.name)}${t.pool ? ` · ${escapeHtml(t.pool)}` : ""}</a>`
    ).join("")}</div>
  </section>`;
}

function homeGettingThere(ev, photos) {
  const list = (photos || []).filter((p) => p.public && p.url);
  if (!ev.address && !ev.venue && !ev.map_url && !list.length) return "";
  return `<section class="card">
    <h2>Getting there</h2>
    ${ev.venue ? `<p><b>${escapeHtml(ev.venue)}</b></p>` : ""}
    ${ev.address ? `<p>${escapeHtml(ev.address)}${ev.map_url ? ` · <a href="${escapeHtml(ev.map_url)}" target="_blank" rel="noopener">Map</a>` : ""}</p>` : ""}
    ${list.length ? `<div class="photo-grid">${list.slice(0, 3).map((p) => `<figure>
      <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || p.kind || "Field")}">
      ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""}
    </figure>`).join("")}</div>` : ""}
  </section>`;
}

function upcomingFromBoard(board) {
  return (board.overall || []).filter((g) => g.home && g.away && g.status !== "final" && g.status !== "postponed").slice().sort(compareGames);
}

function homePhaseBlock(board) {
  const ev = board.event;
  const upcoming = upcomingFromBoard(board);
  const finals = (board.overall || []).filter((g) => g.status === "final");
  const during = finals.length > 0 && upcoming.length > 0;
  if (upcoming.length) {
    const next = upcoming[0];
    const more = upcoming.slice(1, 4);
    const recent = during
      ? finals.slice().sort(compareGames).slice(-2).reverse()
      : [];
    return `<section class="next-game home-phase" data-phase="${during ? "during" : "before"}">
      <p class="kicker">${during ? "Up next" : "First pitch"}</p>
      <p class="next-when">${escapeHtml(formatTimeDisplay(next.time) || "TBD")}${next.field ? ` · ${escapeHtml(next.field)}` : ""}</p>
      <p class="next-vs">${teamLink(ev.slug, next.home_slug, next.home || "TBD")} vs ${teamLink(ev.slug, next.away_slug, next.away || "TBD")}</p>
      <p class="muted">${escapeHtml([formatDateDisplay(next.date), gameNo(next), next.round || next.pool].filter(Boolean).join(" · "))}</p>
    </section>
    ${recent.length ? `<section class="card"><h2>Recently final</h2>
      <div class="home-next-list">${recent.map((g) => gameCard(g, ev.slug, { openLabel: "Open" })).join("")}</div>
    </section>` : ""}
    ${more.length ? `<section class="card"><h2>Coming up</h2>
      <div class="home-next-list">${more.map((g) => gameCard(g, ev.slug)).join("")}</div>
      <p class="actions">
        <a class="btn" data-link href="/t/${ev.slug}/overall">Weekend schedule</a>
        <a class="btn ghost" data-link href="/t/${ev.slug}/bracket">Bracket</a>
      </p>
    </section>` : ""}`;
  }
  if (finals.length) {
    return `<section class="next-game empty home-phase" data-phase="after">
      <p class="kicker">Weekend</p>
      <p>Pool and bracket games that are still open are posted on Schedule.</p>
    </section>`;
  }
  return `<section class="next-game empty home-phase" data-phase="before">
    <p class="kicker">Schedule</p>
    <p>The weekend grid is not posted yet. Check back closer to first pitch.</p>
  </section>`;
}

export async function eventHome(slug) {
  const board = await fetchBoard(slug);
  const ev = board.event;
  const packet = board.packet || ev.packet;
  const champ = packet?.champion;
  const hero = board.header_photo;
  const dateLine = formatWeekendDates(ev.start, ev.end) || ev.dates || packet?.dates || "";
  eventRoot().innerHTML = eventChrome(ev, "home", `
    ${hero && hero.url ? `<figure class="event-hero"><img src="${escapeHtml(hero.url)}" alt="${escapeHtml(hero.caption || ev.venue || "Field")}">${hero.caption ? `<figcaption>${escapeHtml(hero.caption)}</figcaption>` : ""}</figure>` : ""}
    <section class="page-head">
      <p class="lede">${escapeHtml(ev.status_note || packet?.status || "Live standings. The bracket fills when scores are final.")}</p>
      <p class="muted">${escapeHtml([dateLine, ev.venue, ev.format_label, sourceLabel(ev)].filter(Boolean).join(" · "))}</p>
      <div class="actions">
        ${ev.signup_open ? `<a class="btn" data-link href="/t/${ev.slug}/signup">Sign a team up</a>` : `<span class="muted">Signup is closed.</span>`}
        <a class="btn ghost" data-link href="/t/${ev.slug}/overall">Weekend schedule</a>
        <a class="btn ghost" data-link href="/t/${ev.slug}/bracket">Open bracket</a>
        ${ev.slug === "keystone-clash-2026" ? `<a class="btn ghost" href="/popup/index.html">Popup site</a>` : ""}
        ${ev.tm_url ? `<a class="btn ghost" href="${escapeHtml(ev.tm_url)}" target="_blank" rel="noopener">Tourney Machine</a>` : ""}
      </div>
    </section>
    ${rainBanner(ev)}
    ${champ ? `<section class="champ-banner">
      <div class="k">Champions</div>
      <div class="t">${escapeHtml(champ.team)}</div>
      <p>${escapeHtml(champ.record || "")}${champ.line ? " — " + escapeHtml(champ.line) : ""}</p>
      ${packet?.runner_up ? `<div class="ru"><span>Runner-up</span><b>${escapeHtml(packet.runner_up.team)}</b> ${escapeHtml(packet.runner_up.record || "")}</div>` : ""}
    </section>` : ""}
    ${homePhaseBlock(board)}
    ${teamChips(board.roster, ev.slug)}
    ${(board.standings || []).some((p) => (p.teams || []).length)
      ? `<section class="grid two">${standingsBlock(board.standings, ev.slug)}</section>` : ""}
    ${homeGettingThere(ev, board.photos || [])}
    ${fieldsBlock(ev, board.fields, { demote: true })}
  `);
}

export async function eventStandings(slug) {
  const board = await fetchBoard(slug);
  eventRoot().innerHTML = eventChrome(board.event, "standings", `
    <section class="page-head">
      <h1>Standings</h1>
      <p class="muted">Each pool prints the order the director saved. Default is record (tie = half), then head-to-head, then fewest runs allowed, then run differential, then most runs scored. Head-to-head stays group-aware.</p>
    </section>
    <section class="grid two">${(board.standings || []).some((p) => (p.teams || []).length)
      ? standingsBlock(board.standings, slug)
      : `<section class="card">${tabEmpty(board.event, slug, "standings")}</section>`}</section>
  `);
}

export async function eventPools(slug) {
  return eventStandings(slug);
}

function bracketPageActions(board, slug) {
  if (!isDirector(board.event)) return "";
  const finals = (board.schedule || []).filter((g) => g.status === "final").length;
  const empty = !(board.bracket || []).length;
  return `<section class="card no-print">
    ${empty ? `<p>No bracket games yet. Publish the Sunday shape now so families can see times and fields with TBD in every slot. Import a bracket you already have, or draw from standings after a pool result.</p>` : `<p class="muted">Print this page for the fence. Cards stay collapsed so the tree fits one page.</p>`}
    <div class="actions">
      ${empty ? `<button class="btn" type="button" id="publish-blank-bracket">Publish blank bracket</button>` : ""}
      <button class="btn ghost" type="button" id="draw-standings-bracket"${finals ? "" : " disabled"}>Draw from standings</button>
      ${empty ? "" : `<button class="btn ghost" type="button" id="print-bracket">Print</button>`}
    </div>
    ${finals ? "" : `<p class="muted">Draw from standings waits until a pool game is final.</p>`}
    ${bracketImportDesk()}
  </section>`;
}

function bindBracketPageActions(slug, board) {
  document.getElementById("publish-blank-bracket")?.addEventListener("click", async () => {
    try {
      await adminPost(slug, "/bracket/build", {
        empty: true,
        replace: true,
        format: board.event.format || "pool-to-bracket",
        bracket_flights: board.event.bracket_flights || "none",
      });
      flashSaved("Blank bracket posted");
      eventBracket(slug);
    } catch (err) {
      window.alert(err.message || String(err));
    }
  });
  document.getElementById("draw-standings-bracket")?.addEventListener("click", async () => {
    const open = (board.schedule || []).filter((g) => g.status !== "final").length;
    const body = {
      format: board.event.format || "pool-to-bracket",
      bracket_flights: board.event.bracket_flights || "none",
      replace: true,
    };
    if (open && (board.schedule || []).some((g) => g.status === "final")) {
      if (!confirm("Pool play is not finished (" + open + " games still open). Draw from the current standings anyway?")) return;
      body.confirm = true;
    }
    try {
      await adminPost(slug, "/bracket/build", body);
      flashSaved("Bracket drawn from standings");
      eventBracket(slug);
    } catch (err) {
      window.alert(err.message || String(err));
    }
  });
  document.getElementById("print-bracket")?.addEventListener("click", () => window.print());
}

export async function eventBracket(slug) {
  const board = await fetchBoard(slug);
  rememberEvent(board.event);
  const plan = buildDeskPlan(board);
  const director = isDirector(board.event);
  eventRoot().innerHTML = eventChrome(board.event, "bracket", `
    <section class="page-head">
      <h1>Bracket</h1>
      <p class="muted">Championship on top. Consolation sits to the side and never feeds the title game.${director ? " Every card starts collapsed so the tree stays readable. Open Edit game to set field, time, sides, or the final. New games still default to the next open slot." : " Field and first pitch sit on a card after they are set."}</p>
    </section>
    ${bracketPageActions(board, slug)}
    ${board.bracket.length ? `<div class="bracket-print">${bracketBoards(board.bracket, board.roster, plan)}</div>` : (director ? "" : `<section class="card">${tabEmpty(board.event, slug, "bracket")}</section>`)}
    ${board.bracket.length ? protestSwapForm(board.bracket) : ""}
  `);
  eventRoot()._deskPlan = plan;
  bindBracketDesk(slug, eventRoot());
  if (isDirector()) {
    bindBracketImport(slug, (err) => { window.alert(err.message || String(err)); });
    bindBracketPageActions(slug, board);
  }
}

export async function eventOverall(slug) {
  const board = await fetchBoard(slug);
  const rows = board.overall || [];
  eventRoot().innerHTML = eventChrome(board.event, "overall", `
    <section class="page-head">
      <h1>Schedule</h1>
      <p class="muted">Every game this weekend — pool play and the bracket — sorted by date, first pitch, and field.</p>
    </section>
    ${rainBanner(board.event)}
    <section class="card">
      ${rows.length ? schedulePair(["Game", "When", "Field", "Round", "Home", "Away", "Score"], rows.map((g) => {
        const kind = g.kind === "bracket" ? (ROUND_META[g.round]?.label || g.round || "Bracket") : (g.round || "Pool");
        const href = g.kind === "pool" && g.id
          ? `/t/${escapeHtml(slug)}/games/${g.id}`
          : `/t/${escapeHtml(slug)}/bracket`;
        return `<tr>
          <td>${gameNoCell(g)}</td>
          <td>${escapeHtml(whenLine(g))}${g.delayed_from ? ` <span class="muted">(was ${escapeHtml(formatTimeDisplay(g.delayed_from) || g.delayed_from)})</span>` : ""}</td>
          <td>${escapeHtml(g.field || "—")}</td>
          <td><span class="ov-kind ${escapeHtml(g.kind || "")}">${escapeHtml(kind)}</span></td>
          <td>${teamLink(slug, g.home_slug, g.home || "TBD")}</td>
          <td>${teamLink(slug, g.away_slug, g.away || "TBD")}</td>
          <td>${scoreCell(g)} · ${escapeHtml(g.status || "")}
            ${g.id ? ` · <a data-link href="${href}">${g.kind === "pool" ? (g.can_score ? "Post score" : "Open") : "Bracket"}</a>` : ""}
          </td>
        </tr>`;
      }), rows.map((g) => gameCard(g, slug))) : tabEmpty(board.event, slug, "schedule")}
    </section>
  `);
}

export async function eventSchedule(slug) {
  const board = await fetchBoard(slug);
  const packet = board.packet || board.event.packet;
  const rows = realPoolGames(board.schedule).sort(compareGames);
  eventRoot().innerHTML = eventChrome(board.event, "schedule", `
    <section class="page-head">
      <h1>Games</h1>
      <p class="muted">Pool games by diamond. The full weekend — pool and bracket, with field and time — is on <a data-link href="/t/${escapeHtml(board.event.slug)}/overall">Schedule</a>. Open a game to post the score and upload stats.</p>
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
      <h1>${gameNo(g) ? `${escapeHtml(gameNo(g))} · ` : ""}${teamLink(slug, g.home_slug, g.home)} vs ${teamLink(slug, g.away_slug, g.away)}</h1>
      <p class="muted">${escapeHtml([whenLine(g) !== "TBD" ? whenLine(g) : "", g.field, g.pool ? "Pool " + g.pool : ""].filter(Boolean).join(" · "))}</p>
      <p><a data-link href="/t/${escapeHtml(slug)}/schedule">Back to games</a></p>
    </section>
    ${detail.director && boxWaiting(box) ? `<section class="card approve-banner">
      <h2>Approve stats</h2>
      <p class="muted">${escapeHtml(box.source || "box")} · ${escapeHtml(box.status)}. Approve publishes this game’s hitting and pitching on the public board.</p>
      ${approveStatsButtons(box.id)}
    </section>` : ""}
    <section class="card">
      <h2>Score</h2>
      ${can ? `<form class="form wide" id="score-form">
        <div class="form-grid two">
          <label>${teamLink(slug, g.home_slug, g.home)} <input name="home_runs" type="number" min="0" value="${g.home_runs ?? ""}" required></label>
          <label>${teamLink(slug, g.away_slug, g.away)} <input name="away_runs" type="number" min="0" value="${g.away_runs ?? ""}" required></label>
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
      </form>` : `<p>${scoreCell(g)} · ${escapeHtml(g.status)}</p>
        <p class="muted">${eventPb.authStore.record ? "This is not your game to score." : "Log in as the director or a team manager to post a result."}</p>`}
    </section>
    <section class="card">
      <h2>How this game’s stats get here</h2>
      <p class="muted">Four doors. A Grok bot may poll the public GameChanger URL a coach stored (about every 5 minutes during a live weekend) and post readable lines. A PDF upload still works. Nothing is invented from a picture or a blank page.</p>
      ${box ? `<p class="stats-now">
        ${box.gc_url ? `<a href="${escapeHtml(box.gc_url)}" target="_blank" rel="noopener">GameChanger box</a> · ` : ""}
        ${box.url ? `<a href="${escapeHtml(box.url)}" target="_blank" rel="noopener">${escapeHtml(box.original_name || "Uploaded PDF")}</a> · ` : ""}
        ${escapeHtml(box.source || "box")} · ${escapeHtml(box.status)}
        ${box.note ? " · " + escapeHtml(box.note) : ""}
      </p>` : `<p class="empty">No PDF, GameChanger link, or bot lines on this game yet.</p>`}
      ${can ? `
      <details class="setup-block" open>
        <summary>1. GameChanger mobile PDF</summary>
        <p class="muted">From the GC app: share / export the box as PDF, then drop it here. Team managers use this after the game.</p>
        <form class="form wide" id="gc-pdf-form" data-autosave-box>
          <input type="hidden" name="source" value="gc_pdf">
          <label>GameChanger PDF <input name="file" type="file" accept=".pdf,application/pdf" required data-autosave-box></label>
          <label>Note <input name="note" placeholder="Saturday 9:00, Harbor 1"></label>
          <p class="muted">Choosing a file saves it. You do not need another click.</p>
          <p class="error" id="gc-pdf-err" hidden></p>
        </form>
      </details>
      <details class="setup-block" open>
        <summary>2. Public GameChanger box URL</summary>
        <p class="muted">Paste the public web box, like web.gc.com/teams/…/schedule/…/box-score. We store the link. Bots read posted numbers from that public page. Unreadable cells stay blank.</p>
        <form class="form wide" id="gc-url-form" data-autosave-box>
          <input type="hidden" name="source" value="gc_url">
          <label>Box-score URL <input name="gc_url" type="url" required placeholder="https://web.gc.com/teams/…/schedule/…/box-score" value="${escapeHtml(box?.gc_url || "")}"></label>
          <p class="muted">Paste or finish the URL — it saves when you leave the field.</p>
          <p class="error" id="gc-url-err" hidden></p>
        </form>
      </details>
      <details class="setup-block">
        <summary>3. Grok bot upload</summary>
        <p class="muted">Queued PDFs and public GC links show in Admin → Approve stats and <code>GET /api/bot/gc-monitor</code>. A bot (or you) posts extracted hitting, pitching, and score to <code>/api/bot/event-box</code>. Local: <code>python3 scripts/bot_gc_monitor.py --list</code> then <code>python3 scripts/bot_c_event_box.py --event ${escapeHtml(slug)} --game ${escapeHtml(id)}</code>.</p>
      </details>
      ${detail.director ? `<details class="setup-block" open>
        <summary>4. Director PDF</summary>
        <p class="muted">Your upload as the tournament director. Use a GC export or a scorebook scan. Check the box if this file is the book of record and a bot does not need to type it.</p>
        <form class="form wide" id="td-pdf-form" data-autosave-box>
          <input type="hidden" name="source" value="director_pdf">
          <label>PDF or photo <input name="file" type="file" accept=".pdf,image/jpeg,image/png,image/webp" required data-autosave-box></label>
          <label class="check"><input type="checkbox" name="approve_file"> Official book — do not wait on a bot</label>
          <label>Note <input name="note" placeholder="TD copy from the plate meeting"></label>
          <p class="muted">Choosing a file saves it. You do not need another click.</p>
          <p class="error" id="td-pdf-err" hidden></p>
        </form>
      </details>` : ""}
      ` : `<p class="muted">${eventPb.authStore.record ? "Log in as this game’s manager or the director to upload a PDF or GC link." : "Log in to upload stats."}</p>`}
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
      flashSaved("Score saved");
      eventGame(slug, id);
    });
  }
  const postBox = async (form, errId, savedMsg) => {
    const fd = new FormData(form);
    if (form.querySelector("[name=approve_file]")) {
      fd.set("approve_file", form.querySelector("[name=approve_file]").checked ? "true" : "false");
    }
    const out = await fetch("/api/events/" + encodeURIComponent(slug) + "/schedule/" + encodeURIComponent(id) + "/box", {
      method: "POST",
      headers: { ...authHeader() },
      body: fd,
    });
    if (!out.ok) return show(errId, new Error(await out.text()));
    flashSaved(savedMsg || "Box score saved");
    eventGame(slug, id);
  };
  [["gc-pdf-form", "gc-pdf-err", "GameChanger PDF queued"], ["gc-url-form", "gc-url-err", "GameChanger link saved"], ["td-pdf-form", "td-pdf-err", "Director box saved"]].forEach(([fid, eid, ok]) => {
    const form = document.getElementById(fid);
    if (!form) return;
    form.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      postBox(form, eid, ok);
    });
    form.querySelector("input[type=file]")?.addEventListener("change", () => {
      if (form.querySelector("input[type=file]").files.length) postBox(form, eid, ok);
    });
    const url = form.querySelector("input[name=gc_url]");
    if (url) {
      url.addEventListener("change", () => {
        if (url.value && url.checkValidity()) postBox(form, eid, ok);
      });
    }
  });
  if (detail.director && boxWaiting(box)) {
    bindBoxReview(slug, () => eventGame(slug, id));
  }
}

export async function eventLeaders(slug) {
  const board = await fetchBoard(slug);
  const publishedHit = board.leaders.published_hitting || [];
  const publishedPit = board.leaders.published_pitching || [];
  const fullHit = board.leaders.full_hitting || [];
  const hit = (publishedHit.length ? publishedHit : board.leaders.hitting).map((r) => `<tr>
    <td>${escapeHtml(r.player || r.name_key)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
    <td>${r.ab ?? ""}</td><td>${r.h ?? ""}</td><td>${r.rbi ?? ""}</td>
    <td>${r.avg_display || r.avg || ""}</td><td>${r.ops || ""}</td>
  </tr>`);
  const pit = (publishedPit.length ? publishedPit : board.leaders.pitching).map((r) => `<tr>
    <td>${escapeHtml(r.player || r.name_key)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
    <td>${r.ip ?? ""}</td><td>${r.k ?? r.so ?? ""}</td><td>${r.era_display || r.era || ""}</td>
  </tr>`);
  const full = fullHit.filter((r) => r.q !== false).concat(fullHit.filter((r) => r.q === false));
  const cap = hasPitchIpCap(board.event, board.leaders);
  const minAb = board.leaders.min_ab != null ? board.leaders.min_ab : 8;
  const minIp = board.leaders.min_ip != null ? board.leaders.min_ip : 3;
  const hitRank = board.leaders.qualify_source === "packet" ? "ranked by OPS on the popup" : "ranked by batting average";
  const counts = (board.leaders.pitch_counts || []).map((r) => cap ? `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
    <td>${r.ip}</td><td>${r.limit_ip != null ? r.limit_ip : board.event.pitch_limit_ip}.0</td>
    <td>${r.over ? `<span class="badge l">over</span>` : `<span class="badge w">ok</span>`}</td>
  </tr>` : `<tr>
    <td>${escapeHtml(r.name_key)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
    <td>${r.ip}</td>
  </tr>`);
  const approveBanner = await directorApproveBanner(slug, board.event);
  eventRoot().innerHTML = eventChrome(board.event, "stats", `
    <section class="page-head">
      <h1>Stat leaders</h1>
      <p class="muted">${escapeHtml(qualifyNote(board.leaders))}</p>
      <div class="actions">
        <a class="btn ghost" data-link href="/t/${board.event.slug}/stats">Full board</a>
        <a class="btn ghost" data-link href="/t/${board.event.slug}/awards">Awards</a>
      </div>
    </section>
    ${approveBanner}
    <section class="grid two">
      <div class="card"><h2>Hitting leaders</h2><p class="muted">Min ${minAb} AB · ${hitRank}</p>
        ${table(["Player", "Team", "AB", "H", "RBI", "AVG", "OPS"], hit)}</div>
      <div class="card"><h2>Pitching leaders</h2><p class="muted">Min ${minIp} IP · ERA as published</p>
        ${table(["Player", "Team", "IP", "K", "ERA"], pit)}</div>
    </section>
    ${full.length ? `<section class="card"><h2>Full published hitting board</h2>
      <p class="muted">Every published line. Qualifiers first.</p>
      ${table(["Player", "Team", "AB", "H", "RBI", "AVG", "OPS", ""], full.map((r) => `<tr>
        <td>${escapeHtml(r.player)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
        <td>${r.ab}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.avg}</td><td>${r.ops}</td>
        <td>${r.q ? `<span class="badge w">qual</span>` : `<span class="badge t">below</span>`}</td>
      </tr>`))}</section>` : ""}
    <section class="card"><h2>Pitching counts</h2>
      <p class="muted">${cap ? `Weekend limit ${board.event.pitch_limit_ip}.0 IP. Tracked in one place, not forty texts.` : "No posted weekend inning cap. IP used is tracked here."}</p>
      ${table(cap ? ["Player", "Team", "IP used", "Limit", ""] : ["Player", "Team", "IP used"], counts)}
    </section>`);
}

export async function eventAwards(slug) {
  const board = await fetchBoard(slug);
  const at = board.leaders.all_tournament;
  eventRoot().innerHTML = eventChrome(board.event, "awards", `
    <section class="page-head print-sheet">
      <h1>All-tournament</h1>
      <p class="muted">Picked on numbers, not on which kid the director happened to watch. Weekend awards stay 8 AB / 3.0 IP.</p>
      <div class="actions"><button class="btn" type="button" onclick="window.print()">Print award sheet</button></div>
    </section>
    <section class="grid two">
      <div class="card"><h2>Hitters</h2>
        ${table(["Player", "Team", "AVG", "RBI"], at.hitters.map((r) => `<tr>
          <td>${escapeHtml(r.name_key)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
          <td>${r.avg_display}</td><td>${r.rbi}</td></tr>`))}
      </div>
      <div class="card"><h2>Pitchers</h2>
        ${table(["Player", "Team", "IP", "ERA"], at.pitchers.map((r) => `<tr>
          <td>${escapeHtml(r.name_key)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
          <td>${r.ip}</td><td>${r.era_display}</td></tr>`))}
      </div>
    </section>
    <p class="muted">Print Sunday at the field while everybody is still there.</p>
  `);
}

export async function eventList() {
  const events = await eventPb.collection("events").getFullList({ filter: "public=true && status!='archived'", sort: "-start" });
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
          <span class="muted">${escapeHtml([formatWeekendDates(ev.start, ev.end), ev.ages, ev.venue, sourceLabel(ev)].filter(Boolean).join(" · "))}</span>
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
      <a class="choice" data-link href="/directors/import">
        <p class="muted">CSV</p>
        <h3>You already have a schedule</h3>
        <p>Paste or upload the Excel / legal-pad grid. Name the weekend first — a CSV alone does not create a tournament.</p>
      </a>
      <a class="choice" data-link href="/directors/import-popup">
        <p class="muted">Keystone Clash</p>
        <h3>Import the popup</h3>
        <p>Public JSON only — teams, GameChanger links, pool records, and Sunday scores.</p>
      </a>
      <a class="choice" data-link href="/directors/duplicate">
        <p class="muted">Copy a weekend</p>
        <h3>Duplicate an existing tournament</h3>
        <p>Reuse last year’s fields, teams, and unpaid schedule. Scores, boxes, and family contacts stay behind.</p>
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
    flashSaved("Popup imported");
    goEvent("/t/keystone-clash-2026");
  });
}

export async function eventStats(slug) {
  const board = await fetchBoard(slug);
  const hitting = board.leaders.full_hitting || [];
  const pitching = board.leaders.full_pitching || [];
  const teams = [...new Set([...hitting, ...pitching].map((r) => r.team).filter(Boolean))].sort();
  const approveBanner = await directorApproveBanner(slug, board.event);
  eventRoot().innerHTML = eventChrome(board.event, "stats", `
    <section class="page-head">
      <h1>Full stats board</h1>
      <p class="muted">${escapeHtml(qualifyNote(board.leaders) || "Published scorebook lines. Filter by team. Qualifying line scales with games played, up to 8 AB / 3.0 IP.")}</p>
      <div class="actions">
        <a class="btn ghost" data-link href="/t/${board.event.slug}/leaders">Leaders</a>
        <a class="btn ghost" data-link href="/t/${board.event.slug}/awards">Awards</a>
        ${board.event.slug === "keystone-clash-2026" ? `<a class="btn ghost" href="/popup/stats.html">Popup stats</a>` : ""}
      </div>
    </section>
    ${approveBanner}
    <section class="card">
      <div class="tabs" role="tablist">
        <button class="tab active" type="button" data-stats-tab="hit">Hitting</button>
        <button class="tab" type="button" data-stats-tab="pit">Pitching</button>
      </div>
      <div class="chips scroll-chips" id="stats-chips">
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
    if (!hitting.length && !pitching.length) {
      box.innerHTML = tabEmpty(board.event, slug, "stats");
      return;
    }
    if (state.tab === "hit") {
      box.innerHTML = table(["#", "Player", "Team", "AB", "H", "RBI", "AVG", "OPS", ""], rows.map((r, i) => `<tr class="${r.q === false ? "muted-row" : ""}">
        <td>${i + 1}</td><td>${escapeHtml(r.player)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
        <td>${r.ab}</td><td>${r.h}</td><td>${r.rbi}</td><td>${r.avg}</td><td>${r.ops}</td>
        <td>${r.q ? `<span class="badge w">qual</span>` : `<span class="badge t">below</span>`}</td>
      </tr>`));
    } else {
      box.innerHTML = table(["#", "Player", "Team", "IP", "K", "ERA", ""], rows.map((r, i) => `<tr class="${r.q === false ? "muted-row" : ""}">
        <td>${i + 1}</td><td>${escapeHtml(r.player)}</td><td>${teamNameLink(slug, board.roster, r.team)}</td>
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

function isKeystoneParkingAsset(url) {
  const href = String(url || "");
  if (!/parking-map\.png/i.test(href)) return false;
  return /\/popup\//.test(href) || /keystoneclash/i.test(href);
}

function parkingMapView(event, photos, info) {
  const keystone = !!(event && event.slug === "keystone-clash-2026");
  const own = (photos || []).find((p) => p.public && p.url && (p.kind === "parking" || p.kind === "layout" || p.kind === "entrance"));
  const packetMap = (info && info.parking_map) || "";
  let href = "";
  if (keystone) href = "/popup/parking-map.png";
  else if (own && own.url) href = own.url;
  else if (packetMap && !isKeystoneParkingAsset(packetMap)) href = packetMap;
  const alt = (own && own.caption)
    || (info && info.parking_map_alt)
    || (keystone ? "Aerial map of East End Park showing the main lot off Meadow St and the Field 2 lot." : "Parking and field map");
  const note = keystone
    ? "Both lots are marked in orange. Enter off Meadow St. Overflow parking is on East O’Hara St."
    : ((own && own.caption) || "");
  return { href, alt, note, keystone };
}

export async function eventInfo(slug) {
  const board = await fetchBoard(slug);
  const packet = board.packet || board.event.packet;
  const info = packet?.info || {};
  const raffle = packet?.raffle;
  const local = board.event.slug === "keystone-clash-2026";
  const map = parkingMapView(board.event, board.photos || [], info);
  const rulesHref = local ? "/popup/full-rules.html" : info.full_rules;
  const packetHref = local ? "/popup/coaches-packet.pdf" : info.coaches_packet;
  const mapHref = map.href;
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
    ${photoGallery(board.photos || [])}
    ${guidelinesBlock(board.event)}
    ${mapHref ? `<section class="card infomap">
      <h2>${map.keystone ? "Parking" : "Parking and field map"}</h2>
      <img src="${escapeHtml(mapHref)}" alt="${escapeHtml(map.alt)}">
      ${map.note ? `<p class="muted">${escapeHtml(map.note)}</p>` : ""}
    </section>` : ""}
    <section class="card facts">
      ${[
        ["Dates", formatWeekendDates(board.event.start, board.event.end) || packet?.dates || ""],
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

function dropUnusedPins(fd) {
  fd.delete("lat");
  fd.delete("lng");
  fd.delete("pin_set");
  for (const key of [...fd.keys()]) {
    if (/^field_(lat|lng|pin_set)_/.test(key)) fd.delete(key);
  }
  return fd;
}

function packGuidelines(form) {
  const fd = dropUnusedPins(new FormData(form));
  for (const k of ["require_insurance", "require_roster", "require_birth_certs", "require_waiver", "require_coach_cert"]) {
    fd.set(k, form.querySelector(`[name="${k}"]`)?.checked ? "true" : "false");
  }
  const ages = [...form.querySelectorAll("[name=age_group]:checked")].map((el) => el.value);
  if (ages.length) {
    fd.set("age_groups", JSON.stringify(ages));
    fd.set("ages", ages.join("/"));
  }
  if (form.querySelector("[name=age_class]")) fd.set("age_class", form.querySelector("[name=age_class]").value || "");
  if (form.querySelector("[name=age_split]")) fd.set("age_split", form.querySelector("[name=age_split]").value || "false");
  fd.set("tiebreak_explicit", "true");
  form.querySelectorAll(".tiebreak-order").forEach((list) => {
    const keys = [...list.querySelectorAll("[data-tiebreak]")].map((el) => el.value);
    if (!keys.length) return;
    if (list.dataset.pool) fd.set("pool_tiebreak_" + list.dataset.pool, keys.join(","));
    else fd.set("tiebreak_order", keys.join(","));
  });
  return fd;
}

function setupAgeFields(ev = {}) {
  const picked = (ev.age_groups && ev.age_groups.ages)
    || String(ev.ages || "").toUpperCase().match(/6U|8U|10U|11U|12U|14U|16U|18U/g)
    || ["10U"];
  const klass = ev.age_class || (ev.age_groups && ev.age_groups.class) || "";
  const split = ev.age_split || (ev.age_groups && ev.age_groups.split);
  const ages = ["6U", "8U", "10U", "11U", "12U", "14U", "16U", "18U"];
  return `
    <fieldset class="age-picks">
      <legend>Age groups</legend>
      <p class="muted">Check every age this weekend hosts. Combining 11U and 12U-C stays one division. The host does not invent a pool per age — you name pools when teams sign up.</p>
      <div class="age-checks">
        ${ages.map((a) => `<label class="check"><input type="checkbox" name="age_group" value="${a}" ${picked.includes(a) ? "checked" : ""}> ${a}</label>`).join("")}
      </div>
      <div class="form-grid two">
        <label>Class
          <select name="age_class">
            <option value="" ${!klass ? "selected" : ""}>No class</option>
            ${["A", "B", "C"].map((c) => `<option value="${c}" ${String(klass).toUpperCase() === c ? "selected" : ""}>${c}</option>`).join("")}
          </select>
        </label>
        <label>Divisions
          <select name="age_split">
            <option value="false" ${!split ? "selected" : ""}>Combine into one division</option>
            <option value="true" ${split ? "selected" : ""}>Split each age (you still name the pools)</option>
          </select>
        </label>
      </div>
    </fieldset>`;
}

const TIEBREAK_OPTS = [
  ["record", "Record (win% — a tie counts as half)"],
  ["h2h", "Head-to-head (2-team ties, or a finished group)"],
  ["ra", "Fewest runs allowed"],
  ["diff", "Run differential"],
  ["rs", "Most runs scored"],
];

function tiebreakItem(key, i, total) {
  const label = TIEBREAK_OPTS.find((row) => row[0] === key)?.[1] || key;
  return `<li>
    <input type="hidden" data-tiebreak value="${escapeHtml(key)}">
    <span class="tb-n">${i + 1}.</span>
    <span>${escapeHtml(label)}</span>
    <button type="button" class="btn ghost tb-up"${i === 0 ? " disabled" : ""}>Up</button>
    <button type="button" class="btn ghost tb-down"${i === total - 1 ? " disabled" : ""}>Down</button>
    <button type="button" class="btn ghost tb-remove">Remove</button>
  </li>`;
}

function tiebreakListMarkup(order, pool) {
  const keys = order && order.length ? order : ["record", "h2h", "ra", "diff", "rs"];
  const unused = TIEBREAK_OPTS.filter((row) => !keys.includes(row[0]));
  return `
    <ol class="tiebreak-order" ${pool ? `data-pool="${escapeHtml(pool)}" id="tiebreak-order-${escapeHtml(pool)}"` : `id="tiebreak-order"`}>
      ${keys.map((key, i) => tiebreakItem(key, i, keys.length)).join("")}
    </ol>
    <div class="tb-add">
      <select data-tb-add>
        <option value="">Add a step</option>
        ${unused.map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join("")}
      </select>
    </div>
    <div class="tb-presets">
      <button type="button" class="btn ghost" data-tb-preset="record,h2h,ra,diff,rs">Standard</button>
      <button type="button" class="btn ghost" data-tb-preset="h2h,record,ra,diff,rs">Head to head first</button>
      <button type="button" class="btn ghost" data-tb-preset="record,ra,diff,rs,h2h">Runs first</button>
    </div>`;
}

function setupTiebreakFields(ev = {}) {
  const order = (ev.tiebreak && ev.tiebreak.order) || ["record", "h2h", "ra", "diff", "rs"];
  const pools = ev.pools || [];
  return `
    <details class="setup-block" open>
      <summary>Pool tiebreak order</summary>
      <p class="muted">Default for every pool: record (tie = half), then head-to-head, then fewest runs allowed, then run differential, then most runs scored. Remove a step if this weekend does not use it. Head-to-head is still skipped on a 3-team cycle or when the tied teams have not all played each other.</p>
      ${tiebreakListMarkup(order)}
      ${pools.length ? `<div class="pool-tiebreaks">${pools.map((p) => `
        <details class="setup-block">
          <summary>Pool ${escapeHtml(p.name)} — own order</summary>
          ${tiebreakListMarkup((p.tiebreak && p.tiebreak.order) || order, p.name)}
        </details>`).join("")}</div>` : ""}
    </details>`;
}

function bindTiebreakOrder(root) {
  const paint = (list) => {
    const used = [...list.querySelectorAll("[data-tiebreak]")].map((el) => el.value);
    [...list.children].forEach((el, i) => {
      const n = el.querySelector(".tb-n");
      if (n) n.textContent = (i + 1) + ".";
      const up = el.querySelector(".tb-up");
      const down = el.querySelector(".tb-down");
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === list.children.length - 1;
    });
    const add = list.parentElement?.querySelector("[data-tb-add]");
    if (add) {
      const unused = TIEBREAK_OPTS.filter((row) => !used.includes(row[0]));
      add.innerHTML = `<option value="">Add a step</option>` + unused.map(([k, l]) => `<option value="${k}">${l}</option>`).join("");
    }
  };
  root.querySelectorAll(".tiebreak-order").forEach((list) => {
    paint(list);
    list.addEventListener("click", (evnt) => {
      const li = evnt.target.closest("li");
      if (!li) return;
      if (evnt.target.classList.contains("tb-up") && li.previousElementSibling) {
        li.parentNode.insertBefore(li, li.previousElementSibling);
      }
      if (evnt.target.classList.contains("tb-down") && li.nextElementSibling) {
        li.parentNode.insertBefore(li.nextElementSibling, li);
      }
      if (evnt.target.classList.contains("tb-remove") && list.children.length > 1) {
        li.remove();
      }
      paint(list);
    });
    list.parentElement?.querySelector("[data-tb-add]")?.addEventListener("change", (evnt) => {
      const key = evnt.target.value;
      if (!key) return;
      list.insertAdjacentHTML("beforeend", tiebreakItem(key, list.children.length, list.children.length + 1));
      evnt.target.value = "";
      paint(list);
    });
    list.parentElement?.querySelectorAll("[data-tb-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const keys = String(btn.dataset.tbPreset || "").split(",").filter(Boolean);
        list.innerHTML = keys.map((key, i) => tiebreakItem(key, i, keys.length)).join("");
        paint(list);
      });
    });
  });
}

export async function directorNative() {
  if (!directorGate()) return;
  const existing = new URLSearchParams(location.search).get("event") || "";
  let ev = { format: "pool-to-bracket", age_groups: { ages: ["10U"] } };
  let fields = [{}];
  let photos = [];
  if (existing) {
    try {
      const plan = await fetch("/api/events/" + encodeURIComponent(existing) + "/plan", {
        headers: authHeader(),
      }).then((r) => { if (!r.ok) throw new Error("not found"); return r.json(); });
      ev = plan.event;
      fields = plan.fields && plan.fields.length ? plan.fields : [{}];
      photos = plan.photos || [];
    } catch (err) {}
  }
  eventRoot().innerHTML = eventChrome(ev.slug ? ev : null, "create", `
    <section class="page-head">
      <h1>${ev.slug ? "Add the field map" : "Run it on this site"}</h1>
      <p class="muted">${ev.slug
        ? "Upload the complex map, entrance, or parking photo here. Fields and facilities only, please — no photos of players."
        : "Name the weekend, then open the sections you need. Insurance and roster are on by default. Field maps upload on this same page after you open signup."}</p>
    </section>
    <section class="card">
      <form class="form wide" id="native-form">
        <label>Tournament name <input name="name" required placeholder="Labor Day Classic" value="${escapeHtml(ev.name || "")}"></label>
        ${setupAgeFields(ev.age_groups ? ev : { age_groups: { ages: ["10U"] } })}
        <label>Slug (optional) <input name="slug" placeholder="labor-day-classic" value="${escapeHtml(ev.slug || "")}"></label>
        ${setupLocationFields(ev, fields, photos)}
        ${setupGuidelinesFields(ev.slug ? ev : { require_insurance: true, require_roster: true })}
        ${ev.slug
          ? `<p class="actions"><a class="btn" data-link href="/t/${escapeHtml(ev.slug)}/admin">Continue to the admin desk</a></p>`
          : `<button class="btn" type="submit">Open signup</button>`}
        <p class="error" id="native-err" hidden></p>
      </form>
    </section>`);
  bindFieldRows(eventRoot(), Math.max(fields.length, 1), ev);
  bindTiebreakOrder(eventRoot());
  if (ev.slug) bindVenuePhotos(ev.slug, photos, (err) => {
    const box = document.getElementById("native-err");
    if (!box) return;
    box.hidden = false;
    box.textContent = err.message || String(err);
  });
  document.getElementById("native-form")?.addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    if (ev.slug) return;
    const fd = packGuidelines(evnt.target);
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
    flashSaved("Tournament saved — add the field map below");
    goEvent("/directors/new?event=" + encodeURIComponent(out.event.slug));
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
        <label>Name override (optional) <input name="name" placeholder="Public page title if blank"></label>
        ${setupAgeFields({ age_groups: { ages: ["10U"] } })}
        ${setupLocationFields({ format: "pool-to-bracket" })}
        ${setupGuidelinesFields({ require_insurance: true, require_roster: true })}
        <button class="btn" type="submit">Link and open signup</button>
        <p class="error" id="tm-err" hidden></p>
      </form>
    </section>`);
  bindFieldRows(eventRoot(), 1, {});
  bindTiebreakOrder(eventRoot());
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
    flashSaved("Tournament saved");
    goEvent("/t/" + out.event.slug + "/admin");
  });
}

export async function directorDuplicate() {
  if (!directorGate()) return;
  const events = await eventPb.collection("events").getFullList({ filter: "public=true && status!='archived'", sort: "-start" });
  eventRoot().innerHTML = eventChrome(null, "create", `
    <section class="page-head">
      <h1>Duplicate a tournament</h1>
      <p class="muted">Copies fields, clubs, and the unpaid schedule. Scores, box files, packets, and family emails stay on the original.</p>
    </section>
    <section class="card">
      <form class="form wide" id="dup-form">
        <label>Copy from
          <select name="source" required>
            <option value="">Choose a weekend</option>
            ${events.map((row) => `<option value="${escapeHtml(row.slug)}"${row.slug === new URLSearchParams(location.search).get("from") ? " selected" : ""}>${escapeHtml(row.name)}</option>`).join("")}
          </select>
        </label>
        <div class="form-grid two">
          <label>New name <input name="name" required placeholder="Harbor Eight 2027"></label>
          <label>New slug (optional) <input name="slug" placeholder="harbor-eight-2027"></label>
          <label>First day <input name="start" type="date"></label>
          <label>Last day <input name="end" type="date"></label>
        </div>
        <button class="btn" type="submit">Duplicate weekend</button>
        <p class="error" id="dup-err" hidden></p>
      </form>
    </section>`);
  document.getElementById("dup-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const fd = new FormData(evnt.target);
    const source = String(fd.get("source") || "");
    if (!source) return;
    const res = await fetch("/api/events/" + encodeURIComponent(source) + "/duplicate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        name: fd.get("name"),
        slug: fd.get("slug"),
        start: fd.get("start"),
        end: fd.get("end"),
      }),
    });
    if (!res.ok) {
      document.getElementById("dup-err").hidden = false;
      document.getElementById("dup-err").textContent = await res.text();
      return;
    }
    const out = await res.json();
    flashSaved("Tournament copied");
    goEvent("/t/" + out.event.slug + "/admin");
  });
}

export async function eventSignup(slug) {
  const roster = await fetch("/api/events/" + encodeURIComponent(slug) + "/roster").then((r) => {
    if (!r.ok) throw new Error("Event not found");
    return r.json();
  });
  const ev = roster.event;
  rememberEvent(ev);
  const director = isDirector(ev);
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
        <label>Contact phone <input name="coach_phone" type="text" inputmode="tel" placeholder="412-555-0100"></label>
        <label>Age group
          <select name="age_group">
            <option value="">—</option>
            ${["6U", "8U", "10U", "11U", "12U", "14U", "16U", "18U"].map((a) => `<option value="${a}">${a}</option>`).join("")}
          </select>
        </label>
        <fieldset class="setup-block">
          <legend>Second contact (optional)</legend>
          <p class="muted">Whoever registers is often not the person in the dugout Saturday.</p>
          <label>Name <input name="alt_name"></label>
          <label>Email <input name="alt_email" type="email"></label>
          <label>Phone <input name="alt_phone" type="text" inputmode="tel"></label>
        </fieldset>
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
    ${rosterBlock(roster.teams, ev.slug)}
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
    const saved = await res.json();
    const mail = saved.team && saved.team.mail;
    flashSaved(mail && !mail.sent
      ? "Team saved. Confirmation email was not sent (" + (mail.reason || "SMTP is not configured") + ")."
      : "Team saved");
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

function boxWaiting(box) {
  const status = box && box.status;
  return status === "queued" || status === "submitted" || status === "needs_review";
}

function approveStatsButtons(boxId) {
  if (!boxId) return "";
  return `<div class="actions approve-stats-actions">
    <button class="btn" type="button" data-box-review="${escapeHtml(boxId)}" data-box-status="approved">Approve stats</button>
    <button class="btn ghost" type="button" data-box-review="${escapeHtml(boxId)}" data-box-status="rejected">Reject</button>
  </div>`;
}

function bindBoxReview(slug, reload, showErr) {
  eventRoot().querySelectorAll("[data-box-review]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await adminPost(slug, "/boxes/" + btn.dataset.boxReview + "/review", { status: btn.dataset.boxStatus });
        flashSaved(btn.dataset.boxStatus === "approved" ? "Box approved" : "Box rejected");
        reload();
      } catch (err) {
        btn.disabled = false;
        if (showErr) showErr(err);
        else {
          const box = document.getElementById("score-err") || document.getElementById("admin-err");
          if (box) {
            box.hidden = false;
            box.textContent = err.message || String(err);
          }
        }
      }
    });
  });
}

async function directorApproveBanner(slug, ev) {
  if (!isDirector(ev)) return "";
  try {
    const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/plan", { headers: authHeader() });
    if (!res.ok) return "";
    const plan = await res.json();
    const n = (plan.pending_boxes || []).filter(boxWaiting).length;
    if (!n) return "";
    return `<section class="card approve-banner">
      <h2>Approve stats</h2>
      <p class="muted">${n} box${n === 1 ? "" : "es"} waiting. The public Stats tab only shows published lines. Approve is on the director desk.</p>
      <div class="actions">
        <a class="btn" data-link href="/t/${escapeHtml(slug)}/admin#admin-stats">Open approve list</a>
      </div>
    </section>`;
  } catch (err) {
    return "";
  }
}

function adminPaneFromHash() {
  const id = String(location.hash || "").replace(/^#admin-/, "");
  const allowed = ["overview", "setup", "venue", "scheduler", "rain", "teams", "stats", "boxes", "assist"];
  return allowed.includes(id) ? id : "overview";
}

function bindAdminRail(root) {
  const setPane = (id, opts = {}) => {
    const pane = ["overview", "setup", "venue", "scheduler", "rain", "teams", "stats", "boxes", "assist"].includes(id) ? id : "overview";
    root.querySelectorAll("[data-admin-pane]").forEach((el) => {
      el.hidden = el.dataset.adminPane !== pane;
    });
    root.querySelectorAll("[data-admin-go]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.adminGo === pane);
    });
    const sel = root.querySelector("#admin-desk-select");
    if (sel && sel.value !== pane) sel.value = pane;
    const next = "#admin-" + pane;
    if (location.hash !== next) history.replaceState({}, "", location.pathname + next);
    if (opts.scroll) {
      root.querySelector(`[data-admin-pane="${pane}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  };
  root.querySelectorAll("[data-admin-go]").forEach((btn) => {
    btn.addEventListener("click", () => setPane(btn.dataset.adminGo, { scroll: true }));
  });
  root.querySelector("#admin-desk-select")?.addEventListener("change", (evnt) => {
    setPane(evnt.target.value, { scroll: true });
  });
  setPane(adminPaneFromHash());
}

function bindVenuePhotos(slug, photos, showErr) {
  const form = document.getElementById("photo-form");
  if (form) {
    form.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      try {
        const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/photos", {
          method: "POST",
          headers: { ...authHeader() },
          body: new FormData(evnt.target),
        });
        if (!res.ok) throw new Error(await res.text());
        flashSaved("Photo queued for review");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  }
  eventRoot().querySelectorAll("[data-photo-pub]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/photos/" + encodeURIComponent(btn.dataset.photoPub) + "/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ public: btn.dataset.public !== "false" }),
        });
        if (!res.ok) throw new Error(await res.text());
        flashSaved(btn.dataset.public === "false" ? "Photo unpublished" : "Photo published");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
  eventRoot().querySelectorAll("[data-photo-up]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ids = [...eventRoot().querySelectorAll("#photo-review [data-photo-id]")].map((el) => el.dataset.photoId);
      const i = ids.indexOf(btn.dataset.photoUp);
      if (i < 1) return;
      [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
      try {
        const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/photos/reorder", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error(await res.text());
        flashSaved("Photo order saved");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
}

function scheduleImportDesk() {
  return `
    <details class="setup-block" id="schedule-import">
      <summary>Import a schedule CSV</summary>
      <p class="muted">Paste or upload the grid you already have. Games land on this tournament only. This does not create a new weekend.</p>
      <form class="form wide" id="import-schedule-form">
        <label>Spreadsheet file <input name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"></label>
        <label>Or paste rows <textarea name="csv" rows="6" placeholder="date,time,home,away,pool,field"></textarea></label>
        <label class="check"><input type="checkbox" name="replace"> Replace existing pool games on this weekend</label>
        <button class="btn" type="submit">Import onto this tournament</button>
      </form>
    </details>`;
}

function bracketImportDesk() {
  return `
    <details class="setup-block" id="bracket-import">
      <summary>Import a bracket CSV</summary>
      <p class="muted">Second route next to drawing from standings. Paste the tree you already have — round, slot, side, and winner_to / loser_to. Home and away may be a registered team, seed:3, winner:B1, or loser:B5. Unmatched names are flagged and never created. Final games stay on re-import. Nothing writes until you confirm the preview.</p>
      <p><a href="/templates/diamond-tourney-bracket.csv" download>Download a bracket CSV template</a></p>
      <form class="form wide" id="import-bracket-form">
        <label>Spreadsheet file <input name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"></label>
        <label>Or paste rows <textarea name="csv" rows="6" placeholder="game,round,side,date,time,field,home,away,winner_to,loser_to"></textarea></label>
        <label class="check"><input type="checkbox" name="replace"> Replace unplayed bracket games that are not in this file</label>
        <button type="button" class="btn" id="import-bracket-preview-btn">Detect columns</button>
      </form>
      <div id="import-bk-map" hidden></div>
      <div id="import-bk-preview" hidden></div>
    </details>`;
}

function teamImportDesk() {
  return `
    <details class="setup-block" id="team-import">
      <summary>Import teams from a spreadsheet</summary>
      <p class="muted">Google Forms CSV, Excel saved as CSV, or paste from Excel. Map columns once — we remember your mapping on this login. Re-import matches coach email, then team name, so the same file does not create duplicates. Phone stays text so leading zeros survive.</p>
      <p><a href="/templates/diamond-tourney-team-signup.csv" download>Download a Google Form / Excel template</a></p>
      <form class="form wide" id="import-teams-form">
        <label>Spreadsheet file <input name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"></label>
        <label>Or paste rows <textarea name="csv" rows="6" placeholder="Team Name,Coach Email,Coach Phone,..."></textarea></label>
        <button type="button" class="btn" id="import-preview-btn">Detect columns</button>
      </form>
      <div id="import-map" hidden></div>
      <div id="import-preview" hidden></div>
    </details>`;
}

function importFieldOptions(fields, selected) {
  return `<option value="">— skip —</option>` + fields.map((f) =>
    `<option value="${escapeHtml(f.key)}" ${selected === f.key ? "selected" : ""}>${escapeHtml(f.label)}${f.required ? " (required)" : ""}</option>`
  ).join("");
}

function customBracketDesk(ev, teams, games) {
  const locked = (g) => g.status === "final";
  const rows = (games || []).map((g) => `<tr data-bk-custom="${escapeHtml(g.id || "")}">
    <td data-th="Flight">${flightSelect(g.flight || "", locked(g))}</td>
    <td data-th="Round">${roundSelect(g.round || "QF", locked(g))}</td>
    <td data-th="Slot"><input name="slot" type="number" min="1" value="${escapeHtml(String(g.slot || 1))}" style="width:4rem" ${locked(g) ? "readonly" : ""}></td>
    <td data-th="Side"><select name="side" ${locked(g) ? "disabled" : ""}>
      ${[["championship", "Championship"], ["losers", "Losers"], ["consolation", "Consolation"]].map(([v, l]) =>
        `<option value="${v}" ${gameSide(g) === v || g.side === v ? "selected" : ""}>${l}</option>`).join("")}
    </select></td>
    <td data-th="Home">${teamSelect(teams, "home_id", g.home_id, { disabled: locked(g) })}</td>
    <td data-th="Away">${teamSelect(teams, "away_id", g.away_id, { disabled: locked(g) })}</td>
    <td data-th="">${locked(g) ? "Final" : `<label class="check"><input type="checkbox" name="delete"> Remove</label>`}</td>
  </tr>`).join("");
  return `
    <h3>Custom bracket builder</h3>
    <p class="muted">Home and away are the registered teams only. Finals stay. Flight is gold, silver, platinum, or one tree.</p>
    <form class="form wide" id="custom-bracket-form">
      <div class="table-wrap"><table class="card-table sched-edit">
        <thead><tr><th>Flight</th><th>Round</th><th>Slot</th><th>Side</th><th>Home</th><th>Away</th><th></th></tr></thead>
        <tbody id="custom-bracket-rows">${rows || ""}</tbody>
      </table></div>
      <div class="actions">
        <button class="btn ghost" type="button" id="add-bracket-slot">Add game</button>
        <button class="btn" type="submit">Save custom bracket</button>
      </div>
    </form>
    <template id="custom-bracket-row">${`<tr data-bk-custom="">
      <td data-th="Flight">${flightSelect("", false)}</td>
      <td data-th="Round">${roundSelect("QF", false)}</td>
      <td data-th="Slot"><input name="slot" type="number" min="1" value="1" style="width:4rem"></td>
      <td data-th="Side"><select name="side">
        <option value="championship">Championship</option>
        <option value="losers">Losers</option>
        <option value="consolation">Consolation</option>
      </select></td>
      <td data-th="Home">${teamSelect(teams, "home_id", "")}</td>
      <td data-th="Away">${teamSelect(teams, "away_id", "")}</td>
      <td data-th=""><label class="check"><input type="checkbox" name="delete"> Remove</label></td>
    </tr>`}</template>
  `;
}

function bindCustomBracket(slug, showErr) {
  const form = document.getElementById("custom-bracket-form");
  if (!form) return;
  document.getElementById("add-bracket-slot")?.addEventListener("click", () => {
    const tpl = document.getElementById("custom-bracket-row");
    const box = document.getElementById("custom-bracket-rows");
    if (!tpl || !box) return;
    box.insertAdjacentHTML("beforeend", tpl.innerHTML);
  });
  form.addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const games = [];
    const delete_ids = [];
    form.querySelectorAll("[data-bk-custom]").forEach((tr) => {
      const id = tr.dataset.bkCustom || "";
      if (tr.querySelector("[name=delete]")?.checked) {
        if (id) delete_ids.push(id);
        return;
      }
      games.push({
        id,
        flight: tr.querySelector("[name=flight]")?.value || "",
        round: tr.querySelector("[name=round]")?.value || "QF",
        slot: Number(tr.querySelector("[name=slot]")?.value || 1),
        side: tr.querySelector("[name=side]")?.value || "championship",
        home_id: tr.querySelector("[name=home_id]")?.value || "",
        away_id: tr.querySelector("[name=away_id]")?.value || "",
      });
    });
    try {
      const out = await adminPost(slug, "/bracket/custom", { games, delete_ids });
      flashSaved("Custom bracket saved · " + (out.updated || 0) + " games");
      location.reload();
    } catch (err) {
      showErr(err);
    }
  });
}

function bindContactEdits(slug, showErr) {
  document.querySelectorAll("[data-edit-contact]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = document.querySelector(`[data-contact-edit="${btn.dataset.editContact}"]`);
      if (row) row.hidden = !row.hidden;
    });
  });
  document.querySelectorAll("[data-team-form]").forEach((form) => {
    form.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      body.paid = fd.get("paid") === "on";
      try {
        await adminPost(slug, "/teams/" + form.dataset.teamForm, body);
        flashSaved("Team saved");
        location.reload();
      } catch (err) {
        showErr(err);
      }
    });
  });
  document.querySelectorAll("[data-remove-team]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this team from the weekend? Unplayed games are deleted. A team with a final score stays on the board.")) return;
      try {
        await adminPost(slug, "/teams/" + btn.dataset.removeTeam + "/remove", {});
        flashSaved("Team removed");
        location.reload();
      } catch (err) {
        showErr(err);
      }
    });
  });
}

async function readImportText(form) {
  const pasted = String(form.csv.value || "").trim();
  const file = form.file.files && form.file.files[0];
  if (!file) return pasted;
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    throw new Error("Save the Excel file as CSV (File → Save As → CSV) and upload that. Pasting from Excel also works.");
  }
  const text = await file.text();
  return text || pasted;
}

function renderImportMap(data) {
  const box = document.getElementById("import-map");
  box.hidden = false;
  box.innerHTML = `
    <h3>Match columns</h3>
    <p class="muted">${data.remembered ? "Using the mapping saved on this login." : "Guessed from the header names. Change any that look wrong."}</p>
    <div class="import-map">${data.headers.map((h) => `<label>${escapeHtml(h)}
      <select data-map-header="${escapeHtml(h)}">${importFieldOptions(data.fields, data.mapping[h] || "")}</select>
    </label>`).join("")}</div>
    <p class="muted">Sample rows</p>
    <div class="table-wrap"><table><thead><tr>${data.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${(data.samples || []).map((row) => `<tr>${data.headers.map((h) => `<td>${escapeHtml(row[h] || "")}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <button type="button" class="btn" id="import-apply-map">Preview what will be created</button>`;
}

function renderImportPreview(data) {
  const box = document.getElementById("import-preview");
  const c = data.counts || {};
  box.hidden = false;
  box.innerHTML = `
    <h3>Preview</h3>
    <p><b>${c.new || 0} new</b>, ${c.exists || 0} already present, ${c.problems || 0} rows with problems. Nothing is written until you confirm.</p>
    <label class="check"><input type="checkbox" id="import-update-existing"> Update already-present teams instead of skipping them</label>
    <div class="table-wrap"><table><thead><tr><th>Row</th><th>Team</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
      <tbody>${(data.rows || []).map((r) => `<tr>
        <td>${r.line}</td>
        <td>${escapeHtml(r.name || "")}</td>
        <td>${escapeHtml(r.coach_email || "")}</td>
        <td>${escapeHtml(r.coach_phone || "")}</td>
        <td>${r.status === "problem" ? `<span class="badge l">${escapeHtml((r.problems || []).join("; ") || "problem")}</span>`
          : r.status === "exists" ? `<span class="badge">${escapeHtml(r.match === "email" ? "match email" : "match name")}</span>`
          : `<span class="badge w">new</span>`}</td>
      </tr>`).join("")}</tbody></table></div>
    <button type="button" class="btn" id="import-commit-btn">Import ${c.new || 0} new team${(c.new || 0) === 1 ? "" : "s"}</button>`;
}

function currentImportMapping() {
  const mapping = {};
  document.querySelectorAll("[data-map-header]").forEach((sel) => {
    mapping[sel.dataset.mapHeader] = sel.value || "";
  });
  return mapping;
}

function currentBracketMapping() {
  const mapping = {};
  document.querySelectorAll("[data-bk-map-header]").forEach((sel) => {
    mapping[sel.dataset.bkMapHeader] = sel.value || "";
  });
  return mapping;
}

function renderBracketMap(data) {
  const box = document.getElementById("import-bk-map");
  if (!box) return;
  box.hidden = false;
  box.innerHTML = `
    <h3>Match bracket columns</h3>
    <p class="muted">${data.remembered ? "Using the mapping saved on this login." : "Guessed from the header names."}</p>
    <div class="import-map">${data.headers.map((h) => `<label>${escapeHtml(h)}
      <select data-bk-map-header="${escapeHtml(h)}">${importFieldOptions(data.fields, data.mapping[h] || "")}</select>
    </label>`).join("")}</div>
    <button type="button" class="btn" id="import-bk-apply-map">Preview what will be created</button>`;
}

function renderBracketPreview(data) {
  const box = document.getElementById("import-bk-preview");
  if (!box) return;
  const c = data.counts || {};
  box.hidden = false;
  box.innerHTML = `
    <h3>Preview</h3>
    <p><b>${c.new || 0} new</b>, ${c.exists || 0} already present, ${c.kept || 0} finals kept, ${c.problems || 0} rows with problems. Nothing is written until you confirm.</p>
    ${(data.warnings || []).map((w) => `<p class="muted">${escapeHtml(w)}</p>`).join("")}
    <div class="table-wrap"><table><thead><tr><th>Game</th><th>Round</th><th>Home</th><th>Away</th><th>Winner to</th><th>Status</th></tr></thead>
      <tbody>${(data.rows || []).map((r) => `<tr>
        <td>${escapeHtml(r.game || "")}</td>
        <td>${escapeHtml(r.round || "")}</td>
        <td>${escapeHtml(r.home || r.home_ref || "TBD")}</td>
        <td>${escapeHtml(r.away || r.away_ref || "TBD")}</td>
        <td>${escapeHtml(r.winner_to || "—")}</td>
        <td>${r.status === "problem" ? `<span class="badge l">${escapeHtml((r.problems || []).join("; ") || "problem")}</span>`
          : r.status === "kept" ? `<span class="badge">final kept</span>`
          : r.status === "exists" ? `<span class="badge">update slot</span>`
          : `<span class="badge w">new</span>`}</td>
      </tr>`).join("")}</tbody></table></div>
    <button type="button" class="btn" id="import-bk-commit-btn" ${(c.problems || 0) ? "disabled" : ""}>Import ${c.new || 0} bracket game${(c.new || 0) === 1 ? "" : "s"}</button>`;
}

function bindBracketImport(slug, showErr) {
  const form = document.getElementById("import-bracket-form");
  if (!form) return;
  const previewBtn = document.getElementById("import-bracket-preview-btn");
  const runPreview = async (withMap) => {
    try {
      const csv = await readImportText(form);
      if (!csv) throw new Error("Choose a CSV or paste rows.");
      const body = { csv };
      if (withMap) body.mapping = currentBracketMapping();
      const data = await adminPost(slug, "/import-bracket/preview", body);
      renderBracketMap(data);
      if (withMap || (data.mapping && Object.values(data.mapping).includes("game"))) {
        renderBracketPreview(data);
      }
      const apply = document.getElementById("import-bk-apply-map");
      if (apply) apply.onclick = () => runPreview(true);
      const commit = document.getElementById("import-bk-commit-btn");
      if (commit) {
        commit.onclick = async () => {
          try {
            const result = await adminPost(slug, "/import-bracket", {
              csv,
              mapping: currentBracketMapping(),
              replace: form.replace?.checked === true,
            });
            const n = result.counts || {};
            flashSaved(`${n.new || 0} imported, ${n.updated || 0} updated, ${n.kept || 0} finals kept`);
            location.reload();
          } catch (err) {
            showErr(err);
          }
        };
      }
    } catch (err) {
      showErr(err);
    }
  };
  previewBtn?.addEventListener("click", () => runPreview(false));
}

function bindScheduleImport(slug, showErr) {
  const form = document.getElementById("import-schedule-form");
  if (!form) return;
  form.addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    try {
      const csv = await readImportText(form);
      if (!csv) throw new Error("Choose a CSV or paste rows.");
      const out = await adminPost(slug, "/schedule/import", {
        csv,
        replace: form.replace?.checked === true,
      });
      flashSaved("Schedule imported · " + (out.imported || 0) + " games on this tournament");
      eventAdmin(slug);
    } catch (err) {
      showErr(err);
    }
  });
}

function bindTeamImport(slug, showErr) {
  const form = document.getElementById("import-teams-form");
  if (!form) return;
  const previewBtn = document.getElementById("import-preview-btn");
  const runPreview = async (withMap) => {
    try {
      const csv = await readImportText(form);
      if (!csv) throw new Error("Choose a CSV or paste rows.");
      const body = { csv };
      if (withMap) body.mapping = currentImportMapping();
      const data = await adminPost(slug, "/import-teams/preview", body);
      renderImportMap(data);
      if (withMap || data.mapping && Object.values(data.mapping).includes("name")) {
        renderImportPreview(data);
      }
      const apply = document.getElementById("import-apply-map");
      if (apply) apply.onclick = () => runPreview(true);
      const commit = document.getElementById("import-commit-btn");
      if (commit) {
        commit.onclick = async () => {
          try {
            const result = await adminPost(slug, "/import-teams", {
              csv,
              mapping: currentImportMapping(),
              on_match: document.getElementById("import-update-existing")?.checked ? "update" : "skip",
            });
            const n = result.counts || {};
            flashSaved(`${n.new || 0} new, ${n.updated || 0} updated, ${n.skipped || 0} skipped`);
            location.reload();
          } catch (err) {
            showErr(err);
          }
        };
      }
    } catch (err) {
      showErr(err);
    }
  };
  previewBtn.addEventListener("click", () => runPreview(false));
}

function venuePhotoDesk(slug, photos) {
  const rows = photos || [];
  return `
    <div class="venue-photo-desk">
      <h3>Field and parking photos</h3>
      <p class="muted">Fields and facilities only, please — no photos of players. Photos stay unpublished until you review and publish. The first published photo is the public header. GPS / EXIF is stripped on upload. JPG, PNG, WebP, HEIC, or PDF. 5 MB cap — the volume on Fly keeps files across redeploys.</p>
      <form class="form wide" id="photo-form">
        <label>Photo or map <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf" required></label>
        <label>Caption <input name="caption" maxlength="200" placeholder="East lot off Meadow St"></label>
        <label>Kind
          <select name="kind">
            <option value="entrance">Entrance</option>
            <option value="parking">Parking</option>
            <option value="layout">Layout</option>
            <option value="field" selected>Field</option>
            <option value="other">Other</option>
          </select>
        </label>
        <button class="btn" type="submit">Upload for review</button>
      </form>
      ${rows.length ? `<ol class="photo-review" id="photo-review">${rows.map((p, i) => `<li data-photo-id="${escapeHtml(p.id)}">
        ${p.url ? `<img src="${escapeHtml(p.url)}" alt="">` : ""}
        <div>
          <b>${escapeHtml(p.caption || p.kind || "Photo")}</b>
          <span class="badge ${p.public ? "approved" : "incomplete"}">${p.public ? "published" : "unpublished"}</span>
        </div>
        <button type="button" class="btn ghost" data-photo-pub="${escapeHtml(p.id)}" data-public="${p.public ? "false" : "true"}">${p.public ? "Unpublish" : "Publish"}</button>
        ${i ? `<button type="button" class="btn ghost" data-photo-up="${escapeHtml(p.id)}">Earlier</button>` : ""}
      </li>`).join("")}</ol>` : `<p class="empty">No field photos yet.</p>`}
    </div>`;
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
  currentEvent = ev;
  if (!canAdminEvent(eventPb.authStore.record, ev)) {
    eventRoot().innerHTML = eventChrome(ev, "admin", `
      <section class="card">
        <h2>This is not your tournament</h2>
        <p>Only the owner, a listed co-owner, or a site admin can open the desk.</p>
        <p><a class="btn" data-link href="/t/${escapeHtml(ev.slug)}">Open the public board</a></p>
      </section>`);
    return;
  }
  const fields = plan.fields || ev.fields || [];
  const games = (plan.schedule || []).slice().sort(compareGames);
  const teams = plan.teams || [];
  const docToken = await fileToken();
  const showErr = async (err) => {
    const box = document.getElementById("admin-err");
    box.hidden = false;
    box.textContent = err.message || String(err);
  };
  const fieldOpts = fields.map((f) => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join("");
  const pending = plan.pending_boxes || [];
  let desk = { games: [] };
  try {
    const deskRes = await fetch("/api/events/" + encodeURIComponent(slug) + "/boxes/desk", { headers: authHeader() });
    if (deskRes.ok) desk = await deskRes.json();
  } catch (err) { desk = { games: [] }; }
  const boxGames = desk.games || [];
  const conflictN = boxGames.filter((g) => g.book_state === "conflict").length;
  const openBooks = boxGames.filter((g) => g.book_state !== "verified").length;
  const rainOn = ev.rain_status && ev.rain_status !== "clear";
  const rail = [
    ["overview", "Overview", ""],
    ["setup", "Tournament setup", ""],
    ["venue", "Venue setups", fields.length ? String(fields.length) : ""],
    ["scheduler", "Scheduler", games.length ? String(games.length) : ""],
    ["rain", "Rain notice", rainOn ? ev.rain_status : ""],
    ["teams", "Teams", teams.length ? String(teams.length) : ""],
    ["stats", "Approve stats", pending.length ? String(pending.length) : ""],
    ["boxes", "Box scores", conflictN ? String(conflictN) : (openBooks ? String(openBooks) : "")],
    ["assist", "Schedule fit", ""],
  ];
  eventRoot().innerHTML = eventChrome(ev, "admin", `
    <section class="page-head admin-status">
      <h1>Director desk</h1>
      <p class="muted">${ev.source === "tourneymachine" ? "Linked Tourney Machine" : ev.source === "popup" ? "Imported popup" : "Native host"} · ${escapeHtml(ev.format_label || ev.format || "format unset")} · signup ${ev.signup_open ? "open" : "closed"}</p>
      <p class="error" id="admin-err" hidden></p>
      <p class="muted" id="admin-note"></p>
    </section>
    <div class="admin-desk">
      <aside class="admin-rail" aria-label="Director sections">
        <p class="kicker">Desk</p>
        <label class="admin-desk-pick">Section
          <select id="admin-desk-select">
            ${rail.map(([id, label, badge]) =>
              `<option value="${escapeHtml(id)}">${escapeHtml(label)}${badge ? ` (${escapeHtml(badge)})` : ""}</option>`).join("")}
          </select>
        </label>
        <nav class="admin-rail-nav">
          ${rail.map(([id, label, badge]) =>
            `<button type="button" data-admin-go="${id}">${escapeHtml(label)}${badge ? ` <span class="rail-count">${escapeHtml(badge)}</span>` : ""}</button>`).join("")}
        </nav>
      </aside>
      <div class="admin-stage">
        <section class="card" data-admin-pane="overview">
          <h2>Overview</h2>
          <p class="muted">Open one section at a time. Venue and hours first, then the scheduler. Rain and team packets stay on their own desks.</p>
          ${rainBanner(ev)}
          <div class="actions">
            <button class="btn" id="sync-now" type="button">Refresh links</button>
            <button class="btn ghost" id="toggle-signup" type="button">${ev.signup_open ? "Close signup" : "Reopen signup"}</button>
            <a class="btn ghost" data-link href="/t/${ev.slug}/signup">Add a team</a>
            <a class="btn ghost" data-link href="/directors/import?into=${encodeURIComponent(ev.slug)}">Import schedule</a>
            <button class="btn ghost" id="duplicate-event" type="button">Duplicate this weekend</button>
            ${ev.source === "popup" ? `<button class="btn ghost" id="refresh-popup" type="button">Refresh from popup</button>` : ""}
          </div>
          <ul class="admin-jump">
            <li><button type="button" class="link" data-admin-go="stats">${pending.length ? `Approve stats (${pending.length} waiting)` : "Approve stats"}</button></li>
            <li><button type="button" class="link" data-admin-go="venue">Set fields and hours</button></li>
            <li><button type="button" class="link" data-admin-go="scheduler">Build the weekend grid</button></li>
            <li><button type="button" class="link" data-admin-go="rain">Post a rain notice</button></li>
            <li><button type="button" class="link" data-admin-go="teams">Review team packets</button></li>
          </ul>
          ${pending.length ? `<div class="approve-banner">
            <h3>Approve stats</h3>
            <p class="muted">${pending.length} box${pending.length === 1 ? "" : "es"} waiting. This list is here — not on the public Stats tab.</p>
            ${table(["Game", "Door", "Status", ""], pending.map((b) => {
              const waiting = boxWaiting(b);
              return `<tr>
              <td>${escapeHtml(b.game ? (b.game.home + " vs " + b.game.away) : "Game")}</td>
              <td>${escapeHtml(b.source || "")}${b.schedule_id ? ` · <a data-link href="/t/${ev.slug}/games/${b.schedule_id}">Open game</a>` : ""}</td>
              <td><span class="badge ${escapeHtml(b.status || "")}">${escapeHtml(b.status || "")}</span></td>
              <td>${waiting && b.id ? approveStatsButtons(b.id) : ""}</td>
            </tr>`;
            }))}
          </div>` : ""}
          ${isSiteAdmin(eventPb.authStore.record) ? `
          <div class="danger-zone">
            <h3>Remove this tournament</h3>
            <p class="muted">Site admin only. Remove hides it from Find. Delete erases the weekend after you type the slug.</p>
            <div class="actions">
              <button class="btn ghost" type="button" id="archive-event">Remove from Find</button>
              <a class="btn ghost" data-link href="/admin/events">All tournaments</a>
            </div>
            <form class="form wide" id="delete-event-form">
              <label>Type ${escapeHtml(ev.slug)} to delete <input name="slug" autocomplete="off"></label>
              <button class="btn danger" type="submit">Delete tournament</button>
            </form>
          </div>` : ""}
        </section>
        <section class="card" data-admin-pane="setup" hidden>
          <h2>Tournament setup</h2>
          <p class="muted">Bracket type, governing body, pitch cap, what teams must upload, and extra directors by email.</p>
          <form class="form wide" id="guide-form">
            <div class="setup-block">${setupAgeFields(ev)}</div>
            <div class="setup-block">${setupFormatFields(ev)}</div>
            ${setupGuidelinesFields(ev)}
            <button class="btn" type="submit">Save tournament setup</button>
          </form>
          ${setupCoOwners(ev)}
        </section>
        <section class="card" data-admin-pane="venue" hidden>
          <h2>Venue setups</h2>
          <p class="muted">Park, street address, park hours, then each diamond’s hours by date. A field that is closed Saturday will not get Saturday games.</p>
          <form class="form wide" id="fields-form">
            ${setupVenueFields(ev, fields.length ? fields : [{}])}
            <button class="btn" type="submit">Save venue</button>
          </form>
          ${venuePhotoDesk(slug, plan.photos || [])}
        </section>
        <section class="card" data-admin-pane="scheduler" hidden>
          <h2>Scheduler</h2>
          <p class="muted">Order of operations: set fields and hours, import or build the pool, play the games, then draw the bracket from standings. ${ev.format === "imported" || (ev.scheduler && ev.scheduler.origin === "imported")
            ? "This weekend has an imported pool grid. Drawing a bracket does not change imported pool games."
            : "A diamond is only used while it is open that day."}</p>
          ${scheduleImportDesk()}
          <form class="form wide" id="auto-form">
            <label>Format
              <select name="format">
                <option value="pool-to-bracket" ${!ev.format || ev.format === "pool-to-bracket" || ev.format === "imported" ? "selected" : ""}>Pool play, then single-elim bracket</option>
                <option value="pool-double-elim" ${ev.format === "pool-double-elim" ? "selected" : ""}>Pool play, then double-elim bracket</option>
                <option value="round-robin" ${ev.format === "round-robin" ? "selected" : ""}>Round robin</option>
                <option value="pool-only" ${ev.format === "pool-only" ? "selected" : ""}>Pool play only</option>
                <option value="single-elim" ${ev.format === "single-elim" ? "selected" : ""}>Single elimination</option>
                <option value="double-elim" ${ev.format === "double-elim" ? "selected" : ""}>Double elimination</option>
              </select>
            </label>
            <div class="form-grid two">
              <label>Days (one per line or comma) <textarea name="days" rows="2">${escapeHtml((ev.scheduler && ev.scheduler.days && ev.scheduler.days.length ? ev.scheduler.days : [ev.start, ev.end].filter(Boolean)).join("\n") || "")}</textarea></label>
              <label>Games per team in pool <input name="games_per_team" type="number" min="1" value="${escapeHtml(String((ev.scheduler && ev.scheduler.games_per_team) || 2))}"></label>
              <label>First pitch <input name="start_time" type="time" value="${escapeHtml(ev.hours_start || "08:00")}"></label>
              <label>No start after <input name="end_time" type="time" value="${escapeHtml(ev.hours_end || "18:00")}"></label>
            </div>
            <label>Bracket levels
              <select name="bracket_flights">
                <option value="none" ${!ev.bracket_flights || ev.bracket_flights === "none" ? "selected" : ""}>One bracket</option>
                <option value="gold-silver" ${ev.bracket_flights === "gold-silver" ? "selected" : ""}>Gold / Silver</option>
                <option value="platinum-gold-silver" ${ev.bracket_flights === "platinum-gold-silver" ? "selected" : ""}>Platinum / Gold / Silver</option>
              </select>
            </label>
            <p class="muted">Save the format without building games if you only need to switch pool / bracket style.</p>
            <div class="actions">
              <button class="btn ghost" id="save-scheduler-settings" type="button">Save weekend settings</button>
            </div>
            <div class="setup-block">
              <h3>Pool play</h3>
              <p class="muted">Setup-time action. Run once before the tournament. ${ev.scheduler && ev.scheduler.origin === "imported" ? "Imported games stay; this will not replace them." : ""}</p>
              <label class="check"><input type="checkbox" name="replace"${games.length || ev.format === "imported" || (ev.scheduler && ev.scheduler.origin === "imported") ? "" : " checked"}> Clear and rebuild the schedule (keeps completed games). This deletes every unplayed weekend game, not only pool pairings.</label>
              <label class="check"><input type="checkbox" name="draw_bracket"${ev.scheduler && ev.scheduler.draw_bracket ? " checked" : ""}> Also post a blank bracket now (TBD placeholders you can print for the fence before seeds are known)</label>
              <div class="actions">
                <button class="btn" type="submit">Build pool schedule</button>
                <button class="btn ghost" id="clear-schedule" type="button">Clear schedule</button>
              </div>
            </div>
            <div class="setup-block">
              <h3>Bracket</h3>
              <p class="muted">After pool play. Seeds from standings. ${games.filter((g) => g.status === "final").length ? "" : "No pool results yet. Enter scores, or use Draw empty bracket slots to post a blank bracket."}</p>
              <label class="check"><input type="checkbox" name="consolation"${!ev.scheduler || ev.scheduler.consolation !== false ? " checked" : ""}> Include consolation / placement games</label>
              <div class="actions">
                <button class="btn" id="build-bracket" type="button"${games.filter((g) => g.status === "final").length ? "" : " disabled"}>Draw bracket from standings</button>
                <button class="btn ghost" id="draw-empty-bracket" type="button">Draw empty bracket slots</button>
                <button class="btn ghost" id="clear-bracket" type="button">Clear bracket</button>
              </div>
            </div>
          </form>
          ${bracketImportDesk()}
          <h3>Games by field</h3>
          ${games.length ? table(["Game", "When", "Field", "Home", "Away", "Score", ""], games.map((g) => `<tr>
            <td>${gameNoCell(g)}</td>
            <td><input data-edit="${g.id}" name="when_date" type="date" value="${escapeHtml(g.date || "")}" style="width:auto">
                <input data-edit="${g.id}" name="when_time" type="time" value="${escapeHtml(g.time || "")}" style="width:auto"></td>
            <td><select data-edit="${g.id}" name="field">${fieldOpts.replace(`value="${escapeHtml(g.field)}"`, `value="${escapeHtml(g.field)}" selected`)}</select></td>
            <td><select data-edit="${g.id}" name="home_id" required>${teamOptions(teams, g.home_id, "Select a registered team")}</select></td>
            <td><select data-edit="${g.id}" name="away_id" required>${teamOptions(teams, g.away_id, "Select a registered team")}</select></td>
            <td><input data-edit="${g.id}" name="home_runs" type="number" min="0" value="${g.home_runs ?? ""}" style="width:4.2rem">
                <input data-edit="${g.id}" name="away_runs" type="number" min="0" value="${g.away_runs ?? ""}" style="width:4.2rem"></td>
            <td>
              <button class="btn ghost" type="button" data-save-game="${g.id}">Save</button>
              <button class="btn ghost" type="button" data-score-game="${g.id}">Final</button>
              <a data-link href="/t/${ev.slug}/games/${g.id}">Box</a>
              <button class="btn ghost" type="button" data-delete-game="${g.id}">Remove</button>
              ${escapeHtml(g.status)}
            </td>
          </tr>`), { className: "card-table sched-edit" }) : `<p class="empty">No pool games yet. Sign up teams in the same pool, then auto-schedule or add a game below.</p>`}
          <form class="form wide" id="add-game-form">
            <h3>Add one game</h3>
            <p class="muted">Home and away are the registered teams only. Type a new club on Teams or signup first.</p>
            <div class="form-grid two">
              <label>Home ${teamSelect(teams, "home_id", "", { required: true })}</label>
              <label>Away ${teamSelect(teams, "away_id", "", { required: true })}</label>
              <label>Date <input name="date" type="date" value="${dateInput(ev.start)}"></label>
              <label>Time <input name="time" type="time" value="09:00"></label>
              <label>Field
                <select name="field">${fieldOpts || `<option value="">Add a field first</option>`}</select>
              </label>
              <label>Pool ${poolSelect(teams, "")}</label>
            </div>
            <button class="btn" type="submit"${teams.length < 2 ? " disabled" : ""}>Add game</button>
          </form>
          ${customBracketDesk(ev, teams, plan.bracket || [])}
        </section>
        <section class="card" data-admin-pane="rain" hidden>
          <h2>Rain notice</h2>
          <p class="muted">Posts a public banner and emails each unique coach address when PocketBase Admin mail is configured. Failures are logged; the notice still saves.</p>
          ${rainBanner(ev)}
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
        <section class="card" data-admin-pane="teams" hidden>
          <h2>Teams</h2>
          <p class="muted">Coach email and phone stay on the director desk. Public pages never show them.</p>
          <div class="actions">
            <a class="btn" data-link href="/t/${ev.slug}/signup">Add a team</a>
          </div>
          ${teamImportDesk()}
          <h3>Roster</h3>
          <p class="muted">Edit names, pools, GameChanger links, and private contacts. Public pages never show coach email or phone.</p>
          ${table(["Team", "Pool", "GameChanger", "Coach", ""], teams.map((t) => {
            const c = t.contact || {};
            return `<tr data-team-row="${escapeHtml(t.id)}">
              <td>${teamLink(ev.slug, t.slug, t.name)}${t.age_group ? `<div class="muted">${escapeHtml(t.age_group)}${t.klass ? " " + escapeHtml(t.klass) : ""}</div>` : ""}</td>
              <td>${escapeHtml(t.pool || "—")}</td>
              <td>${t.gamechanger_url ? `<a href="${escapeHtml(t.gamechanger_url)}" target="_blank" rel="noopener">Open book</a>` : "—"}</td>
              <td>${escapeHtml(c.coach_email || t.contact_name || "—")}</td>
              <td><button type="button" class="btn ghost" data-edit-contact="${escapeHtml(t.id)}">Edit team</button></td>
            </tr>
            <tr hidden data-contact-edit="${escapeHtml(t.id)}"><td colspan="5">
              <form class="form wide contact-edit" data-team-form="${escapeHtml(t.id)}">
                <div class="form-grid two">
                  <label>Team name <input name="name" required value="${escapeHtml(t.name || "")}"></label>
                  <label>Pool <input name="pool" value="${escapeHtml(t.pool || "")}" placeholder="A"></label>
                  <label>GameChanger URL <input name="gamechanger_url" type="url" value="${escapeHtml(t.gamechanger_url || "")}" placeholder="https://web.gc.com/team/…"></label>
                  <label>Age group <input name="age_group" value="${escapeHtml(t.age_group || "")}" placeholder="10U"></label>
                  <label>Class <input name="klass" value="${escapeHtml(t.klass || "")}" placeholder="A"></label>
                  <label>Notes <input name="notes" value="${escapeHtml(t.notes || "")}"></label>
                  <label>Coach email <input name="coach_email" type="email" value="${escapeHtml(c.coach_email || "")}"></label>
                  <label>Coach phone <input name="coach_phone" type="text" inputmode="tel" value="${escapeHtml(c.coach_phone || "")}"></label>
                  <label>Second name <input name="alt_name" value="${escapeHtml(c.alt_name || "")}"></label>
                  <label>Second email <input name="alt_email" type="email" value="${escapeHtml(c.alt_email || "")}"></label>
                  <label>Second phone <input name="alt_phone" type="text" inputmode="tel" value="${escapeHtml(c.alt_phone || "")}"></label>
                </div>
                <label class="check"><input type="checkbox" name="paid"${t.paid ? " checked" : ""}> Paid</label>
                <div class="actions">
                  <button class="btn" type="submit">Save team</button>
                  <button class="btn danger" type="button" data-remove-team="${escapeHtml(t.id)}">Remove team</button>
                </div>
              </form>
            </td></tr>`;
          }))}
          <h3>Packets</h3>
          ${table(["Team", "Packet", "Missing", "Files"], teams.map((t) => {
            const p = t.packet || {};
            return `<tr>
              <td>${teamLink(ev.slug, t.slug, t.name)}</td>
              <td><span class="badge ${p.status || "incomplete"}">${escapeHtml(p.status || "incomplete")}</span></td>
              <td>${(p.missing || []).map((k) => escapeHtml(k)).join(", ") || "—"}</td>
              <td>${(p.docs || []).map((d) => `${escapeHtml(d.label)} · ${escapeHtml(d.status)}${d.url ? ` · <a href="${escapeHtml(withFileToken(d.url, docToken))}">file</a>` : ""} ${d.status !== "approved" ? `<button class="btn ghost" data-approve="${d.id}">Approve</button>` : ""}`).join("<br>") || "—"}</td>
            </tr>`;
          }))}
          ${rosterBlock(teams, ev.slug)}
        </section>
        <section class="card" data-admin-pane="stats" hidden>
          <h2>Approve stats</h2>
          <p class="muted">PDFs and public GameChanger box links waiting on a bot or on you. Approve publishes the lines. Reject leaves them off the public board. Four doors: team GC PDF, GC box URL, Grok bot POST, director PDF.</p>
          ${pending.length ? table(["Game", "Door", "Status", ""], pending.map((b) => {
            const waiting = boxWaiting(b);
            return `<tr>
            <td>${escapeHtml(b.game ? (b.game.home + " vs " + b.game.away) : "Game")}</td>
            <td>${escapeHtml(b.source || "")}${b.gc_url ? ` · <a href="${escapeHtml(b.gc_url)}" target="_blank" rel="noopener">GC</a>` : ""}${b.url ? ` · <a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">file</a>` : ""}</td>
            <td><span class="badge ${escapeHtml(b.status || "")}">${escapeHtml(b.status || "")}</span></td>
            <td>
              ${b.schedule_id ? `<a data-link href="/t/${ev.slug}/games/${b.schedule_id}">Open game</a>` : ""}
              ${waiting && b.id ? approveStatsButtons(b.id) : ""}
            </td>
          </tr>`;
          })) : `<p class="empty">Nothing queued. Managers paste a GC box URL or PDF; you can upload a director PDF from any game.</p>`}
        </section>
        <section class="card" data-admin-pane="boxes" hidden>
          <h2>Box scores</h2>
          <p class="muted">Each game has two books. Conflicts sit at the top. The first book still posts the score; a mismatch hides the public runs until you pick one.</p>
          <div class="actions">
            <button class="btn ghost" type="button" id="boxes-run">Ask coaches whose games should be over</button>
          </div>
          ${boxGames.length ? table(["Game", "Matchup", "State", "Home book", "Away book", ""], boxGames.map((g) => {
            const homeBook = (g.books || []).find((b) => b.team_id === g.home_id);
            const awayBook = (g.books || []).find((b) => b.team_id === g.away_id);
            const cell = (book, teamId) => {
              if (book && book.submitted) {
                return `${book.home_runs ?? "—"}–${book.away_runs ?? "—"} · ${escapeHtml(book.status || "")}`;
              }
              return `<button class="btn ghost" type="button" data-box-resend="${escapeHtml(g.id)}" data-team="${escapeHtml(teamId || "")}" data-kind="${escapeHtml(g.kind || "schedule")}">Resend</button>`;
            };
            const resolve = g.book_state === "conflict"
              ? `<button class="btn" type="button" data-box-pick="${escapeHtml(g.id)}" data-pick="home" data-kind="${escapeHtml(g.kind || "schedule")}">Use ${escapeHtml(g.home)} book</button>
                 <button class="btn ghost" type="button" data-box-pick="${escapeHtml(g.id)}" data-pick="away" data-kind="${escapeHtml(g.kind || "schedule")}">Use ${escapeHtml(g.away)} book</button>`
              : "";
            return `<tr>
              <td>${g.game_number ? "Game " + g.game_number : "—"}</td>
              <td>${teamLink(ev.slug, g.home_slug, g.home)} vs ${teamLink(ev.slug, g.away_slug, g.away)}</td>
              <td><span class="badge ${escapeHtml(g.book_state || "none")}">${escapeHtml(g.book_state || "none")}</span></td>
              <td>${cell(homeBook, g.home_id)}</td>
              <td>${cell(awayBook, g.away_id)}</td>
              <td>${resolve}</td>
            </tr>`;
          })) : `<p class="empty">No games on the board yet. After a game’s expected end, both coaches get a one-game upload link.</p>`}
        </section>
        <section class="card" data-admin-pane="assist" hidden>
          <h2>Schedule fit</h2>
          <p class="muted">Assistant-generated. It reads this weekend’s teams, fields, and hours. It never writes a schedule.</p>
          <div class="actions">
            <button class="btn" type="button" data-assist="fit">Will this schedule fit?</button>
            <button class="btn ghost" type="button" data-assist="lose_field">What if I lose a field?</button>
            <button class="btn ghost" type="button" data-assist="behind">How far behind am I?</button>
          </div>
          <label>Field that is down <input id="assist-field" placeholder="Field 4"></label>
          <label>Down from <input id="assist-time" type="time" value="08:00"></label>
          <div id="assist-out" class="assist-out" hidden></div>
        </section>
      </div>
    </div>
  `);
  bindAdminRail(eventRoot());
  bindFieldRows(eventRoot(), Math.max(fields.length, 1), ev);
  bindTiebreakOrder(eventRoot());
  bindVenuePhotos(slug, plan.photos || [], showErr);
  bindTeamImport(slug, showErr);
  bindScheduleImport(slug, showErr);
  bindBracketImport(slug, showErr);
  bindContactEdits(slug, showErr);
  bindCustomBracket(slug, showErr);
  bindBoxDesk(slug, showErr);
  bindAssistDesk(slug, showErr);
  const note = (msg) => { document.getElementById("admin-note").textContent = msg; };

  document.getElementById("fields-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    try {
      await fetch("/api/events/" + encodeURIComponent(slug) + "/settings", {
        method: "POST",
        headers: { ...authHeader() },
        body: dropUnusedPins(new FormData(evnt.target)),
      }).then(async (r) => { if (!r.ok) throw new Error(await r.text()); });
      flashSaved("Venue saved");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  function schedulerBody(fd) {
    return {
      days: String(fd.get("days") || ""),
      games_per_team: Number(fd.get("games_per_team") || 2),
      start_time: fd.get("start_time") || "08:00",
      end_time: fd.get("end_time") || "18:00",
      hours_start: fd.get("start_time") || "08:00",
      hours_end: fd.get("end_time") || "18:00",
      consolation: fd.get("consolation") === "on",
      replace: fd.get("replace") === "on",
      draw_bracket: fd.get("draw_bracket") === "on",
      format: fd.get("format") || ev.format || "pool-to-bracket",
      bracket_flights: fd.get("bracket_flights") || ev.bracket_flights || "none",
    };
  }
  document.getElementById("save-scheduler-settings")?.addEventListener("click", async () => {
    const body = schedulerBody(new FormData(document.getElementById("auto-form")));
    delete body.replace;
    delete body.draw_bracket;
    try {
      await adminPost(slug, "/settings", body);
      flashSaved("Weekend settings saved");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("auto-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const body = schedulerBody(new FormData(evnt.target));
    if (body.replace && games.length && !confirm("Clear and rebuild the schedule? Completed games stay. " + games.length + " current game(s) will be checked.")) return;
    try {
      await adminPost(slug, "/settings", body);
      const out = await adminPost(slug, "/schedule/auto", body);
      note("Scheduled " + out.games + " game(s) on " + (out.fields || []).join(", ") + (out.leftover ? " · " + out.leftover + " leftover" : ""));
      flashSaved("Pool schedule saved");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("build-bracket").addEventListener("click", async () => {
    const body = schedulerBody(new FormData(document.getElementById("auto-form")));
    delete body.replace;
    delete body.draw_bracket;
    const open = games.filter((g) => g.status !== "final").length;
    if (open && games.some((g) => g.status === "final") && !confirm("Pool play is not finished (" + open + " games still open). Draw from the current standings anyway?")) return;
    if (open && games.some((g) => g.status === "final")) body.confirm = true;
    try {
      await adminPost(slug, "/settings", body);
      const out = await adminPost(slug, "/bracket/build", body);
      note("Bracket drawn · " + out.games + " games from " + out.seeds + " seeds");
      flashSaved("Bracket saved");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("draw-empty-bracket")?.addEventListener("click", async () => {
    const body = schedulerBody(new FormData(document.getElementById("auto-form")));
    body.empty = true;
    delete body.replace;
    try {
      await adminPost(slug, "/settings", body);
      const out = await adminPost(slug, "/bracket/build", body);
      note("Blank bracket posted · " + out.games + " TBD slots");
      flashSaved("Empty bracket saved");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("clear-bracket")?.addEventListener("click", async () => {
    const n = (plan.bracket || []).length;
    if (!n) { note("No bracket games to clear."); return; }
    if (!confirm("Delete all " + n + " bracket games? Games already marked final will be kept.")) return;
    try {
      const out = await adminPost(slug, "/bracket/clear", {});
      note((out.note || "Bracket cleared") + (out.deleted != null ? " · removed " + out.deleted : ""));
      flashSaved("Bracket cleared");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("clear-schedule")?.addEventListener("click", async () => {
    if (!games.length) { note("No pool games to clear."); return; }
    if (!confirm("Delete all " + games.length + " pool games? Games already marked final will be kept.")) return;
    try {
      const out = await adminPost(slug, "/schedule/clear", {});
      note((out.note || "Schedule cleared") + (out.deleted != null ? " · removed " + out.deleted : ""));
      flashSaved("Schedule cleared");
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
      flashSaved("Rain notice saved");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  document.getElementById("add-game-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const data = Object.fromEntries(new FormData(evnt.target));
    try {
      await adminPost(slug, "/schedule/game", data);
      flashSaved("Game added");
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
        if (el.name === "home_id") body.home_id = el.value;
        if (el.name === "away_id") body.away_id = el.value;
        if (el.name === "home_runs") body.home_runs = el.value;
        if (el.name === "away_runs") body.away_runs = el.value;
      });
      try {
        await adminPost(slug, "/schedule/" + id, body);
        note("Game updated");
        flashSaved("Game saved");
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
        flashSaved("Score saved");
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
  const coForm = document.getElementById("co-owner-form");
  if (coForm) {
    coForm.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const email = String(new FormData(evnt.target).get("email") || "").trim();
      try {
        await adminPost(slug, "/co-owners", { email });
        flashSaved("Co-owner added");
        history.replaceState({}, "", location.pathname + "#admin-setup");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  }
  eventRoot().querySelectorAll("[data-remove-co-owner]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await adminPost(slug, "/co-owners/remove", { email: btn.dataset.removeCoOwner });
        flashSaved("Co-owner removed");
        history.replaceState({}, "", location.pathname + "#admin-setup");
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
        flashSaved("Tournament setup saved");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  }
  eventRoot().querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await adminPost(slug, "/docs/" + btn.dataset.approve + "/review", { status: "approved" });
        flashSaved("Packet approved");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
  bindBoxReview(slug, () => eventAdmin(slug), showErr);
  const dupBtn = document.getElementById("duplicate-event");
  if (dupBtn) {
    dupBtn.addEventListener("click", () => {
      goEvent("/directors/duplicate?from=" + encodeURIComponent(ev.slug));
    });
  }
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
      flashSaved(ev.signup_open ? "Signup closed" : "Signup saved");
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  const archiveBtn = document.getElementById("archive-event");
  if (archiveBtn) {
    archiveBtn.addEventListener("click", async () => {
      if (!confirm("Hide " + ev.slug + " from Find?")) return;
      try {
        const res = await fetch("/api/admin/events/" + encodeURIComponent(ev.slug) + "/archive", {
          method: "POST",
          headers: authHeader(),
        });
        if (!res.ok) throw new Error(await res.text());
        flashSaved("Tournament removed from Find");
        goEvent("/admin/events");
      } catch (err) { showErr(err); }
    });
  }
  const deleteForm = document.getElementById("delete-event-form");
  if (deleteForm) {
    deleteForm.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      const typed = new FormData(evnt.target).get("slug");
      if (typed !== ev.slug) {
        showErr(new Error("Type the slug " + ev.slug + " to delete this tournament."));
        return;
      }
      if (!confirm("Permanently delete " + ev.slug + "? This cannot be undone.")) return;
      try {
        const res = await fetch("/api/admin/events/" + encodeURIComponent(ev.slug) + "/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify({ confirm: true, slug: ev.slug }),
        });
        if (!res.ok) throw new Error(await res.text());
        flashSaved("Tournament deleted");
        goEvent("/admin/events");
      } catch (err) { showErr(err); }
    });
  }
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

function weekendSlug(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function directorImport() {
  const u = eventPb.authStore.record;
  if (!recordIsDirector(u)) {
    eventRoot().innerHTML = eventChrome(null, "", `<section class="card"><p>Director login required.</p><p><a class="btn" data-link href="/login">Log in</a></p></section>`);
    return;
  }
  const into = new URLSearchParams(location.search).get("into") || new URLSearchParams(location.search).get("from") || "";
  let intoName = into;
  if (into) {
    try {
      const board = await fetch("/api/event/" + encodeURIComponent(into) + "/board").then((r) => r.json());
      intoName = board.event?.name || into;
    } catch (err) {}
  }
  const sample = "date,time,home,away,pool,field,home_runs,away_runs,status\n2026-09-20,09:00,Northside,West End,A,Harbor 1,,,\n2026-09-20,09:00,Eastside,South Ridge,B,Harbor 2,,,";
  eventRoot().innerHTML = eventChrome(null, "create", `
    <section class="page-head">
      <h1>${into ? "Import a schedule onto this weekend" : "You already have a schedule"}</h1>
      <p class="muted">${into
        ? `Games go on ${escapeHtml(intoName)}. A CSV upload does not create a new tournament.`
        : "Name the weekend first. Uploading a CSV without a name does not create a tournament."}</p>
    </section>
    <section class="card">
      <form class="form" id="import-form" style="max-width:none">
        ${into ? `<input type="hidden" name="into" value="${escapeHtml(into)}">`
          : `<label>Weekend name <input name="event_name" required placeholder="Harbor Classic" autocomplete="off"></label>
             <label>Public slug <input name="event_slug" placeholder="harbor-classic"></label>
             <label class="check"><input type="checkbox" name="create" required checked> Create a new tournament with this name</label>`}
        <label>Spreadsheet file <input name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"></label>
        <label>Or paste CSV
          <textarea name="csv" rows="10" placeholder="${escapeHtml(sample)}"></textarea>
        </label>
        <label class="check"><input type="checkbox" name="replace"${into ? "" : " checked"}> Replace existing pool games${into ? " on this weekend" : ""}</label>
        <button class="btn" type="submit">${into ? "Import onto this tournament" : "Publish the public link"}</button>
        <p class="error" id="import-err" hidden></p>
      </form>
    </section>`);
  const form = document.getElementById("import-form");
  form.querySelector("[name=event_name]")?.addEventListener("input", (evnt) => {
    const slug = form.querySelector("[name=event_slug]");
    if (slug && !slug.dataset.locked) slug.value = weekendSlug(evnt.target.value);
  });
  form.querySelector("[name=event_slug]")?.addEventListener("input", (evnt) => {
    evnt.target.dataset.locked = evnt.target.value ? "1" : "";
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const err = document.getElementById("import-err");
    try {
      const csv = await readImportText(form);
      if (!csv) throw new Error("Choose a CSV or paste rows.");
      const fd = new FormData(form);
      const intoSlug = String(fd.get("into") || "").trim();
      const body = {
        csv,
        replace: fd.get("replace") === "on",
      };
      let res;
      if (intoSlug) {
        res = await fetch("/api/events/" + encodeURIComponent(intoSlug) + "/schedule/import", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
      } else {
        body.event_name = String(fd.get("event_name") || "").trim();
        body.event_slug = String(fd.get("event_slug") || "").trim();
        body.create = fd.get("create") === "on";
        res = await fetch("/api/event/import-schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeader() },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json();
      flashSaved(out.created ? "Tournament created from the grid" : "Schedule imported onto this tournament");
      goEvent("/t/" + (out.event || intoSlug));
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message || String(ex);
    }
  });
}

function boxHelpCopy() {
  return `
    <ol>
      <li>Upload a GameChanger mobile PDF on this page.</li>
      <li>Paste a public GameChanger box-score URL (web.gc.com …/box-score).</li>
      <li>Upload a photo of the paper scorebook.</li>
    </ol>
    <p class="muted">Exact GameChanger menu names change by app version. This page does not guess them. Use the export your director already showed you. Owner screenshots of the current iOS and Android flow will sit here when they are supplied — stale screenshots are worse than none.</p>`;
}

function bindBoxDesk(slug, showErr) {
  document.getElementById("boxes-run")?.addEventListener("click", async () => {
    try {
      const out = await adminPost(slug, "/boxes/run", { now: new Date().toISOString() });
      flashSaved((out.invited || 0) + " invite(s), " + (out.reminded || 0) + " reminder(s)"
        + (out.reason ? " · " + out.reason : ""));
      eventAdmin(slug);
    } catch (err) { showErr(err); }
  });
  eventRoot().querySelectorAll("[data-box-resend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await adminPost(slug, "/boxes/resend", {
          game_id: btn.dataset.boxResend,
          team_id: btn.dataset.team,
          kind: btn.dataset.kind || "schedule",
        });
        flashSaved("Upload link resent");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
  eventRoot().querySelectorAll("[data-box-pick]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await adminPost(slug, "/boxes/resolve", {
          game_id: btn.dataset.boxPick,
          pick: btn.dataset.pick,
          kind: btn.dataset.kind || "schedule",
        });
        flashSaved("Conflict resolved");
        eventAdmin(slug);
      } catch (err) { showErr(err); }
    });
  });
}

function bindAssistDesk(slug, showErr) {
  const paint = (out) => {
    const box = document.getElementById("assist-out");
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `
      <p class="assist-label">${escapeHtml(out.label || "assistant-generated")}</p>
      <p><b>${escapeHtml(out.answer || "")}</b></p>
      <ol class="assist-math">${(out.math || []).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
  };
  eventRoot().querySelectorAll("[data-assist]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const q = btn.dataset.assist;
      const params = new URLSearchParams({ q });
      if (q === "lose_field") {
        params.set("field", document.getElementById("assist-field")?.value || "");
        params.set("time", document.getElementById("assist-time")?.value || "");
      }
      try {
        const res = await fetch("/api/events/" + encodeURIComponent(slug) + "/assist?" + params.toString(), {
          headers: authHeader(),
        });
        if (!res.ok) throw new Error(await res.text());
        paint(await res.json());
      } catch (err) { showErr(err); }
    });
  });
}

function nextGameCard(eventSlug, team, g) {
  if (!g) return `<section class="next-game empty"><p>No upcoming game on the board.</p></section>`;
  const opp = g.home === team.name || g.home_id === team.id ? (g.away || "TBD") : (g.home || "TBD");
  const oppSlug = g.home === team.name || g.home_id === team.id ? g.away_slug : g.home_slug;
  return `<section class="next-game">
    <p class="kicker">Next game</p>
    <p class="next-when">${escapeHtml(formatTimeDisplay(g.time) || "TBD")}${g.field ? ` · ${escapeHtml(g.field)}` : ""}</p>
    <p class="next-vs">vs ${teamLink(eventSlug, oppSlug, opp)}</p>
    <p class="muted">${escapeHtml([formatDateDisplay(g.date), gameNo(g), g.round || g.pool].filter(Boolean).join(" · "))}</p>
  </section>`;
}

export async function eventTeamPage(eventSlug, teamSlug) {
  const res = await fetch("/api/event/" + encodeURIComponent(eventSlug) + "/team/" + encodeURIComponent(teamSlug), {
    headers: authHeader(),
  });
  if (!res.ok) throw new Error(await res.text());
  const page = await res.json();
  const ev = page.event;
  const team = page.team;
  rememberEvent(ev);
  document.title = team.name + " · " + ev.name;
  const standing = page.standing;
  eventRoot().innerHTML = eventChrome(ev, "team", `
    <article class="team-sheet">
      <section class="page-head print-sheet">
        <h1>${escapeHtml(team.name)}</h1>
        <p class="muted">${escapeHtml(ev.name)}${team.pool ? " · Pool " + escapeHtml(team.pool) : ""}</p>
        <div class="actions no-print">
          <button class="btn ghost" type="button" onclick="window.print()">Print this page</button>
          ${team.gc_linked && team.gamechanger_url
            ? `<a class="btn ghost" href="${escapeHtml(team.gamechanger_url)}" target="_blank" rel="noopener">GameChanger</a>`
            : ""}
          ${page.edit ? `<a class="btn ghost" data-link href="${escapeHtml(page.edit)}">Edit team</a>` : ""}
        </div>
      </section>
      ${nextGameCard(ev.slug, team, page.next)}
      <section class="card">
        <h2>Schedule</h2>
        ${(page.schedule || []).length ? schedulePair(["Game", "When", "Field", "Opponent", "Result"], page.schedule.map((g) => {
          const usHome = g.home === team.name || g.home_id === team.id;
          const opp = usHome ? g.away : g.home;
          const oppSlug = usHome ? g.away_slug : g.home_slug;
          const past = g.status === "final" || g.score_source === "one_book" || g.score_source === "verified";
          return `<tr>
            <td>${gameNoCell(g)}</td>
            <td>${escapeHtml(whenLine(g))}</td>
            <td>${escapeHtml(g.field || "—")}</td>
            <td>${teamLink(ev.slug, oppSlug, opp || "TBD")}</td>
            <td>${past ? scoreCell(g) : "—"}</td>
          </tr>`;
        }), page.schedule.map((g) => {
          const usHome = g.home === team.name || g.home_id === team.id;
          const opp = usHome ? g.away : g.home;
          const oppSlug = usHome ? g.away_slug : g.home_slug;
          const past = g.status === "final" || g.score_source === "one_book" || g.score_source === "verified";
          return `<article class="game-card${g.status === "live" ? " live" : ""}">
            <p class="game-card-kicker">${escapeHtml([gameNo(g), g.round || g.pool].filter(Boolean).join(" · "))}</p>
            <p class="game-card-match">vs ${teamLink(ev.slug, oppSlug, opp || "TBD")}</p>
            <p class="game-card-when">${escapeHtml(whenLine(g))}${g.field ? ` · ${escapeHtml(g.field)}` : ""}</p>
            <p class="game-card-score">${past ? scoreCell(g) : "—"}</p>
          </article>`;
        })) : `<p class="empty">No games posted for this team yet.</p>`}
      </section>
      <section class="card">
        <h2>Record</h2>
        ${standing
          ? `<p><b>${standing.w || 0}-${standing.l || 0}${standing.t ? "-" + standing.t : ""}</b>
             ${standing.seed != null ? ` · Seed ${escapeHtml(String(standing.seed))}` : ""}
             ${standing.seed_reason ? ` · ${escapeHtml(standing.seed_reason)}` : ""}</p>`
          : `<p class="muted">Standings appear after a pool game is final.</p>`}
        ${page.paid != null ? `<p class="muted">Paid: ${page.paid ? "yes" : "no"}${page.packet_status ? " · packet " + escapeHtml(page.packet_status) : ""}</p>` : ""}
        ${page.box_scores ? `<p class="muted">Box scores: ${page.box_scores.filter((b) => b.submitted).length} submitted</p>` : ""}
      </section>
      ${(page.hitting || []).length || (page.pitching || []).length ? `<section class="card">
        <h2>Team stats</h2>
        ${(page.hitting || []).length ? table(["Player", "AB", "H", "RBI", "AVG"], page.hitting.map((r) => `<tr>
          <td>${escapeHtml(r.player || r.name_key)}</td><td>${r.ab ?? ""}</td><td>${r.h ?? ""}</td>
          <td>${r.rbi ?? ""}</td><td>${r.avg || r.avg_display || ""}</td></tr>`)) : ""}
        ${(page.pitching || []).length ? table(["Player", "IP", "K", "ERA"], page.pitching.map((r) => `<tr>
          <td>${escapeHtml(r.player || r.name_key)}</td><td>${r.ip ?? ""}</td>
          <td>${r.k ?? r.so ?? ""}</td><td>${r.era || r.era_display || ""}</td></tr>`)) : ""}
      </section>` : ""}
      ${(page.bracket_path || []).length ? `<section class="card">
        <h2>Bracket path</h2>
        ${table(["Game", "Round", "Opponent", "When"], page.bracket_path.map((g) => {
          const usHome = g.home === team.name || g.home_id === team.id;
          const opp = usHome ? (g.away || "TBD") : (g.home || "TBD");
          return `<tr>
            <td>${gameNoCell(g)}</td>
            <td>${escapeHtml(g.round || "")}</td>
            <td>${escapeHtml(opp)}</td>
            <td>${escapeHtml([whenLine(g) !== "TBD" ? whenLine(g) : "", g.field].filter(Boolean).join(" · ") || "TBD")}</td>
          </tr>`;
        }))}
      </section>` : ""}
    </article>
  `);
}

export async function boxUploadPage(token) {
  const res = await fetch("/api/box/" + encodeURIComponent(token));
  if (!res.ok) throw new Error(await res.text());
  const view = await res.json();
  document.title = "Upload book · " + (view.event?.name || "Diamond Tourney");
  eventRoot().innerHTML = eventChrome(view.event ? { slug: view.event.slug, name: view.event.name } : null, "box", `
    <section class="page-head">
      <h1>Upload this team's book</h1>
      <p class="muted">${escapeHtml(view.event?.name || "")} · Game ${view.game?.game_number || "?"} · ${escapeHtml(view.team?.name || "")}</p>
      <p>${escapeHtml(view.game?.home || "")} vs ${escapeHtml(view.game?.away || "")}
         ${view.game ? " · " + escapeHtml([whenLine(view.game) !== "TBD" ? whenLine(view.game) : "", view.game.field].filter(Boolean).join(" · ")) : ""}</p>
    </section>
    ${view.expired ? `<section class="card empty">This upload link is expired.</section>`
      : view.submitted ? `<section class="card"><p>This book is already in. Thank you.</p>
          <p><a data-link href="/help/box-score">Help: how to send a box score</a></p></section>`
      : `<section class="card">
        <p>One game, this team only. No login.</p>
        ${boxHelpCopy()}
        <form class="form wide" id="box-token-form">
          <label>Your name or email <input name="submitted_by" placeholder="Coach name"></label>
          <label>GameChanger PDF <input name="file" type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"></label>
          <label>Public GameChanger box URL <input name="gc_url" type="url" placeholder="https://web.gc.com/teams/…/box-score"></label>
          <div class="form-grid two">
            <label>Home runs from the book <input name="home_runs" type="number" min="0"></label>
            <label>Away runs from the book <input name="away_runs" type="number" min="0"></label>
          </div>
          <button class="btn" type="submit">Send this book</button>
          <p class="error" id="box-token-err" hidden></p>
        </form>
        <p><a data-link href="/help/box-score">Help: how to send a box score</a>
           · <a data-link href="/box/${escapeHtml(token)}/stop">Stop asking about this tournament</a></p>
      </section>`}
  `, { slim: true });
  const form = document.getElementById("box-token-form");
  if (!form) return;
  form.addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    const err = document.getElementById("box-token-err");
    try {
      const out = await fetch("/api/box/" + encodeURIComponent(token), {
        method: "POST",
        headers: {},
        body: new FormData(form),
      });
      if (!out.ok) throw new Error(await out.text());
      flashSaved("Book received");
      boxUploadPage(token);
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message || String(ex);
    }
  });
}

export async function boxStopPage(token) {
  document.title = "Stop box-score mail";
  eventRoot().innerHTML = eventChrome(null, "box", `
    <section class="card">
      <h1>Stop asking about this tournament</h1>
      <p>This stops box-score upload mail for this team on this weekend. It does not change the public board.</p>
      <form id="box-stop-form">
        <button class="btn" type="submit">Stop asking</button>
        <p class="error" id="box-stop-err" hidden></p>
      </form>
    </section>
  `, { slim: true });
  document.getElementById("box-stop-form").addEventListener("submit", async (evnt) => {
    evnt.preventDefault();
    try {
      const out = await fetch("/api/box/" + encodeURIComponent(token) + "/unsubscribe", { method: "POST" });
      if (!out.ok) throw new Error(await out.text());
      flashSaved("Stopped");
      eventRoot().innerHTML = eventChrome(null, "box", `<section class="card"><p>This team will not get more box-score mail for this weekend.</p></section>`, { slim: true });
    } catch (ex) {
      const err = document.getElementById("box-stop-err");
      err.hidden = false;
      err.textContent = ex.message || String(ex);
    }
  });
}

export async function boxHelpPage() {
  document.title = "How to send a box score";
  eventRoot().innerHTML = eventChrome(null, "help", `
    <section class="page-head print-sheet">
      <h1>How to send a box score</h1>
      <p class="muted">Three doors. Use the one you already use for this weekend.</p>
    </section>
    <section class="card">
      ${boxHelpCopy()}
      <h2>1. GameChanger mobile PDF</h2>
      <p>Export the box from the GameChanger app the way your director already showed you, then upload the PDF on the token link.</p>
      <h2>2. Public GameChanger box URL</h2>
      <p>Paste a public web box, like <code>web.gc.com/teams/…/schedule/…/box-score</code>. The host stores the URL. Bots read posted numbers from that public page. Unreadable cells stay blank.</p>
      <h2>3. Photo of a paper book</h2>
      <p>A clear photo of the scorebook page is enough. A Grok bot types the lines. Nothing is invented from a blurry picture.</p>
      <p class="muted">Help version: doors only, 2026-09-19. Screenshots wait on the owner — GameChanger changes its UI and stale shots are worse than none.</p>
    </section>
  `, { slim: true });
}
