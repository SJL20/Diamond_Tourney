/// <reference path="../pb_data/types.d.ts" />

const SLOT_BUFFER = 15;
const DEFAULT_GAME_MINUTES = 90;

function minutesOf(hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 8 * 60;
  return Number(m[1]) * 60 + Number(m[2]);
}

function slotMinutes(event) {
  return (Number(event.get("game_length_minutes") || DEFAULT_GAME_MINUTES) || DEFAULT_GAME_MINUTES) + SLOT_BUFFER;
}

function dayList(event) {
  try {
    const days = require(__hooks + "/schedule.js").parseScheduler(event.get("scheduler")).days || [];
    if (days.length) return days;
  } catch (err) {}
  const start = String(event.get("start") || "").slice(0, 10);
  const end = String(event.get("end") || "").slice(0, 10);
  if (start && end && end !== start) return [start, end];
  if (start) return [start];
  return [];
}

function openFieldCount(app, event) {
  try {
    return app.findRecordsByFilter("fields", "event = {:e} && status != 'closed'", "name", 400, 0, { e: event.id }).length;
  } catch (err) {
    return 0;
  }
}

function teamCount(app, event) {
  try {
    return app.findRecordsByFilter("event_teams", "event = {:e}", "name", 200, 0, { e: event.id }).length;
  } catch (err) {
    return 0;
  }
}

function gamesPerTeam(event) {
  try {
    const n = Number(require(__hooks + "/schedule.js").parseScheduler(event.get("scheduler")).games_per_team || 2);
    return n > 0 ? n : 2;
  } catch (err) {
    return 2;
  }
}

function windowHours(event) {
  const start = minutesOf(event.get("hours_start") || "08:00");
  const end = minutesOf(event.get("hours_end") || "18:00");
  const hours = (end - start) / 60;
  return hours > 0 ? hours : 10;
}

function bracketNeed(format, teams) {
  const n = Number(teams) || 0;
  if (n < 2) return { games: 0, rounds: 0, note: "Need two teams for a bracket." };
  if (format === "pool-only" || format === "round-robin") {
    return { games: 0, rounds: 0, note: "This format has no bracket." };
  }
  if (format === "double-elim" || format === "pool-double-elim") {
    return { games: n * 2 - 1, rounds: n <= 8 ? 4 : 5, note: "Double elim is about 2n−1 games." };
  }
  return { games: n - 1, rounds: Math.ceil(Math.log(n) / Math.log(2)), note: "Single elim is n−1 games." };
}

function fit(app, event) {
  const fields = openFieldCount(app, event);
  const days = dayList(event);
  const teams = teamCount(app, event);
  const gpt = gamesPerTeam(event);
  const slot = slotMinutes(event);
  const hours = windowHours(event);
  const slotsPerFieldDay = Math.floor((hours * 60) / slot);
  const totalSlots = fields * Math.max(days.length, 1) * Math.max(slotsPerFieldDay, 0);
  const poolGames = Math.ceil((teams * gpt) / 2);
  const format = event.get("format") || "pool-to-bracket";
  const bracket = bracketNeed(format, teams);
  const leftover = totalSlots - poolGames - bracket.games;
  const lines = [
    fields + " fields × " + (days.length || 1) + " day(s) × " + slotsPerFieldDay + " slots (" + hours + "h window ÷ " + slot + " min) = " + totalSlots + " game slots.",
    teams + " teams × " + gpt + " pool games each = " + poolGames + " pool games.",
  ];
  if (bracket.games) {
    lines.push("Bracket: " + teams + " teams → " + bracket.games + " games, " + bracket.rounds + " rounds. " + bracket.note);
  }
  lines.push(leftover >= 0
    ? "Fits with " + leftover + " spare slot(s)."
    : "Short by " + (-leftover) + " slot(s).");
  if (bracket.games && fields && bracket.rounds) {
    const firstRound = Math.ceil(teams / 2);
    if (firstRound > fields) {
      lines.push("Tightest point: round 1 wants " + firstRound + " games; with " + fields + " fields, some pair waits a slot.");
    }
  }
  return {
    question: "fit",
    numbers: {
      fields: fields,
      days: days.length || 1,
      hours: hours,
      slot_minutes: slot,
      slots_per_field_day: slotsPerFieldDay,
      total_slots: totalSlots,
      teams: teams,
      games_per_team: gpt,
      pool_games: poolGames,
      bracket_games: bracket.games,
      leftover: leftover,
    },
    math: lines,
    answer: leftover >= 0
      ? "This weekend fits the posted fields and hours."
      : "This weekend does not fit the posted fields and hours.",
    label: "assistant-generated",
  };
}

function loseField(app, event, fieldName, fromTime) {
  const base = fit(app, event);
  const fields = Math.max(0, base.numbers.fields - (fieldName ? 1 : 0));
  const slot = base.numbers.slot_minutes;
  const hours = base.numbers.hours;
  const after = fromTime ? minutesOf(fromTime) : minutesOf(event.get("hours_start") || "08:00");
  const end = minutesOf(event.get("hours_end") || "18:00");
  const remainHours = Math.max(0, (end - after) / 60);
  const lostSlots = Math.floor((remainHours * 60) / slot);
  const leftover = base.numbers.total_slots - lostSlots - base.numbers.pool_games - base.numbers.bracket_games;
  const lines = base.math.slice();
  lines.push("If " + (fieldName || "one field") + " is down from " + (fromTime || "first pitch") + ", you lose about " + lostSlots + " slot(s).");
  lines.push(leftover >= 0
    ? "Still fits with " + leftover + " spare slot(s)."
    : "You are short " + (-leftover) + " slot(s). Options: drop a pool game per team, move a flight later, or add a field.");
  return {
    question: "lose_field",
    field: fieldName || "",
    from_time: fromTime || "",
    numbers: {
      lost_slots: lostSlots,
      leftover_if_lost: leftover,
      remaining_fields: fields,
    },
    math: lines,
    answer: leftover >= 0
      ? "You can absorb losing that field in the remaining window."
      : "Losing that field does not fit without changing the plan.",
    label: "assistant-generated",
  };
}

function behind(app, event) {
  const now = Date.now();
  let rows = [];
  try {
    rows = app.findRecordsByFilter("event_schedule", "event = {:e}", "date,time", 400, 0, { e: event.id });
  } catch (err) { rows = []; }
  let scheduled = 0;
  let due = 0;
  let done = 0;
  for (let i = 0; i < rows.length; i++) {
    const g = rows[i];
    if (g.get("status") === "cancelled") continue;
    scheduled++;
    const start = (function () {
      const d = String(g.get("date") || "");
      const t = String(g.get("time") || "");
      const m = (d + "T" + t).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2}):(\d{2})/);
      if (!m) return 0;
      return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
    })();
    if (start && start <= now) due++;
    if (g.get("status") === "final") done++;
  }
  const late = Math.max(0, due - done);
  const lines = [
    scheduled + " pool games on the board.",
    due + " should have started by now.",
    done + " are final.",
    late + " started (or should have) without a final.",
  ];
  return {
    question: "behind",
    numbers: { scheduled: scheduled, due: due, final: done, late: late },
    math: lines,
    answer: late === 0
      ? "The posted pool grid is on time."
      : "You are " + late + " final(s) behind the clock.",
    label: "assistant-generated",
  };
}

function answer(app, event, query) {
  const q = String((query && query.q) || "fit");
  if (q === "lose_field") return loseField(app, event, query.field || "", query.time || "");
  if (q === "behind") return behind(app, event);
  if (q === "fit") return fit(app, event);
  return {
    question: q,
    math: [],
    answer: "I don't know that question. I only answer: will this schedule fit, what happens if I lose a field, and how far behind am I.",
    label: "assistant-generated",
  };
}

module.exports = {
  answer: answer,
  fit: fit,
};
