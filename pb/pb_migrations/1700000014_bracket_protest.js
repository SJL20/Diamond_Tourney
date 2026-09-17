migrate((app) => {
  const bracket = app.findCollectionByNameOrId("bracket_games");
  if (!bracket.fields.getByName("protest_note")) {
    bracket.fields.add(new TextField({ name: "protest_note" }));
  }
  app.save(bracket);
}, (app) => {});
