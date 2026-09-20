const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function parseClock(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let h = Number(ampm[1]);
    const ap = ampm[3].toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return { h, m: Number(ampm[2]) };
  }
  const hm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!hm) return null;
  return { h: Number(hm[1]), m: Number(hm[2]) };
}

export function formatTimeDisplay(raw, opts = {}) {
  const t = parseClock(raw);
  if (!t) return raw ? String(raw) : "";
  const ap = t.h >= 12 ? "PM" : "AM";
  let h = t.h % 12;
  if (h === 0) h = 12;
  if (opts.dropZeroMinutes && t.m === 0) return `${h} ${ap}`;
  return `${h}:${String(t.m).padStart(2, "0")} ${ap}`;
}

export function formatHoursRange(start, end) {
  const a = formatTimeDisplay(start, { dropZeroMinutes: true });
  const b = formatTimeDisplay(end, { dropZeroMinutes: true });
  if (!a && !b) return "";
  if (!b) return a;
  if (!a) return b;
  return `${a} – ${b}`;
}

export function parseDateParts(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { y: Number(iso[1]), mo: Number(iso[2]), d: Number(iso[3]) };
  const dt = new Date(s);
  if (Number.isNaN(+dt)) return null;
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function formatDateDisplay(raw) {
  const p = parseDateParts(raw);
  if (!p) return "";
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d));
  return `${DAYS[dt.getUTCDay()]}, ${MONTHS[p.mo - 1]} ${p.d}`;
}

export function formatWhen(date, time) {
  return [formatDateDisplay(date), formatTimeDisplay(time)].filter(Boolean).join(" · ");
}

export function stampDataTh(rowHtml, headers) {
  const labels = (headers || []).map((h) =>
    String(h).replace(/<[^>]+>/g, "").replace(/&/g, "&amp;").replace(/"/g, "&quot;")
  );
  let i = 0;
  return String(rowHtml || "").replace(/<td(\s[^>]*)?>/gi, (full, attrs = "") => {
    if (/\bcolspan\s*=/i.test(attrs) || /\bdata-th\s*=/i.test(attrs)) return full;
    const label = labels[i] || "";
    i += 1;
    return `<td data-th="${label}"${attrs}>`;
  });
}

export function formatWeekendDates(start, end) {
  const a = parseDateParts(start);
  if (!a) return "";
  const b = parseDateParts(end);
  const dayLong = (p) => MONTHS_LONG[p.mo - 1] + " " + p.d;
  if (!b || (a.y === b.y && a.mo === b.mo && a.d === b.d)) {
    return dayLong(a) + ", " + a.y;
  }
  if (a.y === b.y && a.mo === b.mo) {
    return MONTHS_LONG[a.mo - 1] + " " + a.d + "–" + b.d + ", " + a.y;
  }
  if (a.y === b.y) {
    return dayLong(a) + " – " + dayLong(b) + ", " + a.y;
  }
  return dayLong(a) + ", " + a.y + " – " + dayLong(b) + ", " + b.y;
}
