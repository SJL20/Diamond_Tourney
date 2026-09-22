/// <reference path="../pb_data/types.d.ts" />

// The master team holds the club: name, age, coach name, and the public
// GameChanger link. Emails and co-owners stay off `teams` because that
// collection is world-readable. This file does not list events and does not
// delete any of them.

migrate((app) => {
  const teams = app.findCollectionByNameOrId("teams");
  const users = app.findCollectionByNameOrId("users");
  let teamsChanged = false;
  if (!teams.fields.getByName("gamechanger_url")) {
    teams.fields.add(new URLField({ name: "gamechanger_url" }));
    teamsChanged = true;
  }
  if (!teams.fields.getByName("created_by")) {
    teams.fields.add(new RelationField({
      name: "created_by",
      collectionId: users.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
    teamsChanged = true;
  }
  if (teamsChanged) app.save(teams);

  const contacts = app.findCollectionByNameOrId("team_contacts");
  if (!contacts.fields.getByName("pending_owner_email")) {
    contacts.fields.add(new EmailField({ name: "pending_owner_email" }));
    app.save(contacts);
  }

  try { app.findCollectionByNameOrId("team_co_owners"); return; }
  catch (err) {}

  const col = new Collection({
    name: "team_co_owners",
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE UNIQUE INDEX idx_team_co_owners_pair ON team_co_owners (team, email)",
    ],
  });
  col.fields.add(new RelationField({
    name: "team",
    collectionId: teams.id,
    required: true,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new EmailField({ name: "email", required: true }));
  col.fields.add(new RelationField({
    name: "user",
    collectionId: users.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  app.save(col);
}, (app) => {});
