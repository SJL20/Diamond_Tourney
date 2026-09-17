export function ipToOuts(ip) {
  if (ip === null || ip === undefined || ip === "") return null;
  const text = String(ip).trim();
  if (text.includes(".")) {
    const [w, f] = text.split(".");
    const rem = Number(f[0] || 0);
    return Number(w || 0) * 3 + rem;
  }
  return Number(text) * 3;
}

export function outsToIp(outs) {
  const n = Number(outs || 0);
  return `${Math.floor(n / 3)}.${n % 3}`;
}

export function battingAverage(h, ab) {
  if (!ab) return ".000";
  return (h / ab).toFixed(3).replace(/^0/, "");
}

export function contactPct(ab, so) {
  if (!ab) return "—";
  return `${(((ab - so) / ab) * 100).toFixed(1)}%`;
}

export function era(er, ipOuts) {
  if (!ipOuts) return "—";
  return ((er * 7) / (ipOuts / 3)).toFixed(2);
}

export function strikePct(strikes, pitches) {
  if (!pitches) return "—";
  return `${((strikes / pitches) * 100).toFixed(1)}%`;
}

export function resultOf(us, them) {
  if (us > them) return "W";
  if (us < them) return "L";
  return "T";
}
