migrate((app) => {
  const col = app.findCollectionByNameOrId("bracket_games");
  if (!col.fields.getByName("side")) {
    col.fields.add(new SelectField({
      name: "side",
      maxSelect: 1,
      values: ["championship", "consolation"],
    }));
    app.save(col);
  }

  function setSide(eventId, round, slot, side) {
    try {
      const rec = app.findFirstRecordByFilter(
        "bracket_games",
        "event = {:e} && round = {:r} && slot = {:s}",
        { e: eventId, r: round, s: slot },
      );
      rec.set("side", side);
      app.save(rec);
      return rec;
    } catch (err) {
      return null;
    }
  }

  let event;
  try {
    event = app.findFirstRecordByData("events", "slug", "central-saturday");
  } catch (err) {
    return;
  }

  setSide(event.id, "SF", 1, "championship");
  setSide(event.id, "SF", 2, "championship");
  setSide(event.id, "F", 1, "championship");

  function team(slug) {
    return app.findFirstRecordByFilter(
      "event_teams",
      "event = {:e} && slug = {:s}",
      { e: event.id, s: slug },
    );
  }

  const dukes = team("lady-dukes");
  const rivals = team("rivals-10u");
  const select = team("fp-select");

  function upsert(round, slot, side, home, away, hr, ar, winner, status) {
    let rec;
    try {
      rec = app.findFirstRecordByFilter(
        "bracket_games",
        "event = {:e} && round = {:r} && slot = {:s}",
        { e: event.id, r: round, s: slot },
      );
    } catch (err) {
      rec = new Record(app.findCollectionByNameOrId("bracket_games"));
      rec.set("event", event.id);
      rec.set("round", round);
      rec.set("slot", slot);
    }
    rec.set("side", side);
    if (home) rec.set("home_team", home.id);
    if (away) rec.set("away_team", away.id);
    rec.set("home_runs", hr);
    rec.set("away_runs", ar);
    if (winner) rec.set("winner", winner.id);
    rec.set("status", status);
    app.save(rec);
  }

  upsert("5TH", 1, "consolation", dukes, rivals, 0, 0, null, "scheduled");
  upsert("3RD", 1, "consolation", select, null, 0, 0, null, "scheduled");
}, (app) => {});
