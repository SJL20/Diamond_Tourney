/// <reference path="../pb_data/types.d.ts" />

// Director order for a pool group that is still tied after every formula.
// Additive. Does not list or delete events.
migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  if (events.fields.getByName("tiebreak_manual")) return;
  events.fields.add(new JSONField({ name: "tiebreak_manual" }));
  app.save(events);
}, (app) => {});
