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

const eight = [];
for (let i = 1; i <= 8; i++) eight.push({ id: "k" + i, name: "K" + i, seed: i });
const de = br.buildDoubleElimGames(eight, br.normalizeFlight({
  id: "", name: "", format: "double-elim", if_necessary: true,
}, 0), { if_necessary: true });
const dePlay = de.games.filter((g) => !g.is_bye);
if (dePlay.length !== 14) throw new Error("8-team 4GG DE should be 14 games, got " + dePlay.length);

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
