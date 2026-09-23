/// <reference path="../pb_data/types.d.ts" />

// How many box-score asks have already gone to this team for this game.
// Additive. Does not list or delete events.
migrate((app) => {
  const col = app.findCollectionByNameOrId("box_submissions");
  if (col.fields.getByName("mail_count")) return;
  col.fields.add(new NumberField({ name: "mail_count", min: 0, onlyInt: true }));
  app.save(col);
}, (app) => {});
