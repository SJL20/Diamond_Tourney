/// <reference path="../pb_data/types.d.ts" />

// PocketBase number columns are NOT NULL DEFAULT 0, so a blank cell cannot
// live in the number itself. `blank` lists the field names that were unreadable.
// A real 0 stays 0 and is not listed. Do not list or delete events.

migrate((app) => {
  function addBlank(name) {
    const col = app.findCollectionByNameOrId(name);
    if (!col.fields.getByName("blank")) {
      col.fields.add(new JSONField({ name: "blank" }));
      app.save(col);
    }
  }
  addBlank("event_hitting");
  addBlank("event_pitching");
});
