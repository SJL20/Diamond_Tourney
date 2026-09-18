migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  if (!events.fields.getByName("tiebreak")) {
    events.fields.add(new JSONField({ name: "tiebreak" }));
    app.save(events);
  }
  const def = { order: ["record", "h2h", "ra", "diff", "rs"] };
  const rows = app.findRecordsByFilter("events", "", "", 400, 0);
  for (let i = 0; i < rows.length; i++) {
    const rec = rows[i];
    if (!rec.get("tiebreak")) {
      rec.set("tiebreak", def);
      app.save(rec);
    }
  }
}, (app) => {
  const events = app.findCollectionByNameOrId("events");
  const field = events.fields.getByName("tiebreak");
  if (field) {
    events.fields.remove(field);
    app.save(events);
  }
});
