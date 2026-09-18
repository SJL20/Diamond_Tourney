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

function eventChrome(event, page, body) {
  const site = event ? "" : (page === "create" ? "create" : page);
  return pageShell({ pb: eventPb, site, event, page, body });
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
      <label class="check"><input type="checkbox" name="field_day_${i}_${di}_on" ${on ? "checked" : ""}> ${escapeHtml(d)}</label>
      <input type="hidden" name="field_day_${i}_${di}_date" value="${escapeHtml(d)}">
      <label>Open <input type="time" name="field_day_${i}_${di}_start" value="${escapeHtml(row.start || globalStart)}"></label>
      <label>Close <input type="time" name="field_day_${i}_${di}_end" value="${escapeHtml(row.end || globalEnd)}"></label>
    </div>`;
  }).join("");
}

function fieldRow(f = {}, i = 0, dates = [], globalStart = "08:00", globalEnd = "18:00") {
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

function bindFieldRows(root, startCount, ev = {}) {
  let n = startCount;
  const add = root.querySelector("#add-field");
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
      box.insertAdjacentHTML("beforeend", fieldRow({}, n, dates, hoursStart, hoursEnd));
      n += 1;
    });
  }
  ["start", "end", "hours_start", "hours_end"].forEach((name) => {
    root.querySelector(`[name=${name}]`)?.addEventListener("change", paintDays);
  });
}

function setupFormatFields(ev = {}) {
  const fmt = ev.format || "pool-to-bracket";
  return `
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
  `;
}

function setupVenueFields(ev = {}, fields = []) {
  const rows = fields.length ? fields : [{}, {}];
  const hoursStart = ev.hours_start || "08:00";
  const hoursEnd = ev.hours_end || "18:00";
  const dates = datesBetween(ev.start, ev.end);
  return `
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
    <div class="hours-global">
      <p class="muted">Global availability. Every diamond inherits this window unless you narrow a day below. A field that is closed Saturday will not get Saturday games.</p>
      <div class="form-grid two">
        <label>First pitch <input name="hours_start" type="time" value="${escapeHtml(hoursStart)}"></label>
        <label>No start after / last out <input name="hours_end" type="time" value="${escapeHtml(hoursEnd)}"></label>
      </div>
    </div>
    <p class="muted">Use GPS or a street address. Each diamond can have its own pin; blank fields inherit the park.</p>
    <div id="field-rows">${rows.map((f, i) => fieldRow(f, i, dates, hoursStart, hoursEnd)).join("")}</div>
    <button class="btn ghost" type="button" id="add-field">Add another field</button>
  `;
}

function setupLocationFields(ev = {}, fields = []) {
  return `
    <details class="setup-block" open>
      <summary>Venue, address, and fields</summary>
      ${setupVenueFields(ev, fields)}
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

function fieldsBlock(ev, fields) {
  const list = fields || ev.fields || [];
  if (!list.length && !ev.address && !ev.venue) return "";
  return `<section class="card facts">
    <h2>Fields</h2>
    ${[
      ["Park", ev.venue],
      ["Address", ev.address],
    ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}${ev.map_url && k === "Address" ? ` · <a href="${escapeHtml(ev.map_url)}" target="_blank" rel="noopener">Map</a>` : ""}</dd></div>`).join("")}
    ${ev.hours_start || ev.hours_end ? `<div><dt>Global hours</dt><dd>${escapeHtml(ev.hours_start || "08:00")}–${escapeHtml(ev.hours_end || "18:00")}</dd></div>` : ""}
    ${list.length ? `<ul class="field-list">${list.map((f) => {
      const hours = (f.windows || []).map((w) =>
        w.available === false ? `${w.date} closed` : (w.inherited ? "" : `${w.date} ${w.start}–${w.end}`)
      ).filter(Boolean).join(" · ");
      return `<li>
      <b>${escapeHtml(f.name)}</b>
      <span class="muted">${escapeHtml([f.surface, f.lights ? "lights" : "", f.status !== "open" ? f.status : "", hours].filter(Boolean).join(" · "))}</span>
      ${f.map_url ? `<a href="${escapeHtml(f.map_url)}" target="_blank" rel="noopener">Map</a>` : ""}
    </li>`;
    }).join("")}</ul>` : ""}
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

function teamOptions(roster, selected) {
  return `<option value="">TBD</option>${(roster || []).map((t) =>
    `<option value="${escapeHtml(t.id)}" ${t.id === selected ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}`;
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
  if (!fields.length) fields.push("Field 1", "Field 2");
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
  const timeLabel = g.time || "—";
  const meta = [g.game_id, tie ? "Tie" : g.status === "final" ? "Final" : "Scheduled"].filter(Boolean);
  const def = plan?.defaults.get(g.id) || {};
  const chosenField = g.field || def.field || "";
  const chosenTime = g.time || def.time || "";
  const chosenDate = g.date || def.date || "";
  const set = slotIsSet(g);
  const desk = isDirector() && g.id ? `
    <details class="bk-desk-box" ${set ? "" : "open"}>
      <summary>${set ? "Edit slot" : "Set field and time"}</summary>
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
    </details>
    ${g.home && g.away ? `<form class="bk-score" data-bk-id="${escapeHtml(g.id)}">
      <input name="home_runs" type="number" min="0" value="${g.home_runs ?? ""}" aria-label="Home runs">
      <input name="away_runs" type="number" min="0" value="${g.away_runs ?? ""}" aria-label="Away runs">
      <button class="btn ghost" type="submit">Final</button>
    </form>` : ""}` : "";
  return `<article class="bk-match ${escapeHtml(g.status)} ${tie ? "tie" : ""} ${set ? "slot-set" : "slot-open"}">
    <div class="bk-team ${homeWin ? "winner" : ""} ${g.home ? "" : "tbd"}">
      <span>${escapeHtml(g.home || "TBD")}</span>
      <b>${g.status === "final" ? g.home_runs : ""}</b>
    </div>
    <div class="bk-team ${awayWin ? "winner" : ""} ${g.away ? "" : "tbd"}">
      <span>${escapeHtml(g.away || "TBD")}</span>
      <b>${g.status === "final" ? g.away_runs : ""}</b>
    </div>
    <div class="bk-when">
      <span class="bk-chip"><em>Field</em> ${escapeHtml(fieldLabel)}</span>
      <span class="bk-chip"><em>Time</em> ${escapeHtml(timeLabel)}</span>
    </div>
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
  const champ = games.filter((g) => gameSide(g) === "championship");
  const cons = games.filter((g) => gameSide(g) === "consolation");
  return `
    ${renderBracketTree(champ, "Championship", "Winners move right when a score is final. Field and first pitch sit on every card.", true, roster, plan)}
    ${renderBracketTree(cons, "Consolation", "Outside the championship. These games do not feed the final.", false, roster, plan)}
  `;
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
      if (await post("/bracket/" + form.dataset.bkId + "/score", data)) eventBracket(slug);
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
      if (await post("/bracket/" + form.dataset.bkDesk, data)) eventBracket(slug);
    });
    form.querySelector("[data-swap]")?.addEventListener("click", async () => {
      if (await post("/bracket/" + form.dataset.bkDesk, { swap: true })) eventBracket(slug);
    });
    form.querySelector("[data-reopen]")?.addEventListener("click", async () => {
      if (await post("/bracket/" + form.dataset.bkDesk, { reopen: true })) eventBracket(slug);
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
      })) eventBracket(slug);
    });
  }
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
        <a class="btn ghost" data-link href="/t/${ev.slug}/overall">Weekend schedule</a>
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
  const plan = buildDeskPlan(board);
  eventRoot().innerHTML = eventChrome(board.event, "bracket", `
    <section class="page-head">
      <h1>Bracket</h1>
      <p class="muted">Championship on top. Consolation sits to the side and never feeds the title game. Field and first pitch sit on every card${isDirector() ? ". A set game stays collapsed — open Edit slot to change it. New games default to the next open field and time" : ""}.</p>
    </section>
    ${board.bracket.length ? bracketBoards(board.bracket, board.roster, plan) : `<section class="card empty">No bracket games yet. Draw the bracket from Admin after pool play.</section>`}
    ${board.bracket.length ? protestSwapForm(board.bracket) : ""}
  `);
  eventRoot()._deskPlan = plan;
  bindBracketDesk(slug, eventRoot());
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
      ${rows.length ? table(["When", "Field", "Round", "Home", "Away", "Score"], rows.map((g) => {
        const when = [g.date, g.time].filter(Boolean).join(" ");
        const kind = g.kind === "bracket" ? (ROUND_META[g.round]?.label || g.round || "Bracket") : (g.round || "Pool");
        const href = g.kind === "pool" && g.id
          ? `/t/${escapeHtml(slug)}/games/${g.id}`
          : `/t/${escapeHtml(slug)}/bracket`;
        return `<tr>
          <td>${escapeHtml(when || "TBD")}${g.delayed_from ? ` <span class="muted">(was ${escapeHtml(g.delayed_from)})</span>` : ""}</td>
          <td>${escapeHtml(g.field || "—")}</td>
          <td><span class="ov-kind ${escapeHtml(g.kind || "")}">${escapeHtml(kind)}</span></td>
          <td>${escapeHtml(g.home || "TBD")}</td>
          <td>${escapeHtml(g.away || "TBD")}</td>
          <td>${scoreText(g)} · ${escapeHtml(g.status || "")}
            ${g.id ? ` · <a data-link href="${href}">${g.kind === "pool" ? (g.can_score ? "Post score" : "Open") : "Bracket"}</a>` : ""}
          </td>
        </tr>`;
      })) : `<p class="empty">No games on the weekend board yet. Build pool play on Admin, then draw the bracket.</p>`}
    </section>
  `);
}

export async function eventSchedule(slug) {
  const board = await fetchBoard(slug);
  const packet = board.packet || board.event.packet;
  const rows = realPoolGames(board.schedule).sort((a, b) =>
    String(a.date + a.time + a.field + a.home).localeCompare(String(b.date + b.time + b.field + b.home)));
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
      <h2>How this game’s stats get here</h2>
      <p class="muted">Four doors. This host does not scrape GameChanger. A PDF or public box URL is stored as you sent it. A Grok bot (or a person) types the lines. Nothing is invented from a picture.</p>
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
        <form class="form wide" id="gc-pdf-form">
          <input type="hidden" name="source" value="gc_pdf">
          <label>GameChanger PDF <input name="file" type="file" accept=".pdf,application/pdf" required></label>
          <label>Note <input name="note" placeholder="Saturday 9:00, Harbor 1"></label>
          <button class="btn" type="submit">Queue GC PDF</button>
          <p class="error" id="gc-pdf-err" hidden></p>
        </form>
      </details>
      <details class="setup-block" open>
        <summary>2. Public GameChanger box URL</summary>
        <p class="muted">Paste the public web box, like web.gc.com/teams/…/schedule/…/box-score. We store the link and check that the page is reachable. We do not copy numbers off that page.</p>
        <form class="form wide" id="gc-url-form">
          <input type="hidden" name="source" value="gc_url">
          <label>Box-score URL <input name="gc_url" type="url" required placeholder="https://web.gc.com/teams/…/schedule/…/box-score" value="${escapeHtml(box?.gc_url || "")}"></label>
          <button class="btn" type="submit">Save GC link for a bot</button>
          <p class="error" id="gc-url-err" hidden></p>
        </form>
      </details>
      <details class="setup-block">
        <summary>3. Grok bot upload</summary>
        <p class="muted">Queued PDFs and links show in Admin → Stats inbox. A bot (or you) posts the extracted hitting, pitching, and score to <code>/api/bot/event-box</code>. Local: <code>python3 scripts/bot_c_event_box.py --list</code> then <code>--event ${escapeHtml(slug)} --game ${escapeHtml(id)}</code>.</p>
      </details>
      ${detail.director ? `<details class="setup-block" open>
        <summary>4. Director PDF</summary>
        <p class="muted">Your upload as the tournament director. Use a GC export or a scorebook scan. Check the box if this file is the book of record and a bot does not need to type it.</p>
        <form class="form wide" id="td-pdf-form">
          <input type="hidden" name="source" value="director_pdf">
          <label>PDF or photo <input name="file" type="file" accept=".pdf,image/jpeg,image/png,image/webp" required></label>
          <label class="check"><input type="checkbox" name="approve_file"> Official book — do not wait on a bot</label>
          <label>Note <input name="note" placeholder="TD copy from the plate meeting"></label>
          <button class="btn" type="submit">Upload director PDF</button>
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
      eventGame(slug, id);
    });
  }
  const postBox = async (form, errId) => {
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
    eventGame(slug, id);
  };
  [["gc-pdf-form", "gc-pdf-err"], ["gc-url-form", "gc-url-err"], ["td-pdf-form", "td-pdf-err"]].forEach(([fid, eid]) => {
    const form = document.getElementById(fid);
    if (!form) return;
    form.addEventListener("submit", async (evnt) => {
      evnt.preventDefault();
      postBox(evnt.target, eid);
    });
  });
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
  bindFieldRows(eventRoot(), 2, {});
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
  bindFieldRows(eventRoot(), 2, {});
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

function adminPaneFromHash() {
  const id = String(location.hash || "").replace(/^#admin-/, "");
  const allowed = ["overview", "setup", "venue", "scheduler", "rain", "teams", "stats"];
  return allowed.includes(id) ? id : "overview";
}

function bindAdminRail(root) {
  const setPane = (id) => {
    const pane = ["overview", "setup", "venue", "scheduler", "rain", "teams", "stats"].includes(id) ? id : "overview";
    root.querySelectorAll("[data-admin-pane]").forEach((el) => {
      el.hidden = el.dataset.adminPane !== pane;
    });
    root.querySelectorAll("[data-admin-go]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.adminGo === pane);
    });
    const next = "#admin-" + pane;
    if (location.hash !== next) history.replaceState({}, "", location.pathname + next);
  };
  root.querySelectorAll("[data-admin-go]").forEach((btn) => {
    btn.addEventListener("click", () => setPane(btn.dataset.adminGo));
  });
  setPane(adminPaneFromHash());
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
  const docToken = await fileToken();
  const showErr = async (err) => {
    const box = document.getElementById("admin-err");
    box.hidden = false;
    box.textContent = err.message || String(err);
  };
  const fieldOpts = fields.map((f) => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.name)}</option>`).join("");
  const pending = plan.pending_boxes || [];
  const rainOn = ev.rain_status && ev.rain_status !== "clear";
  const rail = [
    ["overview", "Overview", ""],
    ["setup", "Tournament setup", ""],
    ["venue", "Venue setups", fields.length ? String(fields.length) : ""],
    ["scheduler", "Scheduler", games.length ? String(games.length) : ""],
    ["rain", "Rain notice", rainOn ? ev.rain_status : ""],
    ["teams", "Teams", teams.length ? String(teams.length) : ""],
    ["stats", "Stats inbox", pending.length ? String(pending.length) : ""],
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
        <nav>
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
            <a class="btn ghost" data-link href="/directors/import">Import a grid</a>
            ${ev.source === "popup" ? `<button class="btn ghost" id="refresh-popup" type="button">Refresh from popup</button>` : ""}
          </div>
          <ul class="admin-jump">
            <li><button type="button" class="link" data-admin-go="venue">Set fields and hours</button></li>
            <li><button type="button" class="link" data-admin-go="scheduler">Build the weekend grid</button></li>
            <li><button type="button" class="link" data-admin-go="rain">Post a rain notice</button></li>
            <li><button type="button" class="link" data-admin-go="teams">Review team packets</button></li>
          </ul>
        </section>
        <section class="card" data-admin-pane="setup" hidden>
          <h2>Tournament setup</h2>
          <p class="muted">Bracket type, governing body, pitch cap, and what teams must upload.</p>
          <form class="form wide" id="guide-form">
            <div class="setup-block">${setupFormatFields(ev)}</div>
            ${setupGuidelinesFields(ev)}
            <button class="btn" type="submit">Save tournament setup</button>
          </form>
        </section>
        <section class="card" data-admin-pane="venue" hidden>
          <h2>Venue setups</h2>
          <p class="muted">Park, GPS, global hours, then each diamond’s hours by date. A field that is closed Saturday will not get Saturday games.</p>
          <form class="form wide" id="fields-form">
            ${setupVenueFields(ev, fields.length ? fields : [{}, {}])}
            <button class="btn" type="submit">Save venue</button>
          </form>
        </section>
        <section class="card" data-admin-pane="scheduler" hidden>
          <h2>Scheduler</h2>
          <p class="muted">Round-robin inside each pool. A diamond is only used while it is open that day.</p>
          <form class="form wide" id="auto-form">
            <div class="form-grid two">
              <label>Days (one per line or comma) <textarea name="days" rows="2">${escapeHtml([ev.start, ev.end].filter(Boolean).join("\n") || "")}</textarea></label>
              <label>Games per team in pool <input name="games_per_team" type="number" min="1" value="2"></label>
              <label>First pitch <input name="start_time" type="time" value="${escapeHtml(ev.hours_start || "08:00")}"></label>
              <label>No start after <input name="end_time" type="time" value="${escapeHtml(ev.hours_end || "18:00")}"></label>
            </div>
            <label class="check"><input type="checkbox" name="consolation" checked> If you draw a bracket, include consolation games</label>
            <label class="check"><input type="checkbox" name="replace" checked> Replace unplayed pool games</label>
            <label class="check"><input type="checkbox" name="draw_bracket"> Also draw empty bracket slots now</label>
            <div class="actions">
              <button class="btn" type="submit">Build pool schedule</button>
              <button class="btn ghost" id="build-bracket" type="button">Draw bracket from standings</button>
            </div>
          </form>
          <h3>Games by field</h3>
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
        <section class="card" data-admin-pane="rain" hidden>
          <h2>Rain notice</h2>
          <p class="muted">Posts a public banner and can delay times, move a day, postpone games, or close a wet field.</p>
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
          <p class="muted">Packets and the public roster. Add a club from Overview or the signup page.</p>
          <div class="actions">
            <a class="btn" data-link href="/t/${ev.slug}/signup">Add a team</a>
          </div>
          <h3>Packets</h3>
          ${table(["Team", "Packet", "Missing", "Files"], teams.map((t) => {
            const p = t.packet || {};
            return `<tr>
              <td>${escapeHtml(t.name)}</td>
              <td><span class="badge ${p.status || "incomplete"}">${escapeHtml(p.status || "incomplete")}</span></td>
              <td>${(p.missing || []).map((k) => escapeHtml(k)).join(", ") || "—"}</td>
              <td>${(p.docs || []).map((d) => `${escapeHtml(d.label)} · ${escapeHtml(d.status)}${d.url ? ` · <a href="${escapeHtml(withFileToken(d.url, docToken))}">file</a>` : ""} ${d.status !== "approved" ? `<button class="btn ghost" data-approve="${d.id}">Approve</button>` : ""}`).join("<br>") || "—"}</td>
            </tr>`;
          }))}
          ${rosterBlock(teams)}
        </section>
        <section class="card" data-admin-pane="stats" hidden>
          <h2>Stats inbox</h2>
          <p class="muted">PDFs and public GameChanger box links waiting on a bot or on you. Four doors: team GC PDF, GC box URL, Grok bot POST, director PDF.</p>
          ${pending.length ? table(["Game", "Door", "Status", ""], pending.map((b) => `<tr>
            <td>${escapeHtml(b.game ? (b.game.home + " vs " + b.game.away) : "Game")}</td>
            <td>${escapeHtml(b.source || "")}${b.gc_url ? ` · <a href="${escapeHtml(b.gc_url)}" target="_blank" rel="noopener">GC</a>` : ""}${b.url ? ` · <a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">file</a>` : ""}</td>
            <td><span class="badge ${escapeHtml(b.status || "")}">${escapeHtml(b.status || "")}</span></td>
            <td>${b.schedule_id ? `<a data-link href="/t/${ev.slug}/games/${b.schedule_id}">Open</a>` : ""}</td>
          </tr>`)) : `<p class="empty">Nothing queued. Managers paste a GC box URL or PDF; you can upload a director PDF from any game.</p>`}
        </section>
      </div>
    </div>
  `);
  bindAdminRail(eventRoot());
  bindFieldRows(eventRoot(), Math.max(fields.length, 2), ev);
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
