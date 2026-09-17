migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  const fields = app.findCollectionByNameOrId("fields");
  if (!events.fields.getByName("hours_start")) {
    events.fields.add(new TextField({ name: "hours_start" }));
  }
  if (!events.fields.getByName("hours_end")) {
    events.fields.add(new TextField({ name: "hours_end" }));
  }
  app.save(events);
  if (!fields.fields.getByName("availability")) {
    fields.fields.add(new JSONField({ name: "availability" }));
  }
  app.save(fields);

  try {
    const keystone = app.findFirstRecordByData("events", "slug", "keystone-clash-2026");
    if (!keystone.get("hours_start")) keystone.set("hours_start", "08:00");
    if (!keystone.get("hours_end")) keystone.set("hours_end", "18:00");
    app.save(keystone);
    function setAvail(name, rows) {
      const rec = app.findFirstRecordByFilter("fields", "event = {:e} && name = {:n}", { e: keystone.id, n: name });
      rec.set("availability", rows);
      app.save(rec);
    }
    setAvail("East End 1", [
      { date: "2026-09-11", available: true, start: "08:00", end: "18:00" },
      { date: "2026-09-12", available: true, start: "08:00", end: "18:00" },
      { date: "2026-09-13", available: false, start: "08:00", end: "18:00" },
    ]);
    setAvail("East End 2", [
      { date: "2026-09-11", available: true, start: "08:00", end: "18:00" },
      { date: "2026-09-12", available: true, start: "08:00", end: "18:00" },
      { date: "2026-09-13", available: false, start: "08:00", end: "18:00" },
    ]);
    setAvail("No Offseason", [
      { date: "2026-09-11", available: false, start: "08:00", end: "18:00" },
      { date: "2026-09-12", available: false, start: "08:00", end: "18:00" },
      { date: "2026-09-13", available: true, start: "08:00", end: "18:00" },
    ]);
  } catch (miss) {}
}, (app) => {});
