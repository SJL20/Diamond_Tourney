/// <reference path="../pb_data/types.d.ts" />

// The scheduler card used to redraw from hardcoded defaults after "Build pool
// schedule". Store the director's last choices on the event so a rebuild
// shows what they just saved.
migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  if (!events.fields.getByName("scheduler")) {
    events.fields.add(new JSONField({ name: "scheduler" }));
    app.save(events);
  }
}, (app) => {});
