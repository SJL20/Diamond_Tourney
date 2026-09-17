migrate((app) => {
  let clubs;
  try {
    clubs = app.findCollectionByNameOrId("club_teams");
  } catch (err) {
    clubs = new Collection({
      name: "club_teams",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.role = 'region_admin' || @request.auth.role = 'event_td'",
      deleteRule: "@request.auth.role = 'region_admin'",
      fields: [
        { name: "name", type: "text", required: true },
        { name: "slug", type: "text", required: true },
        { name: "gamechanger_url", type: "url" },
        { name: "gc_team_ref", type: "text" },
        { name: "ages", type: "text" },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_club_teams_ref ON club_teams (gc_team_ref)",
        "CREATE UNIQUE INDEX idx_club_teams_slug ON club_teams (slug)",
      ],
    });
    app.save(clubs);
  }

  const eventTeams = app.findCollectionByNameOrId("event_teams");
  if (!eventTeams.fields.getByName("club")) {
    eventTeams.fields.add(new RelationField({
      name: "club",
      collectionId: clubs.id,
      maxSelect: 1,
      cascadeDelete: false,
    }));
  }
  app.save(eventTeams);

  function slugify(name) {
    return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "club";
  }
  function gcRef(url) {
    const m = String(url || "").match(/^https?:\/\/([^?#]+)/i);
    return m ? m[1].replace(/\/+$/, "") : "";
  }
  const rows = app.findRecordsByFilter("event_teams", "gamechanger_url != ''", "name", 200, 0);
  for (const row of rows) {
    const url = row.get("gamechanger_url");
    const ref = gcRef(url);
    if (!ref) continue;
    let club;
    try {
      club = app.findFirstRecordByData("club_teams", "gc_team_ref", ref);
    } catch (err) {
      club = new Record(app.findCollectionByNameOrId("club_teams"));
      club.set("gc_team_ref", ref);
      let slug = slugify(row.get("name"));
      let n = 2;
      while (true) {
        try {
          app.findFirstRecordByData("club_teams", "slug", slug);
          slug = slugify(row.get("name")) + "-" + n;
          n++;
        } catch (miss) {
          break;
        }
      }
      club.set("slug", slug);
    }
    club.set("name", row.get("name"));
    club.set("gamechanger_url", url);
    app.save(club);
    row.set("club", club.id);
    app.save(row);
  }
}, (app) => {});
