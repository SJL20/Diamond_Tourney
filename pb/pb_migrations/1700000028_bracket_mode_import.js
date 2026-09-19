/// <reference path="../pb_data/types.d.ts" />

// Additive. Empty TBD brackets and imported CSVs need extra bracket_mode
// values. Does not wipe events or games.

migrate((app) => {
  try {
    const events = app.findCollectionByNameOrId("events");
    const field = events.fields.getByName("bracket_mode");
    if (!field) return;
    const values = field.values || [];
    ["standings", "custom", "empty", "imported"].forEach(function (value) {
      if (values.indexOf(value) === -1) values.push(value);
    });
    field.values = values;
    app.save(events);
  } catch (err) {}
}, (app) => {});
