/// <reference path="../pb_data/types.d.ts" />

// Directors can reject a pending event box from the Stats inbox.
// Additive: only adds the select value. Does not list or delete events.
migrate((app) => {
  const boxes = app.findCollectionByNameOrId("event_boxes");
  const field = boxes.fields.getByName("status");
  if (!field) return;
  const values = field.values || [];
  if (values.indexOf("rejected") === -1) {
    values.push("rejected");
    field.values = values;
    app.save(boxes);
  }
}, (app) => {});
