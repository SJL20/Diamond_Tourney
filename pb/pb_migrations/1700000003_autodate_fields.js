migrate((app) => {
  const names = [
    "staging_games", "team_games", "hitting_game", "pitching_game",
    "posts", "event_schedule", "bracket_games",
  ];
  for (const name of names) {
    const col = app.findCollectionByNameOrId(name);
    if (!col.fields.getByName("created")) {
      col.fields.add(new AutodateField({ name: "created", onCreate: true, onUpdate: false }));
    }
    if (!col.fields.getByName("updated")) {
      col.fields.add(new AutodateField({ name: "updated", onCreate: true, onUpdate: true }));
    }
    app.save(col);
  }
}, (app) => {});
