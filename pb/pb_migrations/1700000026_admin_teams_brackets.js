/// <reference path="../pb_data/types.d.ts" />

// Additive only. Do not list events and delete them. Fly /data persists
// live weekends across deploys; this migration must not wipe Keystone,
// Harbor Eight, or any director-created tournament.

migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  const bracket = app.findCollectionByNameOrId("bracket_games");

  function addText(col, name) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new TextField({ name: name }));
  }

  function addSelect(col, name, values) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new SelectField({ name: name, maxSelect: 1, values: values }));
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

  addValue(events, "format", "round-robin");
  addValue(events, "format", "pool-double-elim");
  addSelect(events, "bracket_flights", ["none", "gold-silver", "platinum-gold-silver"]);
  addSelect(events, "bracket_mode", ["standings", "custom"]);
  app.save(events);

  addText(bracket, "flight");
  addSelect(bracket, "bracket_kind", ["winners", "losers", "consolation", "championship"]);
  addValue(bracket, "side", "winners");
  addValue(bracket, "side", "losers");
  app.save(bracket);
}, (app) => {});
