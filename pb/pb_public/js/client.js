const AUTH_COOKIE = "pb_auth";

function cookieSecure() {
  return location.protocol === "https:";
}

function persistCookie() {
  try {
    if (typeof pb.authStore.exportToCookie === "function") {
      document.cookie = pb.authStore.exportToCookie({
        httpOnly: false,
        secure: cookieSecure(),
        sameSite: "Lax",
        path: "/",
      });
      return;
    }
  } catch (err) {}
  try {
    const raw = encodeURIComponent(JSON.stringify({
      token: pb.authStore.token || "",
      record: pb.authStore.record || null,
    }));
    document.cookie = `${AUTH_COOKIE}=${raw}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax${cookieSecure() ? "; Secure" : ""}`;
  } catch (err) {}
}

function clearCookie() {
  try {
    if (typeof pb.authStore.exportToCookie === "function") {
      document.cookie = pb.authStore.exportToCookie({
        httpOnly: false,
        secure: cookieSecure(),
        sameSite: "Lax",
        path: "/",
      });
    }
  } catch (err) {}
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0`;
}

function restoreCookie() {
  if (pb.authStore.token) return;
  try {
    if (typeof pb.authStore.loadFromCookie === "function") {
      pb.authStore.loadFromCookie(document.cookie);
    }
  } catch (err) {}
}

export const pb = new PocketBase(location.origin);
restoreCookie();
pb.authStore.onChange(() => {
  if (pb.authStore.token) persistCookie();
  else clearCookie();
});

export function authHeader() {
  const token = pb.authStore.token;
  if (!token) return {};
  return { Authorization: token.startsWith("Bearer ") ? token : `Bearer ${token}` };
}

export async function apiSend(path, options = {}) {
  const headers = { ...authHeader(), ...(options.headers || {}) };
  if (options.body && typeof options.body === "object" && !(options.body instanceof FormData) && typeof options.body !== "string") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
  }
  try {
    const data = await pb.send(path, { ...options, headers });
    return { ok: true, status: 200, data };
  } catch (err) {
    return {
      ok: false,
      status: Number(err?.status || err?.response?.status || 0) || 0,
      message: err?.message || String(err),
      data: err?.data || err?.response || {},
    };
  }
}

export function markSiteAdminRecord() {
  const rec = pb.authStore.record;
  const token = pb.authStore.token;
  if (!rec || !token) return;
  try {
    pb.authStore.save(token, { ...rec, role: rec.role === "bot" ? rec.role : "region_admin" });
  } catch (err) {}
}

export function clearAuth() {
  try { pb.authStore.clear(); } catch (err) {}
  clearCookie();
}
