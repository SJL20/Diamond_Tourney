import {
  formatDateDisplay,
  formatHoursRange,
  formatTimeDisplay,
  formatWhen,
  formatWeekendDates,
  parseDateParts,
  stampDataTh,
} from "../pb/pb_public/js/display.js";

function eq(got, want, label) {
  if (got !== want) throw new Error(`${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

eq(formatTimeDisplay("08:00"), "8:00 AM", "morning");
eq(formatTimeDisplay("12:30"), "12:30 PM", "afternoon");
eq(formatTimeDisplay("18:00"), "6:00 PM", "evening");
eq(formatTimeDisplay("00:15"), "12:15 AM", "midnight");
eq(formatHoursRange("08:00", "18:00"), "8 AM – 6 PM", "park hours");
eq(formatDateDisplay("2026-10-03"), "Sat, Oct 3", "weekday date");
eq(parseDateParts("2026-10-03")?.d, 3, "iso day");
eq(formatWhen("2026-10-03", "12:30"), "Sat, Oct 3 · 12:30 PM", "when line");
eq(formatWeekendDates("2026-09-26", "2026-09-28"), "September 26–28, 2026", "weekend");
eq(formatWeekendDates("2026-10-03", "2026-10-03"), "October 3, 2026", "one day");
if (/2026-10-03/.test(formatDateDisplay("2026-10-03"))) {
  throw new Error("ISO date leaked into display");
}
const stamped = stampDataTh("<tr><td>x</td><td>y</td></tr>", ["When", "Field"]);
if (!stamped.includes('data-th="When"') || !stamped.includes('data-th="Field"')) {
  throw new Error("stampDataTh missed headers: " + stamped);
}
console.log("display.js ok");
