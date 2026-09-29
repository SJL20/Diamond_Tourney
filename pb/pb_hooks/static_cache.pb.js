/// <reference path="../pb_data/types.d.ts" />

// HTML, CSS, and JS must revalidate. A phone that stored an older stylesheet
// with no Cache-Control kept using it after a deploy and stayed on Loading.
// API and admin routes keep PocketBase's own headers.
// A failure here must not turn the request into a 400.
// The check stays inside the handler. A top-level function in a .pb.js file
// is not visible to the router callback.

routerUse((e) => {
  try {
    const path = String((e.request && e.request.url && e.request.url.path) || "");
    let revalidate = false;
    if (path && path.indexOf("/api/") !== 0 && path !== "/api" && path.indexOf("/_/") !== 0 && path !== "/_") {
      const lower = path.toLowerCase();
      if (
        lower.endsWith(".js") ||
        lower.endsWith(".mjs") ||
        lower.endsWith(".css") ||
        lower.endsWith(".html") ||
        lower.endsWith(".map")
      ) {
        revalidate = true;
      } else {
        const slash = lower.lastIndexOf("/");
        const base = slash >= 0 ? lower.slice(slash + 1) : lower;
        revalidate = base.indexOf(".") === -1;
      }
    }
    if (revalidate) {
      e.response.header().set("Cache-Control", "no-cache");
    }
  } catch (err) {
    console.log("static-cache err", String(err));
  }
  return e.next();
});
