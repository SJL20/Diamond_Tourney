/// <reference path="../pb_data/types.d.ts" />

// The page is not stored. Its stylesheet and scripts use a hash of their
// bytes, so a saved copy from before this response cannot be the one that loads.
// The first response after the files change tells the browser to delete its
// HTTP cache. A later response in that same visit does not, so a weekend of
// refreshes can still reuse an unchanged script. Login cookies and storage stay.

routerUse((e) => {
  try {
    const cache = require(__hooks + "/static_cache.js");
    const path = String((e.request && e.request.url && e.request.url.path) || "");
    let kind = cache.kind(path);
    if (kind === "document" && path !== "/" && cache.exists(path)) kind = "html";
    if (kind === "asset") {
      e.response.header().set("Cache-Control", "no-cache");
    } else if (kind === "html" || kind === "document" || kind === "api") {
      const version = cache.version();
      const stale = cache.shellCookie(e) !== version;
      if (kind === "html" || kind === "document") {
        e.response.header().set("Cache-Control", "no-store");
      }
      if (stale) {
        e.response.header().set("Clear-Site-Data", '"cache"');
        let cookie = "dt_shell=" + version + "; Path=/; Max-Age=34560000; HttpOnly; SameSite=Lax";
        try {
          if (e.isTLS()) cookie += "; Secure";
        } catch (err) {}
        e.response.header().add("Set-Cookie", cookie);
      }
      if (kind === "document") {
        e.html(200, cache.shellHtml());
        return;
      }
    }
  } catch (err) {
    console.log("static-cache err", String(err));
  }
  return e.next();
});
