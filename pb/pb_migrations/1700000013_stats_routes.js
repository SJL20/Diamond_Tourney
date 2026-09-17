migrate((app) => {
  const boxes = app.findCollectionByNameOrId("event_boxes");

  function addValue(col, name, value) {
    const field = col.fields.getByName(name);
    if (!field) return;
    const values = field.values || [];
    if (values.indexOf(value) === -1) {
      values.push(value);
      field.values = values;
    }
  }

  if (!boxes.fields.getByName("gc_url")) {
    boxes.fields.add(new URLField({ name: "gc_url" }));
  }
  addValue(boxes, "status", "queued");
  addValue(boxes, "status", "needs_review");
  app.save(boxes);
}, (app) => {});
