migrate((app) => {
  const clubs = app.findCollectionByNameOrId("club_teams");
  if (!clubs.fields.getByName("notes")) {
    clubs.fields.add(new TextField({ name: "notes" }));
  }
  if (!clubs.fields.getByName("contact_email")) {
    clubs.fields.add(new EmailField({ name: "contact_email" }));
  }
  app.save(clubs);
}, (app) => {});
