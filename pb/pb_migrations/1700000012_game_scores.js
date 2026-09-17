migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  const users = app.findCollectionByNameOrId("users");
  const schedule = app.findCollectionByNameOrId("event_schedule");
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

  addValue(schedule, "status", "submitted");
  if (!schedule.fields.getByName("scored_by")) {
    schedule.fields.add(new RelationField({
      name: "scored_by",
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
  }
  app.save(schedule);

  if (!boxes.fields.getByName("event")) {
    boxes.fields.add(new RelationField({
      name: "event",
      collectionId: events.id,
      maxSelect: 1,
      cascadeDelete: true,
    }));
  }
  if (!boxes.fields.getByName("file")) {
    boxes.fields.add(new FileField({
      name: "file",
      maxSelect: 1,
      maxSize: 15728640,
      mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    }));
  }
  if (!boxes.fields.getByName("status")) {
    boxes.fields.add(new SelectField({
      name: "status",
      maxSelect: 1,
      values: ["submitted", "approved"],
    }));
  }
  if (!boxes.fields.getByName("note")) {
    boxes.fields.add(new TextField({ name: "note" }));
  }
  if (!boxes.fields.getByName("original_name")) {
    boxes.fields.add(new TextField({ name: "original_name" }));
  }
  if (!boxes.fields.getByName("submitted_by")) {
    boxes.fields.add(new RelationField({
      name: "submitted_by",
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
  }
  boxes.createRule = "@request.auth.id != ''";
  boxes.updateRule = "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.id != ''";
  app.save(boxes);
}, (app) => {});
