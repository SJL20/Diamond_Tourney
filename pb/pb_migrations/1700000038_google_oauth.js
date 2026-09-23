/// <reference path="../pb_data/types.d.ts" />

// Google sign-in may create a users row. Direct REST creates stay closed.
// The Google name maps onto display_name. Client id and secret stay out of
// git: boot reads GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.
// Do not list or delete events.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = "@request.context = 'oauth2'";
  if (users.oauth2 && users.oauth2.mappedFields) {
    users.oauth2.mappedFields.name = "display_name";
  }
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.createRule = null;
  app.save(users);
});
