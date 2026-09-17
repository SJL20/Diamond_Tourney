migrate((app) => {
  const keystone = require(__hooks + "/keystone.js");

  const events = app.findCollectionByNameOrId("events");
  keystone.addSelectValue(events, "source", "popup");
  if (!events.fields.getByName("source_url")) {
    events.fields.add(new URLField({ name: "source_url" }));
  }
  if (!events.fields.getByName("packet")) {
    events.fields.add(new JSONField({ name: "packet" }));
  }
  if (!events.fields.getByName("contact")) {
    events.fields.add(new TextField({ name: "contact" }));
  }
  if (!events.fields.getByName("status_note")) {
    events.fields.add(new TextField({ name: "status_note" }));
  }
  app.save(events);

  const eventTeams = app.findCollectionByNameOrId("event_teams");
  if (!eventTeams.fields.getByName("published_w")) {
    eventTeams.fields.add(new NumberField({ name: "published_w", min: 0 }));
  }
  if (!eventTeams.fields.getByName("published_l")) {
    eventTeams.fields.add(new NumberField({ name: "published_l", min: 0 }));
  }
  if (!eventTeams.fields.getByName("published_t")) {
    eventTeams.fields.add(new NumberField({ name: "published_t", min: 0 }));
  }
  if (!eventTeams.fields.getByName("published_rf")) {
    eventTeams.fields.add(new NumberField({ name: "published_rf", min: 0 }));
  }
  if (!eventTeams.fields.getByName("published_ra")) {
    eventTeams.fields.add(new NumberField({ name: "published_ra", min: 0 }));
  }
  if (!eventTeams.fields.getByName("is_host")) {
    eventTeams.fields.add(new BoolField({ name: "is_host" }));
  }
  app.save(eventTeams);

  const bracket = app.findCollectionByNameOrId("bracket_games");
  if (!bracket.fields.getByName("game_id")) {
    bracket.fields.add(new TextField({ name: "game_id" }));
  }
  if (!bracket.fields.getByName("field_name")) {
    bracket.fields.add(new TextField({ name: "field_name" }));
  }
  if (!bracket.fields.getByName("time")) {
    bracket.fields.add(new TextField({ name: "time" }));
  }
  if (!bracket.fields.getByName("date")) {
    bracket.fields.add(new TextField({ name: "date" }));
  }
  app.save(bracket);

  try {
    const log = app.findCollectionByNameOrId("sync_log");
    keystone.addSelectValue(log, "kind", "popup");
    app.save(log);
  } catch (err) {}

  keystone.seedBundled(app);
}, (app) => {});
