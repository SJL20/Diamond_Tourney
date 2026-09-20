"use strict";

function decodeJson(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch (err) { return null; }
  }
  if (typeof raw === "object") {
    if (raw.length !== undefined && typeof raw[0] === "number") {
      try {
        let s = "";
        for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
        return JSON.parse(s);
      } catch (err) { return null; }
    }
    return raw;
  }
  return null;
}

function slugify(raw, fallback) {
  const s = String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback || "";
}

function nextPowerOfTwo(n) {
  let p = 1;
  const want = Math.max(Number(n) || 0, 1);
  while (p < want) p *= 2;
  return p;
}

function ordinal(n) {
  const v = Number(n) || 0;
  const rem10 = v % 10;
  const rem100 = v % 100;
  if (rem10 === 1 && rem100 !== 11) return v + "st";
  if (rem10 === 2 && rem100 !== 12) return v + "nd";
  if (rem10 === 3 && rem100 !== 13) return v + "rd";
  return v + "th";
}

function normLabel(raw) {
  return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
}

function parseRef(raw) {
  const text = String(raw || "").trim();
  if (!text) return { kind: "empty", value: "" };
  const seed = text.match(/^seed\s*:?\s*(\d+)$/i);
  if (seed) return { kind: "seed", value: Number(seed[1]) };
  const winner = text.match(/^winner\s*:?\s*(.+)$/i);
  if (winner) return { kind: "winner", value: normLabel(winner[1]) };
  const loser = text.match(/^loser\s*:?\s*(.+)$/i);
  if (loser) return { kind: "loser", value: normLabel(loser[1]) };
  if (/^(tbd|tba|bye)$/i.test(text)) return { kind: "empty", value: "" };
  return { kind: "team", value: text };
}

function refToken(ref) {
  if (!ref || ref.kind === "empty") return "";
  if (ref.kind === "seed") return "seed:" + ref.value;
  if (ref.kind === "winner") return "winner:" + ref.value;
  if (ref.kind === "loser") return "loser:" + ref.value;
  return ref.value || "";
}

function displayRef(raw, flightName) {
  const ref = typeof raw === "object" && raw && raw.kind ? raw : parseRef(raw);
  if (!ref || ref.kind === "empty") return "";
  if (ref.kind === "seed") {
    const o = ordinal(ref.value);
    return flightName ? o + " (" + flightName + ")" : o;
  }
  if (ref.kind === "winner") return "W" + ref.value;
  if (ref.kind === "loser") return "L" + ref.value;
  return ref.value;
}

function seedPositions(size) {
  let pos = [1];
  while (pos.length < size) {
    const next = [];
    const m = pos.length * 2 + 1;
    for (let i = 0; i < pos.length; i++) {
      next.push(pos[i]);
      next.push(m - pos[i]);
    }
    pos = next;
  }
  return pos;
}

function winnerRoundNames(bracketSize) {
  const names = [];
  let size = Number(bracketSize) || 2;
  while (size >= 2) {
    if (size === 2) names.push("F");
    else if (size === 4) names.push("SF");
    else if (size === 8) names.push("QF");
    else names.push("R" + size);
    size = size / 2;
  }
  return names;
}

function asList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    return v.split(/[,|\n]/).map(function (s) { return String(s).trim(); }).filter(Boolean);
  }
  return [];
}

function asIdList(v) {
  return asList(v).map(function (s) { return String(s); }).filter(Boolean);
}

function flag(v, fallback) {
  if (v === undefined || v === null || v === "") return fallback;
  return v === true || v === "true" || v === "on" || v === "1" || v === 1;
}

function pad(n) {
  return n < 10 ? "0" + n : String(n);
}

function addMinutes(hhmm, mins) {
  const parts = String(hhmm || "08:00").split(":");
  const total = Number(parts[0] || 0) * 60 + Number(parts[1] || 0) + Number(mins || 0);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return pad(Math.floor(wrapped / 60)) + ":" + pad(wrapped % 60);
}

function teamKey(t) {
  return String((t && (t.id || t.team_id)) || "");
}

function normalizeFlight(raw, index) {
  raw = raw || {};
  const fallback = "bracket-" + (index + 1);
  const name = String(raw.name || raw.label || raw.id || "").trim();
  const id = slugify(raw.id || name, fallback);
  const fmt = String(raw.format || "").trim();
  return {
    id: id,
    name: name || ("Bracket " + (index + 1)),
    format: fmt,
    size: Number(raw.size || 0) || 0,
    team_ids: asIdList(raw.team_ids || raw.teams),
    seeds: asList(raw.seeds || raw.seeds_text).map(Number).filter(function (n) { return n > 0; }),
    seed_from: Number(raw.seed_from || 0) || 0,
    seed_to: Number(raw.seed_to || 0) || 0,
    seed_mode: String(raw.seed_mode || "reseed").toLowerCase(),
    pairing: String(raw.pairing || "high-low").toLowerCase(),
    bye_mode: String(raw.bye_mode || "top-seeds").toLowerCase(),
    bye_seeds: asList(raw.bye_seeds || raw.bye_seeds_text).map(Number).filter(function (n) { return n > 0; }),
    pool_place_from: Number(raw.pool_place_from || 0) || 0,
    pool_place_to: Number(raw.pool_place_to || 0) || 0,
    consolation: flag(raw.consolation, false),
    third_place: flag(raw.third_place, false),
    if_necessary: flag(raw.if_necessary, fmt === "double-elim" || fmt === "4gg-double-elim"),
    fields: asList(raw.fields || raw.field_names),
    start_time: String(raw.start_time || ""),
    slot_minutes: Number(raw.slot_minutes || 0) || 0,
    finish_time: String(raw.finish_time || ""),
    later_slot_for_top_seeds: flag(raw.later_slot_for_top_seeds, true),
    date: String(raw.date || ""),
    draw_seed: Number(raw.draw_seed || 0) || 0,
    game_prefix: String(raw.game_prefix || "G") || "G",
  };
}

function legacyFlights(key) {
  const k = String(key || "none").toLowerCase();
  if (k === "gold-silver") return [{ id: "gold", name: "Gold" }, { id: "silver", name: "Silver" }];
  if (k === "platinum-gold-silver") {
    return [{ id: "platinum", name: "Platinum" }, { id: "gold", name: "Gold" }, { id: "silver", name: "Silver" }];
  }
  return [];
}

function parsePlan(raw) {
  const data = decodeJson(raw) || raw;
  if (!data) return { flights: [] };
  if (Array.isArray(data)) return { flights: data.map(normalizeFlight) };
  if (Array.isArray(data.flights)) return { flights: data.flights.map(normalizeFlight) };
  return { flights: [] };
}

function planFromInputs(event, body) {
  body = body || {};
  let plan = parsePlan(body.bracket_plan);
  if (!plan.flights.length && event) {
    plan = parsePlan(event.get ? event.get("bracket_plan") : event.bracket_plan);
  }
  if (!plan.flights.length && event) {
    try {
      const sched = decodeJson(event.get ? event.get("scheduler") : event.scheduler) || {};
      if (sched && sched.bracket_plan) plan = parsePlan(sched.bracket_plan);
    } catch (err) {}
  }
  if (!plan.flights.length) {
    const key = body.bracket_flights != null
      ? body.bracket_flights
      : (event && event.get ? event.get("bracket_flights") : event && event.bracket_flights);
    const legacy = legacyFlights(key);
    if (legacy.length) plan = { flights: legacy.map(normalizeFlight) };
  }
  if (!plan.flights.length) {
    const one = normalizeFlight({ id: "", name: "" }, 0);
    one.id = "";
    one.name = "";
    plan = { flights: [one] };
  }
  return plan;
}

function summarizeKey(plan) {
  const flights = (plan && plan.flights) || [];
  if (flights.length <= 1) return "none";
  const ids = flights.map(function (f) { return String(f.id || "").toLowerCase(); });
  const joined = ids.join("-");
  if (joined === "gold-silver") return "gold-silver";
  if (joined === "platinum-gold-silver") return "platinum-gold-silver";
  return "custom";
}

function flightHasSplit(fl) {
  if (!fl) return false;
  return !!(fl.size > 0 || (fl.team_ids && fl.team_ids.length) || (fl.seeds && fl.seeds.length)
    || (fl.seed_from && fl.seed_to)
    || (fl.pool_place_from && fl.pool_place_to));
}

function overallOf(row) {
  return Number((row && (row.overall_seed || row.seed)) || 0);
}

function poolPlaceOf(row) {
  return Number((row && (row.pool_place || row.pool_rank)) || 0);
}

function placeholderSeeds(count) {
  const out = [];
  const n = Number(count) || 0;
  for (let i = 0; i < n; i++) {
    out.push({ id: "", name: "", seed: i + 1, overall_seed: i + 1, pool: "" });
  }
  return out;
}

function applySeedMode(teams, flight) {
  const mode = (flight && flight.seed_mode) || "reseed";
  return (teams || []).map(function (t, i) {
    const overall = Number(t.seed || t.overall_seed || (i + 1));
    const local = mode === "overall" ? overall : (i + 1);
    return {
      id: t.id || "",
      name: t.name || "",
      seed: local,
      overall_seed: overall,
      pool: t.pool || "",
    };
  });
}

function assignFlights(seeds, plan, opts) {
  opts = opts || {};
  const flights = ((plan && plan.flights) || []).slice();
  const remaining = (seeds || []).slice();
  const used = {};
  const warnings = [];
  const out = [];

  function takeMatching(pred) {
    const keep = [];
    const picked = [];
    for (let i = 0; i < remaining.length; i++) {
      if (pred(remaining[i], i)) picked.push(remaining[i]);
      else keep.push(remaining[i]);
    }
    remaining.length = 0;
    for (let i = 0; i < keep.length; i++) remaining.push(keep[i]);
    return picked;
  }

  for (let i = 0; i < flights.length; i++) {
    const fl = flights[i];
    let picked = [];
    if (fl.team_ids && fl.team_ids.length) {
      const order = {};
      for (let t = 0; t < fl.team_ids.length; t++) order[String(fl.team_ids[t])] = t;
      picked = takeMatching(function (row) { return order[teamKey(row)] != null; });
      picked.sort(function (a, b) { return order[teamKey(a)] - order[teamKey(b)]; });
      if (opts.empty && !picked.length) picked = placeholderSeeds(fl.team_ids.length || fl.size);
    } else if (fl.seeds && fl.seeds.length) {
      const order = {};
      for (let t = 0; t < fl.seeds.length; t++) order[fl.seeds[t]] = t;
      picked = takeMatching(function (row) {
        return order[overallOf(row)] != null;
      });
      picked.sort(function (a, b) {
        return order[overallOf(a)] - order[overallOf(b)];
      });
    } else if (fl.pool_place_from && fl.pool_place_to && fl.pool_place_to >= fl.pool_place_from) {
      picked = takeMatching(function (row) {
        const n = poolPlaceOf(row);
        return n >= fl.pool_place_from && n <= fl.pool_place_to;
      });
      picked.sort(function (a, b) {
        const pa = poolPlaceOf(a) - poolPlaceOf(b);
        if (pa) return pa;
        return overallOf(a) - overallOf(b);
      });
    } else if (fl.seed_from && fl.seed_to && fl.seed_to >= fl.seed_from) {
      picked = takeMatching(function (row) {
        const n = overallOf(row);
        return n >= fl.seed_from && n <= fl.seed_to;
      });
    } else if (fl.size > 0) {
      if (opts.empty && !remaining.length) picked = placeholderSeeds(fl.size);
      else picked = remaining.splice(0, fl.size);
    } else if (flights.length === 1) {
      if (opts.empty && !remaining.length) {
        const n = Number(opts.registered || 0);
        picked = placeholderSeeds(n >= 2 ? n : 0);
      } else {
        picked = remaining.splice(0, remaining.length);
      }
    } else if (opts.empty) {
      picked = [];
    }
    for (let t = 0; t < picked.length; t++) {
      const id = teamKey(picked[t]);
      if (id && used[id]) warnings.push((picked[t].name || id) + " is in more than one bracket");
      if (id) used[id] = fl.id;
    }
    const seeded = applySeedMode(picked, fl);
    out.push({ flight: fl, teams: seeded, seeds: seeded });
  }
  return { flights: out, leftover: remaining.length, warnings: warnings };
}

function mulberry32(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function () {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function firstRoundPairs(teams, pairing, drawSeed) {
  const n = (teams || []).length;
  if (n < 2) return [];
  const size = nextPowerOfTwo(n);
  const kind = String(pairing || "high-low").toLowerCase();
  if (kind === "blind") {
    const rng = mulberry32(drawSeed || 1);
    const shuffled = teams.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    const pairs = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      pairs.push({
        home: shuffled[i],
        away: shuffled[i + 1] || null,
        slot: pairs.length + 1,
        home_seed: shuffled[i] ? shuffled[i].seed : 0,
        away_seed: shuffled[i + 1] ? shuffled[i + 1].seed : 0,
      });
    }
    return pairs;
  }
  if (kind === "split-field") {
    const half = size / 2;
    const pairs = [];
    for (let i = 0; i < half; i++) {
      pairs.push({
        home: teams[i] || null,
        away: teams[i + half] || null,
        slot: i + 1,
        home_seed: i + 1,
        away_seed: i + 1 + half,
      });
    }
    return pairs;
  }
  const pos = seedPositions(size);
  const pairs = [];
  for (let i = 0; i < pos.length; i += 2) {
    const hs = pos[i];
    const as = pos[i + 1];
    pairs.push({
      home: hs <= n ? teams[hs - 1] : null,
      away: as <= n ? teams[as - 1] : null,
      slot: pairs.length + 1,
      home_seed: hs,
      away_seed: as,
    });
  }
  return pairs;
}

function rematchKey(a, b) {
  const ida = teamKey(a);
  const idb = teamKey(b);
  if (!ida || !idb) return "";
  return ida < idb ? ida + "|" + idb : idb + "|" + ida;
}

function applyCrossPool(pairs, rematches) {
  const swaps = [];
  if (!rematches || !rematches.length) return { pairs: pairs, swaps: swaps };
  const set = {};
  for (let i = 0; i < rematches.length; i++) set[rematches[i]] = true;
  const out = pairs.slice();
  for (let i = 0; i < out.length; i++) {
    const key = rematchKey(out[i].home, out[i].away);
    if (!key || !set[key]) continue;
    let swapped = false;
    for (let j = i + 1; j < out.length; j++) {
      const aKey = rematchKey(out[i].home, out[j].away);
      const bKey = rematchKey(out[j].home, out[i].away);
      if ((!aKey || !set[aKey]) && (!bKey || !set[bKey])) {
        const tmp = out[i].away;
        out[i].away = out[j].away;
        out[j].away = tmp;
        const tmpS = out[i].away_seed;
        out[i].away_seed = out[j].away_seed;
        out[j].away_seed = tmpS;
        swaps.push("Swapped a pool rematch out of round one");
        swapped = true;
        break;
      }
    }
    if (!swapped) swaps.push("Could not avoid a pool rematch in round one");
  }
  return { pairs: out, swaps: swaps };
}

function seatRef(team) {
  if (!team) return "";
  if (team.ref) return team.ref;
  if (team.seed) return "seed:" + team.seed;
  return "";
}

function teamPresent(team) {
  return !!(team && (team.id || team.seed || team.ref));
}

function newGame(partial) {
  return {
    round: partial.round || "",
    slot: Number(partial.slot || 1),
    side: partial.side || "championship",
    kind: partial.kind || "winners",
    home: partial.home || null,
    away: partial.away || null,
    home_id: partial.home && partial.home.id ? partial.home.id : "",
    away_id: partial.away && partial.away.id ? partial.away.id : "",
    home_ref: partial.home_ref != null ? partial.home_ref : seatRef(partial.home),
    away_ref: partial.away_ref != null ? partial.away_ref : seatRef(partial.away),
    is_bye: !!partial.is_bye,
    game_id: partial.game_id || "",
    date: partial.date || "",
    time: partial.time || "",
    field: partial.field || "",
    winner_to: partial.winner_to || "",
    loser_to: partial.loser_to || "",
    flight: partial.flight || "",
    flight_name: partial.flight_name || "",
  };
}

function orderFirstRound(pairs, laterTop) {
  if (!laterTop || pairs.length <= 2) return pairs.slice();
  const half = Math.ceil(pairs.length / 2);
  const first = pairs.slice(0, half);
  const second = pairs.slice(half);
  const firstHasOne = first.some(function (p) {
    return Number(p.home_seed || (p.home && p.home.seed) || 99) === 1
      || Number(p.away_seed || (p.away && p.away.seed) || 99) === 1;
  });
  return firstHasOne ? second.concat(first) : first.concat(second);
}

function splitManualByes(teams, flight, need) {
  const listed = {};
  const byeTeams = [];
  const play = [];
  const seeds = flight.bye_seeds || [];
  for (let i = 0; i < seeds.length; i++) listed[Number(seeds[i])] = true;
  for (let i = 0; i < (teams || []).length; i++) {
    const t = teams[i];
    if (listed[Number(t.seed)]) byeTeams.push(t);
    else play.push(t);
  }
  const want = Math.max(Number(need) || 0, byeTeams.length);
  play.sort(function (a, b) { return Number(a.seed || 99) - Number(b.seed || 99); });
  while (byeTeams.length < want && play.length) {
    byeTeams.push(play.shift());
  }
  return { play: play, byes: byeTeams };
}

function buildSingleElimGames(teams, flight, opts) {
  opts = opts || {};
  flight = flight || normalizeFlight({}, 0);
  const n = (teams || []).length;
  const games = [];
  const byes = [];
  const notes = [];
  if (n < 2) return { games: games, byes: byes, notes: notes, feeds: {} };
  const size = nextPowerOfTwo(n);
  const byeCount = size - n;
  let pairs;
  if (flight.bye_mode === "manual" && flight.bye_seeds && flight.bye_seeds.length) {
    const split = splitManualByes(teams, flight, byeCount);
    pairs = firstRoundPairs(split.play, flight.pairing || "high-low", flight.draw_seed);
    for (let b = 0; b < split.byes.length; b++) {
      pairs.push({
        home: split.byes[b],
        away: null,
        slot: pairs.length + 1,
        home_seed: split.byes[b] && split.byes[b].seed,
        away_seed: 0,
      });
    }
    notes.push("Director-picked byes: seeds " + flight.bye_seeds.join(", "));
  } else {
    pairs = firstRoundPairs(teams, flight.pairing || "high-low", flight.draw_seed);
  }
  if ((flight.pairing || "") === "cross-pool") {
    const adjusted = applyCrossPool(pairs, opts.rematches || []);
    pairs = adjusted.pairs;
    for (let i = 0; i < adjusted.swaps.length; i++) notes.push(adjusted.swaps[i]);
  }
  const rounds = winnerRoundNames(size);
  const firstRound = rounds[0];
  const ordered = orderFirstRound(pairs, flight.later_slot_for_top_seeds !== false);
  const firstGames = [];
  const advances = [];
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i];
    const homeOk = teamPresent(p.home);
    const awayOk = teamPresent(p.away);
    const slot = i + 1;
    if (homeOk && awayOk) {
      const g = newGame({
        round: firstRound,
        slot: slot,
        side: "championship",
        kind: "winners",
        home: p.home,
        away: p.away,
        flight: flight.id,
        flight_name: flight.name,
      });
      firstGames.push(g);
      games.push(g);
      advances.push({ from: g, slot: slot });
    } else {
      const adv = homeOk ? p.home : p.away;
      const bye = newGame({
        round: firstRound,
        slot: slot,
        side: "championship",
        kind: "winners",
        home: adv,
        away: null,
        is_bye: true,
        flight: flight.id,
        flight_name: flight.name,
        home_ref: seatRef(adv),
        away_ref: "",
      });
      games.push(bye);
      byes.push({
        seed: adv && adv.seed,
        team_id: adv && adv.id || "",
        round: firstRound,
        slot: slot,
      });
      advances.push({ team: adv, slot: slot, bye: bye });
    }
  }
  let prev = advances;
  for (let r = 1; r < rounds.length; r++) {
    const next = [];
    const roundName = rounds[r];
    for (let i = 0; i < prev.length; i += 2) {
      const a = prev[i];
      const b = prev[i + 1];
      const slot = Math.floor(i / 2) + 1;
      const home = a && a.team ? a.team : null;
      const away = b && b.team ? b.team : null;
      const g = newGame({
        round: roundName,
        slot: slot,
        side: "championship",
        kind: "winners",
        home: home,
        away: away,
        home_ref: home ? seatRef(home) : (a && a.from ? "winner:" + (a.from.uid || "") : ""),
        away_ref: away ? seatRef(away) : (b && b.from ? "winner:" + (b.from.uid || "") : ""),
        flight: flight.id,
        flight_name: flight.name,
      });
      g._fromA = a;
      g._fromB = b;
      games.push(g);
      next.push({ from: g, slot: slot });
    }
    prev = next;
  }
  if (opts.third_place || flight.third_place) {
    games.push(newGame({
      round: "3RD",
      slot: 1,
      side: "consolation",
      kind: "consolation",
      flight: flight.id,
      flight_name: flight.name,
    }));
  }
  if (opts.consolation || flight.consolation) {
    if (size >= 8) {
      games.push(newGame({
        round: "5TH", slot: 1, side: "consolation", kind: "consolation",
        flight: flight.id, flight_name: flight.name,
      }));
      games.push(newGame({
        round: "7TH", slot: 1, side: "consolation", kind: "consolation",
        flight: flight.id, flight_name: flight.name,
      }));
    }
    if (!opts.third_place && !flight.third_place && size >= 4) {
      games.push(newGame({
        round: "3RD", slot: 1, side: "consolation", kind: "consolation",
        flight: flight.id, flight_name: flight.name,
      }));
    }
  }
  if (byeCount) notes.push(byeCount + " bye" + (byeCount === 1 ? "" : "s") + " — not games");
  return { games: games, byes: byes, notes: notes, feeds: {}, first_round: firstRound };
}

function buildDoubleElimGames(teams, flight, opts) {
  const winners = buildSingleElimGames(teams, flight, {
    consolation: false,
    third_place: false,
    rematches: opts && opts.rematches,
  });
  const n = (teams || []).length;
  if (n < 2) return winners;
  const size = nextPowerOfTwo(n);
  const loserCount = Math.max(0, size - 2);
  const names = [];
  if (loserCount === 1) names.push("LF");
  else if (loserCount === 2) { names.push("L1"); names.push("LF"); }
  else if (loserCount > 2) {
    let left = loserCount;
    let r = 1;
    while (left > 1) {
      const take = left > 3 ? 2 : 1;
      for (let k = 0; k < take && left > 1; k++) {
        names.push("L" + r);
        left -= 1;
      }
      r += 1;
    }
    names.push("LF");
  }
  const slotByRound = {};
  for (let i = 0; i < names.length; i++) {
    const rec = newGame({
      round: names[i],
      slot: (slotByRound[names[i]] || 0) + 1,
      side: "losers",
      kind: "losers",
      flight: flight.id,
      flight_name: flight.name,
    });
    slotByRound[names[i]] = rec.slot;
    winners.games.push(rec);
  }
  if (flight.if_necessary || (opts && opts.if_necessary)) {
    winners.games.push(newGame({
      round: "IFN",
      slot: 1,
      side: "championship",
      kind: "winners",
      flight: flight.id,
      flight_name: flight.name,
    }));
    winners.notes.push("If-necessary championship included");
  }
  return winners;
}

function scheduleGames(games, flight, defaults) {
  defaults = defaults || {};
  flight = flight || {};
  const fields = (flight.fields && flight.fields.length) ? flight.fields.slice() : (defaults.fields || []).slice();
  const start = flight.start_time || defaults.start || "09:30";
  const span = Number(flight.slot_minutes || defaults.slot_minutes || 90) || 90;
  const date = flight.date || defaults.date || "";
  const playable = games.filter(function (g) { return !g.is_bye; });
  const byRound = [];
  const seen = {};
  for (let i = 0; i < playable.length; i++) {
    const r = playable[i].round;
    if (!seen[r]) {
      seen[r] = [];
      byRound.push({ round: r, games: seen[r] });
    }
    seen[r].push(playable[i]);
  }
  let cursor = start;
  const fieldCount = Math.max(fields.length, 1);
  for (let r = 0; r < byRound.length; r++) {
    const pack = byRound[r].games;
    let idx = 0;
    while (idx < pack.length) {
      const take = Math.min(fieldCount, pack.length - idx);
      const chunk = pack.slice(idx, idx + take).sort(function (a, b) {
        function best(g) {
          const hs = Number((g.home && g.home.seed) || 99);
          const as = Number((g.away && g.away.seed) || 99);
          return Math.min(hs, as);
        }
        return best(a) - best(b);
      });
      for (let k = 0; k < chunk.length; k++) {
        const g = chunk[k];
        g.date = date;
        g.time = cursor;
        if (fields.length) g.field = fields[k % fields.length];
      }
      idx += take;
      if (idx < pack.length) cursor = addMinutes(cursor, span);
    }
    if (r < byRound.length - 1) cursor = addMinutes(cursor, span);
  }
  const prefix = flight.game_prefix || "G";
  let n = 1;
  for (let i = 0; i < playable.length; i++) {
    if (!playable[i].game_id) {
      playable[i].game_id = prefix + n;
      n += 1;
    }
  }
  for (let i = 0; i < games.length; i++) {
    if (games[i].uid == null) games[i].uid = games[i].game_id || (games[i].round + "-" + games[i].slot);
  }
  wireWinnerRefs(games);
  return games;
}

function wireWinnerRefs(games) {
  const byUid = {};
  for (let i = 0; i < games.length; i++) {
    if (games[i].uid) byUid[games[i].uid] = games[i];
    if (games[i].game_id) byUid[games[i].game_id] = games[i];
  }
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (g._fromA && g._fromA.from) {
      const src = g._fromA.from;
      src.winner_to = g.game_id || g.uid;
      if (!g.home_id) g.home_ref = "winner:" + (src.game_id || src.uid);
    } else if (g._fromA && g._fromA.team) {
      if (!g.home_ref) g.home_ref = seatRef(g._fromA.team);
    }
    if (g._fromB && g._fromB.from) {
      const src = g._fromB.from;
      src.winner_to = g.game_id || g.uid;
      if (!g.away_id) g.away_ref = "winner:" + (src.game_id || src.uid);
    } else if (g._fromB && g._fromB.team) {
      if (!g.away_ref) g.away_ref = seatRef(g._fromB.team);
    }
  }
}

function formatIsDouble(fmt) {
  return fmt === "double-elim" || fmt === "pool-double-elim" || fmt === "4gg-double-elim";
}

function summarizeFlight(flight, teams, built) {
  const bits = [];
  bits.push(flight.name || "Bracket");
  bits.push((teams || []).length + " team" + ((teams || []).length === 1 ? "" : "s"));
  bits.push((flight.pairing || "high-low") + " pairing");
  bits.push(flight.format || "event format");
  const byeN = (built.byes || []).length;
  if (byeN) {
    bits.push(byeN + " bye" + (byeN === 1 ? "" : "s")
      + (flight.bye_mode === "manual" && flight.bye_seeds && flight.bye_seeds.length
        ? " picked by the director"
        : " to top seeds"));
  }
  return bits.join(", ");
}

function buildEventBracket(assigned, opts) {
  opts = opts || {};
  const flights = (assigned && assigned.flights) || [];
  const all = [];
  const summaries = [];
  const notes = (assigned && assigned.warnings || []).slice();
  const drawn = [];
  for (let i = 0; i < flights.length; i++) {
    const row = flights[i];
    const fl = row.flight;
    const teams = row.teams || [];
    const fmt = fl.format || opts.eventFormat || "pool-to-bracket";
    if (teams.length < 2 && !opts.allowEmpty) {
      drawn.push({ flight: fl.id || "", name: fl.name || "", seeds: teams.length, games: 0, byes: 0 });
      continue;
    }
    const built = formatIsDouble(fmt)
      ? buildDoubleElimGames(teams, fl, { rematches: opts.rematches, if_necessary: fl.if_necessary })
      : buildSingleElimGames(teams, fl, {
        consolation: fl.consolation || (opts.consolation && flights.length === 1),
        third_place: fl.third_place,
        rematches: opts.rematches,
      });
    scheduleGames(built.games, fl, {
      fields: fl.fields.length ? fl.fields : (opts.eventFields || []),
      start: fl.start_time || opts.start,
      slot_minutes: fl.slot_minutes || opts.slot_minutes,
      date: fl.date || opts.date,
    });
    const playable = built.games.filter(function (g) { return !g.is_bye; }).length;
    for (let g = 0; g < built.games.length; g++) all.push(built.games[g]);
    for (let n = 0; n < (built.notes || []).length; n++) notes.push((fl.name || fl.id) + ": " + built.notes[n]);
    summaries.push(summarizeFlight(fl, teams, built));
    drawn.push({
      flight: fl.id || "",
      name: fl.name || "",
      seeds: teams.length,
      games: playable,
      byes: (built.byes || []).length,
    });
  }
  return {
    games: all,
    flights: drawn,
    summary: summaries.join(". "),
    notes: notes,
    leftover: assigned && assigned.leftover || 0,
  };
}

function feedsFromGames(games) {
  const feeds = {};
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    const label = normLabel(g.game_id || "");
    if (!label && g.is_bye) continue;
    const key = (g.flight ? String(g.flight).toLowerCase() + ":" : "") + (label || (g.round + g.slot));
    feeds[key] = {
      home_ref: g.home_ref || "",
      away_ref: g.away_ref || "",
      winner_to: g.winner_to || "",
      loser_to: g.loser_to || "",
      flight: g.flight || "",
    };
    if (label) {
      feeds[label] = feeds[label] || feeds[key];
    }
  }
  return feeds;
}

function missingSplits(assigned) {
  const rows = (assigned && assigned.flights) || [];
  if (rows.length <= 1) return [];
  const miss = [];
  for (let i = 0; i < rows.length; i++) {
    if (!(rows[i].teams || []).length && !flightHasSplit(rows[i].flight)) {
      miss.push(rows[i].flight.name || rows[i].flight.id || ("Bracket " + (i + 1)));
    }
  }
  return miss;
}

module.exports = {
  decodeJson: decodeJson,
  slugify: slugify,
  nextPowerOfTwo: nextPowerOfTwo,
  ordinal: ordinal,
  parseRef: parseRef,
  refToken: refToken,
  displayRef: displayRef,
  seedPositions: seedPositions,
  winnerRoundNames: winnerRoundNames,
  normalizeFlight: normalizeFlight,
  parsePlan: parsePlan,
  planFromInputs: planFromInputs,
  summarizeKey: summarizeKey,
  flightHasSplit: flightHasSplit,
  assignFlights: assignFlights,
  placeholderSeeds: placeholderSeeds,
  firstRoundPairs: firstRoundPairs,
  applyCrossPool: applyCrossPool,
  buildSingleElimGames: buildSingleElimGames,
  buildDoubleElimGames: buildDoubleElimGames,
  scheduleGames: scheduleGames,
  buildEventBracket: buildEventBracket,
  feedsFromGames: feedsFromGames,
  missingSplits: missingSplits,
  formatIsDouble: formatIsDouble,
  addMinutes: addMinutes,
  splitManualByes: splitManualByes,
};
