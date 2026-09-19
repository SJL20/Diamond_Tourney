const KIND_ORDER = { entrance: 0, parking: 1, layout: 2, field: 3, other: 4 };

function photoJson(app, rec, withFile) {
  const host = require(__hooks + "/host.js");
  const show = withFile || !!rec.get("public");
  return {
    id: rec.id,
    kind: rec.get("kind") || "other",
    caption: rec.get("caption") || "",
    sort: Number(rec.get("sort") || 0),
    public: !!rec.get("public"),
    field: rec.get("field") || "",
    url: show ? host.fileUrl(app, "venue_photos", rec, "image") : "",
  };
}

function listPhotos(app, eventId, publicOnly) {
  const rows = app.findRecordsByFilter("venue_photos", "event = {:e}", "sort", 40, 0, { e: eventId });
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (publicOnly && !rows[i].get("public")) continue;
    out.push(photoJson(app, rows[i], !publicOnly));
  }
  out.sort(function (a, b) {
    const ka = (KIND_ORDER[a.kind] != null ? KIND_ORDER[a.kind] : 9) * 100 + a.sort;
    const kb = (KIND_ORDER[b.kind] != null ? KIND_ORDER[b.kind] : 9) * 100 + b.sort;
    return ka - kb;
  });
  return out;
}

function headerPhoto(app, eventId) {
  const rows = listPhotos(app, eventId, true);
  return rows.length ? rows[0] : null;
}

function savePhoto(app, event, body, files, auth) {
  if (!files || !files.length) throw new BadRequestError("Choose a photo of the field or parking lot.");
  const rec = new Record(app.findCollectionByNameOrId("venue_photos"));
  rec.set("event", event.id);
  if (body.field) rec.set("field", body.field);
  rec.set("image", files);
  rec.set("caption", String(body.caption || "").slice(0, 200));
  rec.set("kind", body.kind || "other");
  rec.set("sort", Number(body.sort || 0));
  rec.set("public", false);
  if (auth) rec.set("uploaded_by", auth.id);
  app.save(rec);
  stripSavedImage(app, rec);
  return photoJson(app, rec, true);
}

function stripSavedImage(app, rec) {
  const name = rec.get("image");
  if (!name) return false;
  const file = Array.isArray(name) ? name[0] : String(name);
  if (/\.pdf$/i.test(file)) return false;
  try {
    const col = app.findCollectionByNameOrId("venue_photos");
    const path = [app.dataDir(), "storage", col.id, rec.id, file].join("/");
    const raw = $os.readFile(path);
    const stripped = require(__hooks + "/exif.js").stripExif(raw);
    $os.writeFile(path, stripped);
    return true;
  } catch (err) {
    return false;
  }
}

function publishPhoto(app, event, id, publicFlag) {
  const rec = app.findRecordById("venue_photos", id);
  if (rec.get("event") !== event.id) throw new BadRequestError("Photo is not on this tournament");
  rec.set("public", publicFlag !== false && publicFlag !== "false");
  app.save(rec);
  return photoJson(app, rec);
}

function reorderPhotos(app, event, ids) {
  const list = Array.isArray(ids) ? ids : String(ids || "").split(",");
  for (let i = 0; i < list.length; i++) {
    const id = String(list[i] || "").trim();
    if (!id) continue;
    try {
      const rec = app.findRecordById("venue_photos", id);
      if (rec.get("event") !== event.id) continue;
      rec.set("sort", i);
      app.save(rec);
    } catch (err) {}
  }
  return listPhotos(app, event.id, false);
}

module.exports = {
  listPhotos: listPhotos,
  headerPhoto: headerPhoto,
  savePhoto: savePhoto,
  publishPhoto: publishPhoto,
  reorderPhotos: reorderPhotos,
  photoJson: photoJson,
  stripSavedImage: stripSavedImage,
};
