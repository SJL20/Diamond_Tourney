migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  events.createRule = "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'";
  if (!events.fields.getByName("source")) {
    events.fields.add(new SelectField({
      name: "source",
      maxSelect: 1,
      values: ["native", "tourneymachine"],
    }));
  }
  if (!events.fields.getByName("tm_url")) {
    events.fields.add(new URLField({ name: "tm_url" }));
  }
  if (!events.fields.getByName("tm_id")) {
    events.fields.add(new TextField({ name: "tm_id" }));
  }
  if (!events.fields.getByName("signup_open")) {
    events.fields.add(new BoolField({ name: "signup_open" }));
  }
  if (!events.fields.getByName("auto_sync")) {
    events.fields.add(new BoolField({ name: "auto_sync" }));
  }
  app.save(events);

  const eventTeams = app.findCollectionByNameOrId("event_teams");
  if (!eventTeams.fields.getByName("gamechanger_url")) {
    eventTeams.fields.add(new URLField({ name: "gamechanger_url" }));
  }
  if (!eventTeams.fields.getByName("gc_team_ref")) {
    eventTeams.fields.add(new TextField({ name: "gc_team_ref" }));
  }
  if (!eventTeams.fields.getByName("contact_name")) {
    eventTeams.fields.add(new TextField({ name: "contact_name" }));
  }
  if (!eventTeams.fields.getByName("contact_email")) {
    eventTeams.fields.add(new EmailField({ name: "contact_email" }));
  }
  if (!eventTeams.fields.getByName("signed_up_by")) {
    eventTeams.fields.add(new SelectField({
      name: "signed_up_by",
      maxSelect: 1,
      values: ["director", "team"],
    }));
  }
  if (!eventTeams.fields.getByName("gc_sync_status")) {
    eventTeams.fields.add(new SelectField({
      name: "gc_sync_status",
      maxSelect: 1,
      values: ["unlinked", "linked", "ok", "needs_review", "error"],
    }));
  }
  if (!eventTeams.fields.getByName("gc_last_sync")) {
    eventTeams.fields.add(new DateField({ name: "gc_last_sync" }));
  }
  if (!eventTeams.fields.getByName("gc_last_error")) {
    eventTeams.fields.add(new TextField({ name: "gc_last_error" }));
  }
  app.save(eventTeams);

  try {
    app.findCollectionByNameOrId("sync_log");
  } catch (err) {
    const log = new Collection({
      name: "sync_log",
      type: "base",
      listRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      viewRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      createRule: null,
      updateRule: null,
      deleteRule: "@request.auth.role = 'region_admin'",
      fields: [
        { name: "event", type: "relation", collectionId: events.id, maxSelect: 1 },
        { name: "kind", type: "select", maxSelect: 1, values: ["gamechanger", "tourneymachine", "event"] },
        { name: "ok", type: "bool" },
        { name: "detail", type: "text" },
      ],
    });
    app.save(log);
  }

  const saturday = app.findFirstRecordByData("events", "slug", "central-saturday");
  saturday.set("signup_open", true);
  saturday.set("source", "native");
  saturday.set("auto_sync", true);
  app.save(saturday);

  try {
    const hawks = app.findFirstRecordByFilter(
      "event_teams",
      "event = {:e} && slug = 'hawks-10u'",
      { e: saturday.id },
    );
    hawks.set("gamechanger_url", "https://web.gc.com/team/hawks-10u");
    hawks.set("gc_team_ref", "web.gc.com/team/hawks-10u");
    hawks.set("gc_sync_status", "linked");
    hawks.set("signed_up_by", "director");
    app.save(hawks);
  } catch (err) {}
}, (app) => {});
