/// <reference path="../pb_data/types.d.ts" />

// A login can follow a tournament or a team. The rows are that person's fan
// list. Collection rules stay closed so the API cannot list other people's
// emails. Do not list or delete events.

migrate((app) => {
  try { app.findCollectionByNameOrId("follows"); return; }
  catch (err) {}

  const users = app.findCollectionByNameOrId("users");
  const events = app.findCollectionByNameOrId("events");
  const clubs = app.findCollectionByNameOrId("club_teams");
  const col = new Collection({
    name: "follows",
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE UNIQUE INDEX idx_follows_user_target ON follows (user, target)",
    ],
  });
  col.fields.add(new RelationField({
    name: "user",
    collectionId: users.id,
    required: true,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new TextField({ name: "target", required: true }));
  col.fields.add(new RelationField({
    name: "event",
    collectionId: events.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new RelationField({
    name: "club",
    collectionId: clubs.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  app.save(col);
}, (app) => {});
