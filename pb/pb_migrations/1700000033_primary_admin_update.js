/// <reference path="../pb_data/types.d.ts" />

// The verified primary site admin can edit other accounts (the hook still
// decides which fields). An unverified login cannot. Do not list or delete events.

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.updateRule = "id = @request.auth.id || (@request.auth.id != '' && @request.auth.verified = true && (@request.auth.role = 'region_admin' || @request.auth.email = 'ladydukeslafever@gmail.com'))";
  app.save(users);
}, (app) => {});
