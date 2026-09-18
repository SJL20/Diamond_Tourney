migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("reset_token")) {
    users.fields.add(new TextField({ name: "reset_token" }));
    app.save(users);
  }

  try { app.findCollectionByNameOrId("login_resets"); }
  catch (err) {
    const resets = new Collection({
      name: "login_resets",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    resets.fields.add(new TextField({ name: "token", required: true }));
    resets.fields.add(new TextField({ name: "collection", required: true }));
    resets.fields.add(new TextField({ name: "record_id", required: true }));
    app.save(resets);
  }
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  const field = users.fields.getByName("reset_token");
  if (field) {
    users.fields.remove(field);
    app.save(users);
  }
  try {
    app.delete(app.findCollectionByNameOrId("login_resets"));
  } catch (err) {}
});
