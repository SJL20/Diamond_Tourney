/// <reference path="../pb_data/types.d.ts" />

// Every pool and bracket game gets a weekend-visible number (Game 1, Game 2…)
// so coaches can say "we're on Game 7" instead of pointing at a time slot.
// One sequence per event. Existing rows are numbered pool-first, then bracket.
migrate((app) => {
  const schedule = app.findCollectionByNameOrId("event_schedule");
  if (!schedule.fields.getByName("game_number")) {
    schedule.fields.add(new NumberField({ name: "game_number", min: 0, onlyInt: true }));
  }
  app.save(schedule);

  const bracket = app.findCollectionByNameOrId("bracket_games");
  if (!bracket.fields.getByName("game_number")) {
    bracket.fields.add(new NumberField({ name: "game_number", min: 0, onlyInt: true }));
  }
  app.save(bracket);

  const ROUND_ORDER = { QF: 1, CSF: 2, SF: 3, "5TH": 4, "3RD": 5, "7TH": 6, CF: 7, F: 8 };

  function sortPool(a, b) {
    const da = String(a.get("date") || "");
    const db = String(b.get("date") || "");
    if (da !== db) return da < db ? -1 : 1;
    const ta = String(a.get("time") || "");
    const tb = String(b.get("time") || "");
    if (ta !== tb) return ta < tb ? -1 : 1;
    const fa = String(a.get("field_name") || "");
    const fb = String(b.get("field_name") || "");
    if (fa !== fb) return fa < fb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : 1;
  }

  function sortBracket(a, b) {
    const ra = ROUND_ORDER[a.get("round")] || 50;
    const rb = ROUND_ORDER[b.get("round")] || 50;
    if (ra !== rb) return ra - rb;
    const sa = Number(a.get("slot") || 0);
    const sb = Number(b.get("slot") || 0);
    if (sa !== sb) return sa - sb;
    return String(a.id) < String(b.id) ? -1 : 1;
  }

  const events = app.findRecordsByFilter("events", "", "", 200, 0);
  for (let e = 0; e < events.length; e++) {
    const eventId = events[e].id;
    const pool = app.findRecordsByFilter("event_schedule", "event = {:e}", "", 400, 0, { e: eventId });
    const tree = app.findRecordsByFilter("bracket_games", "event = {:e}", "", 80, 0, { e: eventId });
    pool.sort(sortPool);
    tree.sort(sortBracket);
    let n = 0;
    const rows = pool.concat(tree);
    for (let i = 0; i < rows.length; i++) {
      n += 1;
      rows[i].set("game_number", n);
      app.save(rows[i]);
    }
  }
}, (app) => {});
