/// <reference path="../pb_data/types.d.ts" />

// A weekend entry points at the master team (`teams`). The link is optional
// so weekends already on the board keep their rows. This file does not list
// events and does not delete any of them.

migrate((app) => {
  const teams = app.findCollectionByNameOrId("teams");
  const eventTeams = app.findCollectionByNameOrId("event_teams");
  if (eventTeams.fields.getByName("team")) return;

  eventTeams.fields.add(new RelationField({
    name: "team",
    collectionId: teams.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  const indexes = eventTeams.indexes || [];
  const stmt = "CREATE INDEX idx_event_teams_master ON event_teams (team)";
  if (indexes.indexOf(stmt) === -1) indexes.push(stmt);
  eventTeams.indexes = indexes;
  app.save(eventTeams);
}, (app) => {});
