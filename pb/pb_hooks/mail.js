function publicBase() {
  const env = (typeof $os !== "undefined" && $os.getenv) ? $os.getenv("PUBLIC_URL") : "";
  return String(env || "https://www.diamondtourney.com").replace(/\/+$/, "");
}

function publicUrl(path) {
  return publicBase() + (path.charAt(0) === "/" ? path : "/" + path);
}

function senderConfigured(app) {
  return !!sender(app);
}

function sender(app) {
  try {
    const settings = app.settings();
    const smtp = settings.smtp;
    if (!smtp || !smtp.enabled) return null;
    const meta = settings.meta;
    const address = meta.senderAddress || meta.sender_address || "";
    const name = meta.senderName || meta.sender_name || "Diamond Tourney";
    if (!address) return null;
    return { address: address, name: name };
  } catch (err) {
    return null;
  }
}

function redactedAddr(addr) {
  const text = String(addr || "");
  const at = text.indexOf("@");
  if (at < 1) return "(recipient)";
  return text.charAt(0) + "…@" + text.slice(at + 1);
}

function logMail(app, eventId, kind, ok, detail) {
  try {
    require(__hooks + "/host.js").writeLog(app, eventId || "", kind || "mail", !!ok, String(detail || "").slice(0, 2000));
  } catch (err) {}
}

function sendMail(app, to, subject, html, kind, eventId) {
  const from = sender(app);
  const addr = String(to || "").trim();
  if (!addr || addr.indexOf("@") === -1) {
    logMail(app, eventId, kind, false, "no_recipient");
    return { sent: false, reason: "no_recipient" };
  }
  if (!from) {
    logMail(app, eventId, kind, false, "smtp_not_configured → " + redactedAddr(addr));
    return { sent: false, reason: "smtp_not_configured" };
  }
  try {
    app.newMailClient().send(new MailerMessage({
      from: from,
      to: [{ address: addr }],
      subject: subject,
      html: html,
    }));
    logMail(app, eventId, kind, true, subject + " → " + redactedAddr(addr));
    return { sent: true };
  } catch (err) {
    const raw = String(err);
    const reason = /sendmail|smtp|dial tcp|no such host/i.test(raw) ? "smtp_not_configured" : raw;
    logMail(app, eventId, kind, false, reason + (reason === "smtp_not_configured" ? " → " + redactedAddr(addr) : ""));
    return { sent: false, reason: reason };
  }
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}

function eventDates(event) {
  const start = String(event.get("start") || "").slice(0, 10);
  const end = String(event.get("end") || "").slice(0, 10);
  if (start && end && start !== end) return start + " – " + end;
  return start || end || "";
}

function packetOwed(event) {
  const host = require(__hooks + "/host.js");
  const kinds = host.requiredDocKinds(event);
  if (!kinds.length) return "The director did not require a team packet.";
  return "Upload before first pitch: " + host.requiredDocKinds(event).map(function (k) {
    return host.DOC_LABELS[k] || k;
  }).join(", ") + ".";
}

function signupConfirmation(app, event, team, contact) {
  const email = (contact && (contact.coach_email || contact.get && contact.get("coach_email")))
    || team.get("contact_email")
    || "";
  const name = team.get("name") || "your team";
  const slug = event.get("slug");
  const html = "<p>You're on the list for <b>" + escapeHtml(event.get("name")) + "</b>.</p>"
    + "<p>" + escapeHtml(eventDates(event)) + (event.get("venue") ? " · " + escapeHtml(event.get("venue")) : "") + "</p>"
    + "<p>" + escapeHtml(packetOwed(event)) + "</p>"
    + "<p><a href=\"" + publicUrl("/t/" + slug) + "\">Public board</a></p>";
  return sendMail(app, email, "You're signed up — " + event.get("name"), html, "signup_mail", event.id);
}

function directorVerify(app, user, token) {
  const html = "<p>Confirm this email to open tournaments on Diamond Tourney.</p>"
    + "<p><a href=\"" + publicUrl("/verify?token=" + encodeURIComponent(token)) + "\">Verify my email</a></p>";
  return sendMail(app, user.email(), "Confirm your Diamond Tourney email", html, "verify_mail", "");
}

function passwordReset(app, email, token) {
  const html = "<p>Reset the password for this Diamond Tourney login.</p>"
    + "<p><a href=\"" + publicUrl("/reset?token=" + encodeURIComponent(token)) + "\">Choose a new password</a></p>"
    + "<p>If you did not ask for this, you can ignore the email.</p>";
  return sendMail(app, email, "Reset your Diamond Tourney password", html, "reset_mail", "");
}

function directorWelcome(app, user) {
  const html = "<p>Your director email is confirmed.</p>"
    + "<p><a href=\"" + publicUrl("/directors/new") + "\">Open a tournament</a></p>";
  return sendMail(app, user.email(), "Welcome — you can open a weekend", html, "welcome_mail", "");
}

function rainNotice(app, event) {
  const teams = app.findRecordsByFilter("event_teams", "event = {:e}", "name", 500, 0, { e: event.id });
  const status = event.get("rain_status") || "watch";
  const note = event.get("rain_note") || event.get("status_note") || "";
  const subject = event.get("name") + " — schedule update";
  const html = "<p><b>" + escapeHtml(event.get("name")) + "</b> posted a schedule update.</p>"
    + "<p>Status: " + escapeHtml(status) + "</p>"
    + (note ? "<p>" + escapeHtml(note) + "</p>" : "")
    + "<p><a href=\"" + publicUrl("/t/" + event.get("slug")) + "\">Open the public board</a></p>";
  let sent = 0;
  let attempted = 0;
  let lastReason = "";
  const seen = {};
  const contacts = require(__hooks + "/contacts.js");
  for (let i = 0; i < teams.length; i++) {
    const emails = contacts.contactEmails(app, teams[i]);
    for (let j = 0; j < emails.length; j++) {
      const email = emails[j];
      if (!email || seen[email]) continue;
      seen[email] = true;
      attempted++;
      const out = sendMail(app, email, subject, html, "rain_mail", event.id);
      if (out.sent) sent++;
      else lastReason = out.reason || lastReason;
    }
  }
  if (!sent) {
    logMail(app, event.id, "rain_mail", false, "sent 0 of " + attempted + (lastReason ? " · " + lastReason : ""));
  }
  return { sent: sent, attempted: attempted, reason: sent ? "" : lastReason };
}

function randomToken(size) {
  const n = size || 48;
  if (typeof $security !== "undefined" && $security.randomString) {
    return $security.randomString(n);
  }
  throw new Error("secure random is unavailable");
}

module.exports = {
  publicUrl: publicUrl,
  sendMail: sendMail,
  logMail: logMail,
  signupConfirmation: signupConfirmation,
  directorVerify: directorVerify,
  passwordReset: passwordReset,
  directorWelcome: directorWelcome,
  rainNotice: rainNotice,
  randomToken: randomToken,
  senderConfigured: senderConfigured,
};
