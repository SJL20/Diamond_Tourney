/// <reference path="../pb_data/types.d.ts" />

// Private coach contacts (never on the public `teams` collection), 6U/8U on
// season books, remembered CSV mappings, and a 5 MB HEIC-capable photo field.
// team_contacts rules stay closed — only /api/* hooks read or write them.
migrate((app) => {
  const teams = app.findCollectionByNameOrId("teams");
  const age = teams.fields.getByName("age_group");
  if (age) {
    age.values = ["6U", "8U", "10U", "12U", "14U", "16U", "18U"];
    app.save(teams);
  }

  const eventTeams = app.findCollectionByNameOrId("event_teams");
  if (!eventTeams.fields.getByName("age_group")) {
    eventTeams.fields.add(new TextField({ name: "age_group" }));
  }
  if (!eventTeams.fields.getByName("klass")) {
    eventTeams.fields.add(new TextField({ name: "klass" }));
  }
  if (!eventTeams.fields.getByName("paid")) {
    eventTeams.fields.add(new BoolField({ name: "paid" }));
  }
  if (!eventTeams.fields.getByName("registered_at")) {
    eventTeams.fields.add(new TextField({ name: "registered_at" }));
  }
  if (!eventTeams.fields.getByName("notes")) {
    eventTeams.fields.add(new TextField({ name: "notes" }));
  }
  app.save(eventTeams);

  try { app.findCollectionByNameOrId("import_maps"); }
  catch (err) {
    const users = app.findCollectionByNameOrId("users");
    const maps = new Collection({
      name: "import_maps",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      indexes: [
        "CREATE UNIQUE INDEX idx_import_maps_account_kind ON import_maps (account, kind)",
      ],
    });
    maps.fields.add(new RelationField({
      name: "account",
      collectionId: users.id,
      required: true,
      maxSelect: 1,
      cascadeDelete: true,
    }));
    maps.fields.add(new TextField({ name: "kind", required: true }));
    maps.fields.add(new JSONField({ name: "mapping" }));
    app.save(maps);
  }

  try {
    const log = app.findCollectionByNameOrId("sync_log");
    const kind = log.fields.getByName("kind");
    if (kind) {
      kind.values = [
        "gamechanger", "tourneymachine", "event", "mail",
        "signup_mail", "verify_mail", "reset_mail", "welcome_mail",
        "rain_mail", "team_import",
      ];
      app.save(log);
    }
  } catch (err) {}

  try {
    const photos = app.findCollectionByNameOrId("venue_photos");
    const image = photos.fields.getByName("image");
    if (image) {
      image.maxSize = 5242880;
      image.mimeTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
      app.save(photos);
    }
  } catch (err) {}

  try { app.findCollectionByNameOrId("team_contacts"); return; }
  catch (err) {}

  const events = app.findCollectionByNameOrId("events");
  const col = new Collection({
    name: "team_contacts",
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE INDEX idx_team_contacts_event ON team_contacts (event)",
      "CREATE INDEX idx_team_contacts_event_team ON team_contacts (event_team)",
      "CREATE INDEX idx_team_contacts_team ON team_contacts (team)",
    ],
  });
  col.fields.add(new RelationField({
    name: "event",
    collectionId: events.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new RelationField({
    name: "event_team",
    collectionId: eventTeams.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new RelationField({
    name: "team",
    collectionId: teams.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new EmailField({ name: "coach_email" }));
  col.fields.add(new TextField({ name: "coach_phone" }));
  col.fields.add(new TextField({ name: "alt_name" }));
  col.fields.add(new EmailField({ name: "alt_email" }));
  col.fields.add(new TextField({ name: "alt_phone" }));
  col.fields.add(new SelectField({
    name: "role",
    maxSelect: 1,
    values: ["head_coach", "team_manager", "billing"],
  }));
  app.save(col);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("team_contacts")); }
  catch (err) {}
});
