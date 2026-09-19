/// <reference path="../pb_data/types.d.ts" />

// Closed box-submission rows (item 21–22). Tokens and coach emails never
// live on a public collection. Additive only.
migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  const teams = app.findCollectionByNameOrId("event_teams");
  const schedule = app.findCollectionByNameOrId("event_schedule");
  const bracket = app.findCollectionByNameOrId("bracket_games");

  function addValue(col, name, value) {
    const field = col.fields.getByName(name);
    if (!field) return;
    const values = field.values || [];
    if (values.indexOf(value) === -1) {
      values.push(value);
      field.values = values;
    }
  }

  addValue(schedule, "status", "cancelled");
  addValue(schedule, "status", "forfeit");
  if (!schedule.fields.getByName("score_source")) {
    schedule.fields.add(new TextField({ name: "score_source" }));
  }
  app.save(schedule);

  if (!bracket.fields.getByName("score_source")) {
    bracket.fields.add(new TextField({ name: "score_source" }));
  }
  app.save(bracket);

  try {
    const contacts = app.findCollectionByNameOrId("team_contacts");
    if (!contacts.fields.getByName("box_mail_opt_out")) {
      contacts.fields.add(new BoolField({ name: "box_mail_opt_out" }));
      app.save(contacts);
    }
  } catch (err) {}

  try {
    const log = app.findCollectionByNameOrId("sync_log");
    const kind = log.fields.getByName("kind");
    if (kind) {
      const values = kind.values || [];
      if (values.indexOf("box_mail") === -1) values.push("box_mail");
      kind.values = values;
      app.save(log);
    }
  } catch (err) {}

  try { app.findCollectionByNameOrId("box_submissions"); return; }
  catch (err) {}

  const col = new Collection({
    name: "box_submissions",
    type: "base",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    indexes: [
      "CREATE INDEX idx_box_sub_event ON box_submissions (event)",
      "CREATE UNIQUE INDEX idx_box_sub_token ON box_submissions (token)",
      "CREATE INDEX idx_box_sub_game_team ON box_submissions (event, schedule_row, team)",
    ],
  });
  col.fields.add(new RelationField({
    name: "event",
    collectionId: events.id,
    required: true,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new RelationField({
    name: "schedule_row",
    collectionId: schedule.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new RelationField({
    name: "bracket_row",
    collectionId: bracket.id,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new RelationField({
    name: "team",
    collectionId: teams.id,
    required: true,
    maxSelect: 1,
    cascadeDelete: true,
  }));
  col.fields.add(new TextField({ name: "token", required: true }));
  col.fields.add(new DateField({ name: "expires" }));
  col.fields.add(new DateField({ name: "emailed_at" }));
  col.fields.add(new DateField({ name: "reminder_at" }));
  col.fields.add(new DateField({ name: "submitted_at" }));
  col.fields.add(new TextField({ name: "submitted_by" }));
  col.fields.add(new SelectField({
    name: "method",
    maxSelect: 1,
    values: ["gc_pdf", "gc_link", "photo", "manual"],
  }));
  col.fields.add(new FileField({
    name: "file",
    maxSelect: 1,
    maxSize: 15728640,
    mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
  }));
  col.fields.add(new URLField({ name: "gc_url" }));
  col.fields.add(new JSONField({ name: "parsed" }));
  col.fields.add(new SelectField({
    name: "status",
    maxSelect: 1,
    values: ["invited", "pending", "parsed", "failed", "verified", "conflict"],
  }));
  col.fields.add(new BoolField({ name: "unsubscribed" }));
  col.fields.add(new NumberField({ name: "home_runs" }));
  col.fields.add(new NumberField({ name: "away_runs" }));
  app.save(col);
});
