migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  if (!events.fields.getByName("age_groups")) {
    events.fields.add(new JSONField({ name: "age_groups" }));
  }
  if (!events.fields.getByName("age_class")) {
    events.fields.add(new TextField({ name: "age_class" }));
  }
  if (!events.fields.getByName("age_split")) {
    events.fields.add(new BoolField({ name: "age_split" }));
  }
  app.save(events);

  const pools = app.findCollectionByNameOrId("pools");
  if (!pools.fields.getByName("tiebreak")) {
    pools.fields.add(new JSONField({ name: "tiebreak" }));
  }
  if (!pools.fields.getByName("ages")) {
    pools.fields.add(new JSONField({ name: "ages" }));
  }
  if (!pools.fields.getByName("class")) {
    pools.fields.add(new TextField({ name: "class" }));
  }
  app.save(pools);

  let photos;
  try { photos = app.findCollectionByNameOrId("venue_photos"); }
  catch (err) {
    photos = new Collection({
      name: "venue_photos",
      type: "base",
      listRule: "public = true || @request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      viewRule: "public = true || @request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      createRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      deleteRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
    });
    photos.fields.add(new RelationField({ name: "event", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true }));
    photos.fields.add(new RelationField({ name: "field", collectionId: app.findCollectionByNameOrId("fields").id, maxSelect: 1 }));
    photos.fields.add(new FileField({
      name: "image",
      maxSelect: 1,
      maxSize: 8388608,
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
      protected: false,
    }));
    photos.fields.add(new TextField({ name: "caption" }));
    photos.fields.add(new SelectField({
      name: "kind",
      maxSelect: 1,
      values: ["entrance", "parking", "layout", "field", "other"],
    }));
    photos.fields.add(new NumberField({ name: "sort" }));
    photos.fields.add(new BoolField({ name: "public" }));
    photos.fields.add(new RelationField({ name: "uploaded_by", collectionId: app.findCollectionByNameOrId("users").id, maxSelect: 1 }));
    app.save(photos);
  }

  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("verify_token")) {
    users.fields.add(new TextField({ name: "verify_token" }));
    app.save(users);
  }

  const def = { order: ["record", "h2h", "ra", "diff", "rs"], explicit: true };
  const poolRows = app.findRecordsByFilter("pools", "", "", 400, 0);
  for (let i = 0; i < poolRows.length; i++) {
    if (!poolRows[i].get("tiebreak")) {
      poolRows[i].set("tiebreak", def);
      app.save(poolRows[i]);
    }
  }

  try {
    const keystone = app.findFirstRecordByData("events", "slug", "keystone-clash-2026");
    keystone.set("age_groups", { ages: ["11U", "12U"], class: "C", split: false });
    keystone.set("age_class", "C");
    keystone.set("age_split", false);
    keystone.set("ages", "11U/12U-C");
    app.save(keystone);
  } catch (err) {}
}, (app) => {});
