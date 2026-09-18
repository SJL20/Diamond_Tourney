/// <reference path="../pb_data/types.d.ts" />

// Owner can add extra directors by email on tournament setup. Public pages
// never list these addresses. Collection rules stay closed; hooks query with
// app context. event_td is still not a trust boundary — only the owner or a
// site admin may write this collection, and only through /api/* routes.
migrate((app) => {
  try { app.findCollectionByNameOrId("event_co_owners"); return; }
  catch (err) {}

  const events = app.findCollectionByNameOrId("events");
  const users = app.findCollectionByNameOrId("users");
  const col = new Collection({
    name: "event_co_owners",
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE UNIQUE INDEX idx_event_co_owners_pair ON event_co_owners (event, email)",
    ],
  });
  col.fields.add(new RelationField({
    name: "event",
    collectionId: events.id,
    required: true,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new EmailField({ name: "email", required: true }));
  col.fields.add(new RelationField({
    name: "account",
    collectionId: users.id,
    maxSelect: 1,
    cascadeDelete: false,
  }));
  app.save(col);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("event_co_owners")); }
  catch (err) {}
});
