/// <reference path="../pb_data/types.d.ts" />

const LIVE_POLL_SECONDS = 300;
const IDLE_POLL_SECONDS = 1800;

function pushUnique(seen, out, item) {
  const key = [item.kind, item.gc_url || "", item.schedule_id || "", item.event_slug || "", item.team_slug || item.team_name || ""].join("|");
  if (seen[key]) return;
  seen[key] = true;
  out.push(item);
}

function eventSlug(app, eventId) {
  if (!eventId) return "";
  try {
    return app.findRecordById("events", eventId).get("slug");
  } catch (err) {
    return "";
  }
}

function listLiveEvents(app) {
  try {
    return app.findRecordsByFilter("events", "status = 'live'", "start", 80, 0);
  } catch (err) {
    return [];
  }
}

function listGcMonitor(app) {
  const host = require(__hooks + "/host.js");
  const watch = [];
  const seen = {};
  const liveRecords = listLiveEvents(app);
  const live = liveRecords.map(function (ev) {
    return {
      id: ev.id,
      slug: ev.get("slug"),
      name: ev.get("name"),
      status: ev.get("status"),
    };
  });
  const liveIds = {};
  for (const ev of liveRecords) liveIds[ev.id] = true;

  for (const ev of liveRecords) {
    let teams = [];
    try {
      teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 200, 0, { e: ev.id });
    } catch (err) {
      teams = [];
    }
    for (const team of teams) {
      const url = String(team.get("gamechanger_url") || "").trim();
      if (!host.isGameChangerUrl(url)) continue;
      pushUnique(seen, watch, {
        kind: "event_team",
        priority: "live",
        event_slug: ev.get("slug"),
        event_status: ev.get("status"),
        team_name: team.get("name"),
        team_slug: team.get("slug") || "",
        gc_url: url,
        write: "POST /api/bot/event-box or POST /api/bot/event-update",
        note: "Open this coach-supplied public team page. If a public box-score URL is posted, read visible numbers only. Attach the box URL or post extracted lines. Never invent a pool box this page does not show.",
      });
    }
  }

  let boxes = [];
  try {
    boxes = app.findRecordsByFilter("event_boxes", "", "-id", 200, 0);
  } catch (err) {
    boxes = [];
  }
  for (const rec of boxes) {
    const url = String(rec.get("gc_url") || "").trim();
    if (!url || (!host.isGcBoxUrl(url) && !host.isGameChangerUrl(url))) continue;
    const eventId = rec.get("event") || "";
    const liveEvent = !!liveIds[eventId];
    pushUnique(seen, watch, {
      kind: "event_box",
      priority: liveEvent ? "live" : "stored",
      event_slug: eventSlug(app, eventId),
      event_status: liveEvent ? "live" : "",
      schedule_id: rec.get("schedule_row") || "",
      box_status: rec.get("status") || "",
      gc_url: url,
      write: "POST /api/bot/event-box",
      note: "Read posted score and lines from this public box URL. Unreadable cell → null + QC note. Use status needs_review when alignment is bad. Do not invent.",
    });
  }

  let clubs = [];
  try {
    clubs = app.findRecordsByFilter("club_teams", "", "name", 200, 0);
  } catch (err) {
    clubs = [];
  }
  for (const club of clubs) {
    const url = String(club.get("gamechanger_url") || "").trim();
    if (!host.isGameChangerUrl(url)) continue;
    pushUnique(seen, watch, {
      kind: "club",
      priority: "season",
      team_name: club.get("name"),
      team_slug: club.get("slug") || "",
      gc_url: url,
      write: "POST /api/bot/ingest",
      note: "Season / year book. Parse a public box only. Write staging_games. Coach must Approve. Bot never approves staging and never deletes approved rows.",
    });
  }

  const anyLive = live.length > 0;
  return {
    policy: {
      allowed: true,
      public_urls_only: true,
      gc_login: false,
      unofficial_api: false,
      interval_seconds: anyLive ? LIVE_POLL_SECONDS : IDLE_POLL_SECONDS,
      interval_note: anyLive
        ? "About every 5 minutes while an event is live."
        : "No live event — poll about every 30 minutes, or wait until a weekend is live.",
      season_write: "POST /api/bot/ingest → staging_games; human Approve required",
      event_write: "POST /api/bot/event-box or POST /api/bot/event-update",
      pdf_ocr_still_supported: true,
      forbidden: [
        "Login to private GameChanger accounts",
        "Unofficial GameChanger API or stolen cookies",
        "Invent stats or pool boxes the public page does not show",
        "Approve own staging",
        "Delete approved rows",
        "Unlock locked rosters",
        "Edit rules text",
        "Change metric formulas",
      ],
    },
    live_events: live,
    watch: watch,
    queued_pdfs: "GET /api/bot/event-boxes still lists queued GC PDFs and public box URLs for OCR / typed lines.",
  };
}

module.exports = {
  LIVE_POLL_SECONDS: LIVE_POLL_SECONDS,
  IDLE_POLL_SECONDS: IDLE_POLL_SECONDS,
  listGcMonitor: listGcMonitor,
};
