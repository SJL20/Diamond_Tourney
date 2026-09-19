migrate((app) => {
  try {
    const photos = app.findCollectionByNameOrId("venue_photos");
    const image = photos.fields.getByName("image");
    if (!image) return;
    image.maxSize = 5242880;
    image.mimeTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      "application/pdf",
    ];
    app.save(photos);
  } catch (err) {}
}, (app) => {});
