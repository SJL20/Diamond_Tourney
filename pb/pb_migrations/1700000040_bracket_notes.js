/// <reference path="../pb_data/types.d.ts" />

// Additive text field for a live inning note on a bracket game.
// Does not list or delete events.

migrate((app) => {
  const bracket = app.findCollectionByNameOrId("bracket_games");
  if (!bracket.fields.getByName("notes")) {
    bracket.fields.add(new TextField({ name: "notes" }));
  }
  app.save(bracket);
}, (app) => {});
