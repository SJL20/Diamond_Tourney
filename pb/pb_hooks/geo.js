function geocodeAddress(address) {
  const q = String(address || "").trim();
  if (!q) return null;
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
  const res = $http.send({
    url: url,
    method: "GET",
    headers: { "User-Agent": "DiamondTourney/1.0 (tournament host; field pin)" },
    timeout: 10,
  });
  if (res.statusCode < 200 || res.statusCode >= 400 || !res.body) return null;
  let rows;
  try { rows = JSON.parse(String(res.body)); } catch (err) { return null; }
  if (!rows || !rows.length) return null;
  const lat = Number(rows[0].lat);
  const lng = Number(rows[0].lon);
  if (!lat || !lng) return null;
  return { lat: lat, lng: lng, label: rows[0].display_name || q };
}

function applyGeocode(rec, body) {
  body = body || {};
  const address = String(body.address != null ? body.address : (rec.get("address") || "")).trim();
  if (address) rec.set("address", address);
  if (!address) return null;
  const same = rec.get("address") === address && rec.get("lat") && rec.get("lng") && body.geocode !== true && body.geocode !== "true";
  if (same) return { source: "kept", lat: rec.get("lat"), lng: rec.get("lng") };
  const hit = geocodeAddress(address);
  if (!hit) return { source: "failed", address: address };
  rec.set("lat", hit.lat);
  rec.set("lng", hit.lng);
  return { source: "geocode", lat: hit.lat, lng: hit.lng, label: hit.label };
}

module.exports = {
  geocodeAddress: geocodeAddress,
  applyGeocode: applyGeocode,
};
