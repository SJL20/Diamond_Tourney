/// <reference path="../pb_data/types.d.ts" />

// Which bracket run boxes were actually typed. The runs columns cannot store
// null, so a blank box is 0 here and hidden when this side is false.
// Additive. Does not list or delete events.
migrate((app) => {
  const games = app.findCollectionByNameOrId("bracket_games");
  if (games.fields.getByName("runs_entered")) return;
  games.fields.add(new JSONField({ name: "runs_entered" }));
  app.save(games);
}, (app) => {});
