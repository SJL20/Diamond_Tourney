/// <reference path="../pb_data/types.d.ts" />

// Additive only. Directors name as many brackets as they want and assign
// each split themselves. Do not list or delete events.

migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  const bracket = app.findCollectionByNameOrId("bracket_games");

  if (!events.fields.getByName("bracket_plan")) {
    events.fields.add(new JSONField({ name: "bracket_plan" }));
  }
  const flights = events.fields.getByName("bracket_flights");
  if (flights && flights.values && flights.values.indexOf("custom") === -1) {
    flights.values = (flights.values || []).concat(["custom"]);
  }
  app.save(events);

  function addText(col, name) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new TextField({ name: name }));
  }
  function addValue(col, name, value) {
    const field = col.fields.getByName(name);
    if (!field) return;
    const values = field.values || [];
    if (values.indexOf(value) === -1) {
      values.push(value);
      field.values = values;
    }
  }
  addText(bracket, "home_ref");
  addText(bracket, "away_ref");
  addValue(bracket, "status", "bye");
  app.save(bracket);
}, (app) => {});
