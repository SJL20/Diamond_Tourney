// In-process limits for account routes. One Fly machine, so this map is the
// limiter. Loopback stays loose so the local test suite can log in; public
// IPs stay tight. Forgot-password is also capped per address everywhere.
const buckets = {};

function clientIp(e) {
  try {
    const ip = e.realIP();
    if (ip) return String(ip);
  } catch (err) {}
  return "unknown";
}

function loopback(ip) {
  return ip === "127.0.0.1" || ip === "::1";
}

function hit(key, limit, windowMs) {
  const now = Date.now();
  const prev = buckets[key] || [];
  const fresh = [];
  for (let i = 0; i < prev.length; i++) {
    if (now - prev[i] < windowMs) fresh.push(prev[i]);
  }
  if (fresh.length >= limit) {
    buckets[key] = fresh;
    throw new TooManyRequestsError("Too many attempts. Wait a little while and try again.");
  }
  fresh.push(now);
  buckets[key] = fresh;
}

function limitAuth(e, action, email) {
  const ip = clientIp(e);
  const local = loopback(ip);
  const hour = 60 * 60 * 1000;
  const quarter = 15 * 60 * 1000;
  if (action === "login") {
    hit("login:" + ip, local ? 5000 : 30, quarter);
    return;
  }
  if (action === "register") {
    hit("register:" + ip, local ? 500 : 8, hour);
    return;
  }
  if (action === "forgot") {
    hit("forgot-ip:" + ip, local ? 500 : 8, hour);
    const addr = String(email || "").trim().toLowerCase();
    if (addr) hit("forgot-email:" + addr, 5, hour);
    return;
  }
  if (action === "reset") {
    hit("reset:" + ip, local ? 500 : 10, hour);
    return;
  }
  if (action === "resend") {
    const who = (email || ip || "unknown");
    hit("resend:" + who, 5, hour);
  }
}

module.exports = {
  clientIp: clientIp,
  limitAuth: limitAuth,
};
