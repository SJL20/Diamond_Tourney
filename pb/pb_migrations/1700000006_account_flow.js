migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "";
  if (!users.fields.getByName("display_name")) {
    users.fields.add(new TextField({ name: "display_name" }));
  }
  app.save(users);

  const events = app.findCollectionByNameOrId("events");
  if (!events.fields.getByName("created_by")) {
    events.fields.add(new RelationField({
      name: "created_by",
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
  }
  app.save(events);

  const eventTeams = app.findCollectionByNameOrId("event_teams");
  if (!eventTeams.fields.getByName("account")) {
    eventTeams.fields.add(new RelationField({
      name: "account",
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
  }
  app.save(eventTeams);
}, (app) => {});
