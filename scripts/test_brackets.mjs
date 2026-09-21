import { createRequire } from "module";

const require = createRequire(import.meta.url);
const br = require("../pb/pb_hooks/brackets.js");

function eq(got, want, label) {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
}

eq(br.nextPowerOfTwo(6), 8, "power of two 6");
eq(br.nextPowerOfTwo(8), 8, "power of two 8");
eq(br.seedPositions(8), [1, 8, 4, 5, 2, 7, 3, 6], "classic 8-team seats");
eq(br.ordinal(1), "1st", "1st");
eq(br.ordinal(2), "2nd", "2nd");
eq(br.ordinal(3), "3rd", "3rd");
eq(br.ordinal(11), "11th", "11th");
eq(br.displayRef("seed:3"), "3rd", "seed display");
eq(br.displayRef("winner:G1"), "WG1", "winner display");
eq(br.displayRef("loser:G3"), "LG3", "loser display");

const teams = [];
for (let i = 1; i <= 14; i++) teams.push({ id: "t" + i, name: "Team " + i, seed: i });
const assigned = br.assignFlights(teams, {
  flights: [
    { id: "gold", name: "Gold", size: 8 },
    { id: "silver", name: "Silver", size: 6 },
  ],
});
eq(assigned.flights[0].teams.length, 8, "gold size 8");
eq(assigned.flights[1].teams.length, 6, "silver size 6");
eq(assigned.leftover, 0, "no leftover");

const even = br.assignFlights(teams, {
  flights: [
    { id: "gold", name: "Gold" },
    { id: "silver", name: "Silver" },
  ],
});
eq(even.flights[0].teams.length, 0, "no auto split gold");
eq(even.flights[1].teams.length, 0, "no auto split silver");
eq(br.missingSplits(even).length, 2, "missing both splits");

const silver = assigned.flights[1].teams;
const built = br.buildSingleElimGames(silver, br.normalizeFlight({
  id: "silver", name: "Silver", pairing: "high-low", later_slot_for_top_seeds: true,
}, 1));
const playable = built.games.filter((g) => !g.is_bye);
const byes = built.games.filter((g) => g.is_bye);
if (byes.length !== 2) throw new Error("silver needs two byes, got " + byes.length);
if (playable.filter((g) => g.round === "QF").length !== 2) throw new Error("silver QF playable");
const byeSeeds = byes.map((g) => g.home && g.home.seed).sort();
eq(byeSeeds, [1, 2], "byes to top seeds");

const goldTeams = assigned.flights[0].teams;
const gold = br.buildSingleElimGames(goldTeams, br.normalizeFlight({
  id: "gold", name: "Gold", pairing: "high-low", later_slot_for_top_seeds: true,
  fields: ["Field 6", "Field 1"], start_time: "09:30", slot_minutes: 90,
}, 0));
br.scheduleGames(gold.games, br.normalizeFlight({
  id: "gold", name: "Gold", fields: ["Field 6", "Field 1"], start_time: "09:30", slot_minutes: 90,
  later_slot_for_top_seeds: true,
}, 0), { date: "2026-10-11" });
const gPlay = gold.games.filter((g) => !g.is_bye && g.round === "QF");
if (gPlay.length !== 4) throw new Error("gold QF count " + gPlay.length);
const labels = gPlay.map((g) => [g.game_id, g.home && g.home.seed, g.away && g.away.seed, g.time, g.field]);
const firstSlot = gPlay.filter((g) => g.time === "09:30");
const laterSlot = gPlay.filter((g) => g.time === "11:00");
if (firstSlot.length !== 2 || laterSlot.length !== 2) throw new Error("gold stagger " + JSON.stringify(labels));
const laterSeeds = laterSlot.flatMap((g) => [g.home.seed, g.away.seed]);
if (!laterSeeds.includes(1)) throw new Error("top seed not later: " + JSON.stringify(labels));

function scheduleBuilt(built, flight) {
  br.scheduleGames(built.games, br.normalizeFlight(flight || {}, 0), {});
  return built;
}

function live(games) {
  return (games || []).filter((g) => !g.is_bye);
}

function mustHave(games, round, n, label) {
  const got = live(games).filter((g) => g.round === round).length;
  if (got !== n) throw new Error(label + " " + round + " count " + got + " want " + n);
}

const eight = [];
for (let i = 1; i <= 8; i++) eight.push({ id: "k" + i, name: "K" + i, seed: i });
const de = scheduleBuilt(br.buildDoubleElimGames(eight, br.normalizeFlight({
  id: "", name: "", format: "double-elim", if_necessary: true,
}, 0), { if_necessary: true }), { format: "double-elim" });
const dePlay = live(de.games);
if (dePlay.length !== 15) throw new Error("8-team DE + IFN should be 15 games, got " + dePlay.length);
mustHave(de.games, "QF", 4, "8 DE");
mustHave(de.games, "SF", 2, "8 DE");
mustHave(de.games, "WF", 1, "8 DE");
mustHave(de.games, "L1", 2, "8 DE");
mustHave(de.games, "L2", 2, "8 DE");
mustHave(de.games, "L3", 1, "8 DE");
mustHave(de.games, "LF", 1, "8 DE");
mustHave(de.games, "F", 1, "8 DE");
mustHave(de.games, "IFN", 1, "8 DE");
if (dePlay.some((g) => g.round === "5TH" || g.round === "3RD" || g.round === "7TH")) {
  throw new Error("DE must not invent consolation placement games");
}
const wf = dePlay.find((g) => g.round === "WF");
const lf = dePlay.find((g) => g.round === "LF");
const gf = dePlay.find((g) => g.round === "F");
if (!wf.loser_to || wf.loser_to !== lf.game_id) throw new Error("WF loser must drop to LF, got " + wf.loser_to);
if (!wf.winner_to || wf.winner_to !== gf.game_id) throw new Error("WF winner must merge to F, got " + wf.winner_to);
if (gf.home_ref !== "winner:" + wf.game_id) throw new Error("F home should be winner of WF");
if (gf.away_ref !== "winner:" + lf.game_id) throw new Error("F away should be winner of LF");
const qf = dePlay.filter((g) => g.round === "QF");
if (qf.some((g) => !String(g.loser_to || "").startsWith("G") && !g.loser_to)) {
  throw new Error("every QF must feed a losers game: " + JSON.stringify(qf.map((g) => [g.game_id, g.loser_to])));
}

const deNoIfn = scheduleBuilt(br.buildDoubleElimGames(eight, br.normalizeFlight({
  format: "double-elim", if_necessary: false,
}, 0), { if_necessary: false }), { format: "double-elim", if_necessary: false });
if (live(deNoIfn.games).length !== 14) throw new Error("8-team DE without IFN should be 14, got " + live(deNoIfn.games).length);
if (live(deNoIfn.games).some((g) => g.round === "IFN")) throw new Error("IFN should stay off when unchecked");

const four = [];
for (let i = 1; i <= 4; i++) four.push({ id: "f" + i, name: "F" + i, seed: i });
const de4 = scheduleBuilt(br.buildDoubleElimGames(four, br.normalizeFlight({
  format: "double-elim", if_necessary: false,
}, 0), { if_necessary: false }), { format: "double-elim" });
if (live(de4.games).length !== 6) throw new Error("4-team DE should be 6, got " + live(de4.games).length);
mustHave(de4.games, "SF", 2, "4 DE");
mustHave(de4.games, "WF", 1, "4 DE");
mustHave(de4.games, "L1", 1, "4 DE");
mustHave(de4.games, "LF", 1, "4 DE");
mustHave(de4.games, "F", 1, "4 DE");
const de4wf = live(de4.games).find((g) => g.round === "WF");
const de4lf = live(de4.games).find((g) => g.round === "LF");
const de4f = live(de4.games).find((g) => g.round === "F");
if (de4f.home_ref !== "winner:" + de4wf.game_id || de4f.away_ref !== "winner:" + de4lf.game_id) {
  throw new Error("4-team championship must be WF vs LF");
}

const sixDe = [];
for (let i = 1; i <= 6; i++) sixDe.push({ id: "d" + i, name: "D" + i, seed: i });
const de6 = scheduleBuilt(br.buildDoubleElimGames(sixDe, br.normalizeFlight({
  format: "double-elim", if_necessary: false, pairing: "high-low",
}, 0), { if_necessary: false }), { format: "double-elim" });
if (live(de6.games).length !== 10) throw new Error("6-team DE should be 10 playable, got " + live(de6.games).length);
if (de6.games.filter((g) => g.is_bye).length !== 2) throw new Error("6-team DE needs two byes");
mustHave(de6.games, "F", 1, "6 DE");
mustHave(de6.games, "LF", 1, "6 DE");

const seEight = br.buildSingleElimGames(eight, br.normalizeFlight({ format: "single-elim" }, 0));
if (live(seEight.games).some((g) => g.round === "3RD" || g.round === "5TH" || g.round === "7TH")) {
  throw new Error("single-elim must not add consolation unless asked");
}
const seCons = br.buildSingleElimGames(eight, br.normalizeFlight({ format: "single-elim", consolation: true }, 0), { consolation: true });
if (!live(seCons.games).some((g) => g.round === "3RD")) throw new Error("consolation checkbox should add 3RD");

const seFour = br.buildSingleElimGames(four, br.normalizeFlight({ format: "single-elim" }, 0));
if (live(seFour.games).length !== 3) throw new Error("4-team SE is 3 games, got " + live(seFour.games).length);

const seSix = br.buildSingleElimGames(sixDe, br.normalizeFlight({ format: "single-elim" }, 0));
if (live(seSix.games).length !== 5) throw new Error("6-team SE is 5 playable, got " + live(seSix.games).length);

const assignedNone = br.assignFlights(eight, { flights: [br.normalizeFlight({ format: "single-elim" }, 0)] });
const noConsEvent = br.buildEventBracket(assignedNone, { eventFormat: "pool-to-bracket", consolation: false });
if (live(noConsEvent.games).some((g) => g.kind === "consolation")) {
  throw new Error("event draw must not invent consolation when unset");
}
if (br.resolveFlightFormat({}, "pool-to-bracket") !== "single-elim") throw new Error("weekend pool-then-bracket is not itself double elim");
if (br.resolveFlightFormat({ format: "double-elim" }, "pool-to-bracket") !== "double-elim") throw new Error("card double wins over weekend");
if (br.resolveFlightFormat({}, "pool-double-elim") !== "double-elim") throw new Error("legacy weekend DE still draws losers");

const one = br.assignFlights(eight, { flights: [br.normalizeFlight({ id: "", name: "" }, 0)] });
if (one.flights[0].teams.length !== 8) throw new Error("single flight takes all");

const pooled = [];
["A", "B"].forEach((pool, p) => {
  for (let i = 1; i <= 4; i++) {
    pooled.push({
      id: pool + i,
      name: pool + i,
      seed: p * 4 + i,
      overall_seed: p * 4 + i,
      pool_place: i,
      pool,
    });
  }
});
const byPlace = br.assignFlights(pooled, {
  flights: [
    br.normalizeFlight({ name: "Upper", pool_place_from: 1, pool_place_to: 2 }, 0),
    br.normalizeFlight({ name: "Lower", pool_place_from: 3, pool_place_to: 4 }, 1),
  ],
});
eq(byPlace.flights[0].teams.map((t) => t.id).sort(), ["A1", "A2", "B1", "B2"], "pool winners and runners-up");
eq(byPlace.flights[1].teams.map((t) => t.id).sort(), ["A3", "A4", "B3", "B4"], "pool 3rd and 4th");

const six = [];
for (let i = 1; i <= 6; i++) six.push({ id: "s" + i, name: "S" + i, seed: i });
const picked = br.buildSingleElimGames(six, br.normalizeFlight({
  name: "Consolation", pairing: "high-low", bye_mode: "manual", bye_seeds: [3, 4],
}, 0));
const pickedByes = picked.games.filter((g) => g.is_bye).map((g) => g.home && g.home.seed).sort();
eq(pickedByes, [3, 4], "director-picked byes");

console.log("brackets.js ok");
