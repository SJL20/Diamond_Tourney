migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  const fields = app.findCollectionByNameOrId("fields");
  const schedule = app.findCollectionByNameOrId("event_schedule");

  function addText(col, name) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new TextField({ name: name }));
  }
  function addNum(col, name) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new NumberField({ name: name }));
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

  addText(events, "address");
  addNum(events, "lat");
  addNum(events, "lng");
  addText(events, "rain_note");
  addSelect(events, "rain_status", ["clear", "watch", "delay", "postponed", "moved"]);
  addValue(events, "format", "pool-only");
  addValue(events, "format", "double-elim");
  app.save(events);

  if (!fields.fields.getByName("event")) {
    fields.fields.add(new RelationField({
      name: "event",
      collectionId: events.id,
      maxSelect: 1,
      cascadeDelete: true,
    }));
  }
  addNum(fields, "lat");
  addNum(fields, "lng");
  addText(fields, "slug");
  fields.listRule = "";
  fields.viewRule = "";
  fields.createRule = "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'";
  fields.updateRule = "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'";
  fields.deleteRule = "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'";
  app.save(fields);

  addText(schedule, "field_name");
  addText(schedule, "pool");
  addText(schedule, "delayed_from");
  addValue(schedule, "status", "postponed");
  addValue(schedule, "status", "rained_out");
  app.save(schedule);

  try {
    const keystone = app.findFirstRecordByData("events", "slug", "keystone-clash-2026");
    keystone.set("address", "51 Meadow St, McDonald, PA 15057");
    keystone.set("lat", 40.3668);
    keystone.set("lng", -80.2345);
    keystone.set("rain_status", "moved");
    keystone.set("rain_note", "Sunday bracket moved to No Offseason, 306 Chase Drive, Tarentum, PA 15084 after Saturday rain.");
    app.save(keystone);

    function seedField(name, address, lat, lng) {
      try {
        return app.findFirstRecordByFilter("fields", "event = {:e} && name = {:n}", { e: keystone.id, n: name });
      } catch (err) {
        const rec = new Record(fields);
        rec.set("event", keystone.id);
        rec.set("name", name);
        rec.set("address", address);
        rec.set("lat", lat);
        rec.set("lng", lng);
        rec.set("status", "open");
        rec.set("surface", "grass");
        app.save(rec);
        return rec;
      }
    }
    seedField("East End 1", "51 Meadow St, McDonald, PA 15057", 40.3668, -80.2345);
    seedField("East End 2", "51 Meadow St, McDonald, PA 15057", 40.3665, -80.2350);
    seedField("No Offseason", "306 Chase Drive, Tarentum, PA 15084", 40.6014, -79.7598);
  } catch (miss) {}
}, (app) => {});
