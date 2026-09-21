/// <reference path="../pb_data/types.d.ts" />

// Additive only. Lock public user creation, hide reset/verify tokens, and
// stop ordinary logins from listing archived weekends or unapproved boxes.
// Do not list or delete events.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;
  for (let i = 0; i < ["reset_token", "verify_token"].length; i++) {
    const name = ["reset_token", "verify_token"][i];
    const field = users.fields.getByName(name);
    if (field) field.hidden = true;
  }
  if (!users.fields.getByName("reset_expires")) {
    users.fields.add(new TextField({ name: "reset_expires", hidden: true }));
  } else {
    users.fields.getByName("reset_expires").hidden = true;
  }
  if (!users.fields.getByName("verify_expires")) {
    users.fields.add(new TextField({ name: "verify_expires", hidden: true }));
  } else {
    users.fields.getByName("verify_expires").hidden = true;
  }
  app.save(users);

  const events = app.findCollectionByNameOrId("events");
  events.listRule = "(public = true && status != 'archived') || (@request.auth.id != '' && (@request.auth.role = 'region_admin' || created_by = @request.auth.id))";
  events.viewRule = events.listRule;
  app.save(events);

  const docs = app.findCollectionByNameOrId("team_docs");
  const docWrite = "@request.auth.id != '' && (@request.auth.role = 'region_admin' || event.created_by = @request.auth.id)";
  docs.updateRule = docWrite;
  docs.deleteRule = docWrite;
  app.save(docs);

  const boxes = app.findCollectionByNameOrId("event_boxes");
  const boxRead = "status = 'approved' || (@request.auth.id != '' && (@request.auth.role = 'region_admin' || event.created_by = @request.auth.id || schedule_row.event.created_by = @request.auth.id))";
  boxes.listRule = boxRead;
  boxes.viewRule = boxRead;
  app.save(boxes);

  try {
    const resets = app.findCollectionByNameOrId("login_resets");
    if (!resets.fields.getByName("expires")) {
      resets.fields.add(new TextField({ name: "expires", hidden: true }));
    } else {
      resets.fields.getByName("expires").hidden = true;
    }
    const token = resets.fields.getByName("token");
    if (token) token.hidden = true;
    app.save(resets);
  } catch (err) {}

  function addIndex(name, sql) {
    const col = app.findCollectionByNameOrId(name);
    const indexes = col.indexes || [];
    for (let i = 0; i < indexes.length; i++) {
      if (String(indexes[i]).indexOf(sql) !== -1) return;
    }
    const next = [];
    for (let i = 0; i < indexes.length; i++) next.push(indexes[i]);
    next.push(sql);
    col.indexes = next;
    app.save(col);
  }
  addIndex("event_schedule", "CREATE INDEX idx_event_schedule_event ON event_schedule (event)");
  addIndex("event_hitting", "CREATE INDEX idx_event_hitting_event ON event_hitting (event)");
}, (app) => {});
