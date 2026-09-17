migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  const users = app.findCollectionByNameOrId("users");
  const eventTeams = app.findCollectionByNameOrId("event_teams");

  function addSelect(col, name, values) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new SelectField({ name: name, maxSelect: 1, values: values }));
  }
  function addText(col, name) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new TextField({ name: name }));
  }
  function addNum(col, name) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new NumberField({ name: name, min: 0 }));
  }
  function addBool(col, name) {
    if (col.fields.getByName(name)) return;
    col.fields.add(new BoolField({ name: name }));
  }

  addSelect(events, "governing_body", ["usa_softball", "usssa", "pgf", "triple_crown", "rec", "other"]);
  addText(events, "governing_notes");
  addSelect(events, "pitch_limit_mode", ["ip", "pitch_count", "both", "none"]);
  addNum(events, "pitch_limit_pitches");
  addText(events, "pitch_limit_notes");
  addNum(events, "game_length_minutes");
  addNum(events, "innings_cap");
  addText(events, "mercy_rule");
  addNum(events, "umpire_count");
  addText(events, "rules_notes");
  if (!events.fields.getByName("rules_file")) {
    events.fields.add(new FileField({
      name: "rules_file",
      maxSelect: 1,
      maxSize: 15728640,
      mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    }));
  }
  addBool(events, "require_insurance");
  addBool(events, "require_roster");
  addBool(events, "require_birth_certs");
  addBool(events, "require_waiver");
  addBool(events, "require_coach_cert");
  addText(events, "packet_notes");
  app.save(events);

  addSelect(eventTeams, "packet_status", ["incomplete", "submitted", "approved", "needs_fix"]);
  addText(eventTeams, "packet_note");
  app.save(eventTeams);

  try {
    app.findCollectionByNameOrId("team_docs");
  } catch (err) {
    const docs = new Collection({
      name: "team_docs",
      type: "base",
      listRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.id != ''",
      viewRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td' || @request.auth.id != ''",
      createRule: null,
      updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      deleteRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      fields: [
        { name: "event", type: "relation", collectionId: events.id, required: true, maxSelect: 1, cascadeDelete: true },
        { name: "event_team", type: "relation", collectionId: eventTeams.id, required: true, maxSelect: 1, cascadeDelete: true },
        { name: "kind", type: "select", maxSelect: 1, values: ["insurance", "roster", "birth_certs", "waiver", "coach_cert", "other"] },
        { name: "file", type: "file", maxSelect: 1, maxSize: 15728640, mimeTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
        { name: "original_name", type: "text" },
        { name: "status", type: "select", maxSelect: 1, values: ["submitted", "approved", "rejected"] },
        { name: "note", type: "text" },
        { name: "uploaded_by", type: "relation", collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      ],
    });
    app.save(docs);
  }

  try {
    const keystone = app.findFirstRecordByData("events", "slug", "keystone-clash-2026");
    keystone.set("governing_body", "usa_softball");
    keystone.set("governing_notes", "USA Softball rules. Sanction posted in the coaches packet.");
    keystone.set("pitch_limit_mode", "ip");
    keystone.set("pitch_limit_ip", 6);
    keystone.set("pitch_limit_notes", "Weekend cap 6.0 IP. Tracked on the leaders board.");
    keystone.set("game_length_minutes", 90);
    keystone.set("innings_cap", 7);
    keystone.set("mercy_rule", "12 after 3, 10 after 4, 8 after 5");
    keystone.set("umpire_count", 2);
    keystone.set("rules_notes", "USA Softball. 90 minutes, finish the inning. Full rules and coaches packet are on this host.");
    keystone.set("require_insurance", true);
    keystone.set("require_roster", true);
    keystone.set("require_birth_certs", false);
    keystone.set("require_waiver", false);
    keystone.set("require_coach_cert", false);
    keystone.set("packet_notes", "Certificate of insurance and an official roster before first pitch. Birth certificates only if the director asks at the plate meeting.");
    app.save(keystone);
  } catch (miss) {}
}, (app) => {});
