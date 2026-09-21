/// <reference path="../pb_data/types.d.ts" />

// Resend rejects the PocketBase placeholder sender (support@example.com).
// The live domain is already verified. Do not list or delete events.

migrate((app) => {
  const settings = app.settings();
  const addr = String((settings.meta && settings.meta.senderAddress) || "");
  if (addr && addr.indexOf("@example.com") === -1) return;
  settings.meta.senderAddress = "noreply@diamondtourney.com";
  settings.meta.senderName = "Diamond Tourney";
  const name = String((settings.meta && settings.meta.appName) || "");
  if (!name || name === "Region Softball" || name === "Acme") {
    settings.meta.appName = "Diamond Tourney";
  }
  app.save(settings);
}, (app) => {});
