// Asset addresses follow the file bytes. A phone that receives the page
// cannot reuse a stylesheet or script from an older deploy.

const PUBLIC_DIR = __hooks + "/../pb_public";
const ASSET_FILES = [
  "css/app.css",
  "js/app.js",
  "js/event.js",
  "js/flow.js",
  "js/chrome.js",
  "js/client.js",
  "js/display.js",
  "js/metrics.js",
];

function readText(rel) {
  return toString($os.readFile(PUBLIC_DIR + "/" + rel));
}

function version() {
  let joined = "";
  for (let i = 0; i < ASSET_FILES.length; i++) {
    joined += $security.sha256(readText(ASSET_FILES[i]));
  }
  return $security.sha256(joined).slice(0, 12);
}

function shellHtml() {
  return readText("index.html").split("ASSET_VERSION").join(version());
}

function exists(path) {
  const value = String(path || "");
  if (!value || value.indexOf("..") !== -1) return false;
  const rel = value.replace(/\/+$/, "");
  if (!rel) return false;
  try {
    $os.stat(PUBLIC_DIR + rel);
    return true;
  } catch (err) {
    return false;
  }
}

function kind(path) {
  const value = String(path || "");
  if (!value || value.indexOf("/api/") === 0 || value === "/api") return "api";
  if (value.indexOf("/_/") === 0 || value === "/_") return "admin";
  const lower = value.toLowerCase();
  if (
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".css") ||
    lower.endsWith(".map")
  ) {
    return "asset";
  }
  if (lower.endsWith(".html")) return "html";
  const slash = lower.lastIndexOf("/");
  const base = slash >= 0 ? lower.slice(slash + 1) : lower;
  if (base.indexOf(".") === -1) return "document";
  return "other";
}

function shellCookie(e) {
  try {
    const cookie = e.request.cookie("dt_shell");
    if (!cookie) return "";
    return String(cookie.value || "");
  } catch (err) {
    return "";
  }
}

module.exports = {
  version: version,
  shellHtml: shellHtml,
  kind: kind,
  exists: exists,
  shellCookie: shellCookie,
  ASSET_FILES: ASSET_FILES,
};
