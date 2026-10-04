// Every email the site sends, written once as a template with {{{VARIABLES}}} in it.
//
// - In production the templates live in Resend (`npm run emails:sync` uploads them once), where the wording can be
//   edited in Resend's dashboard. The app then sends only the template's alias and the variables (lib/notify.js).
// - Everywhere else (local development, tests, the Admin page preview, or if Resend rejects a send) the app fills
//   in the same templates itself with buildEmail().
//
// Each template is { subject, html, text }. Email apps ignore stylesheets, so the HTML is one table with inline
// styles, and the plain-text twin carries the same words for apps that show text only. Resend templates can only
// substitute variables (no if/else), so optional parts such as the confirm button arrive as ready-made snippets.
//
// Admins can also add their own text to each email (`note`) and to the bottom of every email (`footer`) from the
// Admin page. That text is plain text: it's escaped, links are made clickable, and {username} is filled in.

import { escape } from "./html.js";
import { EMAILS, SITE_NAME } from "./pages.js";
import { FINISH_LABELS } from "./validation.js";

/** Every email, in the order the Admin page lists them. `alias` is the template's name in Resend. */
export const EMAIL_KINDS = [
  { key: "welcome", label: "Welcome", when: "Sent when someone creates an account. Email sign-ups also get the confirm-your-email button." },
  { key: "verify", label: "Confirm email address", when: "Sent when a player asks for a new confirmation link or changes their email address." },
  { key: "reset", label: "Password reset", when: "Sent when a player uses \"Forgot password\"." },
  { key: "password_changed", label: "Password changed", when: "Sent after a player changes or resets their password, in case it wasn't them." },
  { key: "email_changed", label: "Email address changed", when: "Sent to the old address when a player changes their email, in case it wasn't them." },
  { key: "account_deleted", label: "Account deleted", when: "Sent when a player deletes their account." },
  { key: "moderator", label: "Promoted to moderator", when: "Sent when an admin makes a player a moderator." },
  { key: "trade_request", label: "New trade request", when: "Sent to the player who receives a trade request (if trade emails are on)." },
  { key: "trade_counter", label: "Counter-offer", when: "Sent to the player who receives a counter-offer (if trade emails are on)." },
  { key: "trade_accepted", label: "Trade accepted", when: "Sent to the player whose request was accepted (if trade emails are on)." },
  { key: "trade_declined", label: "Trade declined", when: "Sent to the player whose request was declined (if trade emails are on)." },
  { key: "listing_removed", label: "Listing removed", when: "Sent when a moderator removes one of a player's listings." },
  { key: "account_suspended", label: "Account suspended", when: "Sent when a moderator suspends a player's account." },
  { key: "account_reinstated", label: "Account reinstated", when: "Sent when a moderator lifts a suspension." },
  { key: "report_received", label: "Report received", when: "Sent to a player after they report a listing or another player." },
  { key: "footer", label: "Footer on every email", when: "Added to the bottom of every email above, e.g. a partner store shout-out." },
].map((k) => ({ ...k, alias: k.key === "footer" ? null : `ttt-${k.key.replace(/_/g, "-")}` }));
export const EMAIL_KEYS = EMAIL_KINDS.map((k) => k.key);
export const NOTE_MAX = 1000;

// Brand colours from the site's light theme.
const C = { page: "#eaf0ed", card: "#f9fbfa", line: "#c3d1cb", ink: "#12302a", soft: "#48605a", teal: "#006b61", tint: "#e3efeb" };
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

// ---- admin-written text (notes and footer) ----

/** Fills {username} in admin-written text. */
export const fill = (text, vars = {}) => String(text ?? "").replace(/\{username\}/g, vars.username || "there");

// Links in admin-written text: https addresses and email addresses (matched first, then escaped).
const LINK = /(https:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;
const linkify = (s) =>
  s
    .split(LINK)
    .map((part, i) => (i % 2 ? `<a href="${part.startsWith("https://") ? "" : "mailto:"}${escape(part)}" style="color:${C.teal}">${escape(part)}</a>` : escape(part)))
    .join("");

/** Admin-written plain text as email HTML: escaped, paragraphs on blank lines, clickable https and email links. */
export const noteHtml = (text, vars) =>
  fill(text, vars)
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 12px">${linkify(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");

// ---- building blocks for the templates ----

const button = (label, url) =>
  `<p style="margin:0 0 20px;text-align:center"><a href="${url}" style="display:inline-block;background:${C.teal};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:10px">${label}</a></p>`;
const para = (html, small = false) => `<p style="margin:0 0 16px${small ? `;font-size:13px;color:${C.soft}` : ""}">${html}</p>`;
const textLink = (url, label = url) => `<a href="${url}" style="color:${C.teal}">${label}</a>`;
/** The "button not working?" line under a button, with the address written out. */
const pasteLink = (url, before = "") =>
  para(`${before}Button not working? Paste this link into your browser:<br><a href="${url}" style="color:${C.teal};word-break:break-all">${url}</a>`, true);

/**
 * The shared frame around every email: logo, heading, body, the admin's note, then the footer (with the admin's
 * footer text, and why the reader gets trade emails). Written with variables, like the bodies.
 */
const frame = (heading, preheader, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:24px 12px;background:${C.page};font-family:${FONT};color:${C.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:${C.card};border-radius:14px;border:1px solid ${C.line}">
<tr><td style="padding:28px 28px 8px;text-align:center"><img src="{{{SITE}}}/brand/email-logo.png" width="200" height="48" alt="${SITE_NAME}" style="display:inline-block;border:0"></td></tr>
<tr><td style="padding:8px 28px 4px;font-size:16px;line-height:1.55">
<h1 style="margin:12px 0 12px;font-size:22px;line-height:1.3">${heading}</h1>
${body}
</td></tr>
{{{NOTE_HTML}}}
<tr><td style="padding:20px 28px 28px;font-size:12px;line-height:1.5;color:${C.soft};border-top:1px solid ${C.line}">{{{FOOTER_HTML}}}{{{REASON_HTML}}}${SITE_NAME} · Local Magic: The Gathering trading in Canada<br>Questions? Reply to this email or write to <a href="mailto:${EMAILS.support}" style="color:${C.teal}">${EMAILS.support}</a>.</td></tr>
</table></body></html>`;

/** The plain-text twin: the same words, links written out, then the same footer. */
const plain = (lines) =>
  `${lines.join("\n")}{{{NOTE_TEXT}}}\n\n--\n{{{FOOTER_TEXT}}}{{{REASON_TEXT}}}${SITE_NAME} · Local Magic: The Gathering trading in Canada\nQuestions? Reply to this email or write to ${EMAILS.support}.`;

/** One template: subject line, the HTML version (heading, hidden preview text, body) and the text version. */
const template = ({ subject, heading, preheader, body, lines }) => ({ subject, html: frame(heading, preheader, body), text: plain(lines) });

// ---- the emails ----

const STEPS = [
  ["List your cards", "add the exact printings you own, or import a Moxfield or Archidekt collection.", "inventory"],
  ["Search nearby", "find who has the card you need, on a list or a map, nearest first.", "search"],
  ["Meet somewhere public", "agree on a trade and meet at a partner game store or another public place.", "stores"],
];
const INTRO = `${SITE_NAME} helps you trade Magic: The Gathering cards with players near you, in person, with no fees or shipping.`;
const NOT_YOU = `If this wasn't you, reset your password straight away and write to ${EMAILS.support}.`;

/** Card lines and the message are the same in every trade email; only the wording around them changes. */
// The intro names the other player's city, which can contain an apostrophe ("St. John's"), so the HTML version
// gets the escaped city and the text version the plain one.
function tradeTemplate({ subject, heading, intro, next, cta }) {
  const html = intro.replace("{{{FROM_CITY}}}", "{{{FROM_CITY_HTML}}}");
  const text = intro.replace("{{{FROM_CITY}}}", "{{{FROM_CITY_TEXT}}}");
  return template({
    subject,
    heading,
    preheader: html,
    body: para(html) + "{{{CARDS_HTML}}}{{{MESSAGE_HTML}}}{{{MEETUP_HTML}}}" + para(next) + button(cta, "{{{SITE}}}/trades/{{{TRADE_ID}}}"),
    lines: [text + "{{{CARDS_TEXT}}}{{{MESSAGE_TEXT}}}{{{MEETUP_TEXT}}}", "", next, "{{{SITE}}}/trades/{{{TRADE_ID}}}"],
  });
}

/** The templates, keyed like EMAIL_KINDS. */
export const TEMPLATES = {
  welcome: template({
    subject: `Welcome to ${SITE_NAME}, {{{USERNAME}}}`,
    heading: `Welcome to ${SITE_NAME}`,
    preheader: "{{{PREHEADER}}}",
    body:
      para(`Thanks for joining, {{{USERNAME}}}! ${INTRO}`) +
      "{{{CONFIRM_HTML}}}" +
      `<p style="margin:8px 0 8px;font-weight:600">Getting started</p>` +
      STEPS.map(([title, text, page]) => para(`<a href="{{{SITE}}}/${page}" style="color:${C.teal};font-weight:600">${title}</a>: ${text}`)).join(""),
    lines: [`Thanks for joining, {{{USERNAME}}}! ${INTRO}{{{CONFIRM_TEXT}}}`, "", "Getting started:", ...STEPS.map(([title, text, page]) => `- ${title}: ${text} {{{SITE}}}/${page}`)],
  }),
  verify: template({
    subject: `Confirm your email for ${SITE_NAME}`,
    heading: "Confirm your email",
    preheader: "One click to confirm your email address.",
    body:
      para(`Hi {{{USERNAME}}}, please confirm that this is the email address for your ${SITE_NAME} account.`) +
      button("Confirm my email", "{{{LINK}}}") +
      pasteLink("{{{LINK}}}", "The button works for {{{HOURS}}} hours. ") +
      para("If you didn't ask for this, you can ignore this email.", true),
    lines: [`Hi {{{USERNAME}}}, please confirm that this is the email address for your ${SITE_NAME} account.`, "", "Use this link within {{{HOURS}}} hours:", "{{{LINK}}}", "", "If you didn't ask for this, you can ignore this email."],
  }),
  reset: template({
    subject: `Reset your ${SITE_NAME} password`,
    heading: "Reset your password",
    preheader: "Choose a new password.",
    body:
      para(`Someone asked to reset your ${SITE_NAME} password. The button works for {{{MINUTES}}} minutes.`) +
      button("Choose a new password", "{{{LINK}}}") +
      pasteLink("{{{LINK}}}") +
      para("If this wasn't you, ignore this email; your password is unchanged.", true),
    lines: [`Someone asked to reset your ${SITE_NAME} password.`, "", "Use this link within {{{MINUTES}}} minutes:", "{{{LINK}}}", "", "If this wasn't you, ignore this email; your password is unchanged."],
  }),
  password_changed: template({
    subject: `Your ${SITE_NAME} password was changed`,
    heading: "Your password was changed",
    preheader: "If this was you, there's nothing to do.",
    body:
      para(`Hi {{{USERNAME}}}, the password for your ${SITE_NAME} account was just changed, and other devices were signed out. If this was you, there's nothing to do.`) +
      para(NOT_YOU) +
      button("Reset my password", "{{{SITE}}}/forgot-password"),
    lines: [`Hi {{{USERNAME}}}, the password for your ${SITE_NAME} account was just changed, and other devices were signed out. If this was you, there's nothing to do.`, "", NOT_YOU, "{{{SITE}}}/forgot-password"],
  }),
  email_changed: template({
    subject: `Your ${SITE_NAME} email address was changed`,
    heading: "Your email address was changed",
    preheader: "Account emails now go to your new address.",
    body:
      para(`Hi {{{USERNAME}}}, the email address for your ${SITE_NAME} account was changed to {{{NEW_EMAIL_HTML}}}. From now on, account emails go there instead of this address.`) +
      para(`If this wasn't you, write to <a href="mailto:${EMAILS.support}" style="color:${C.teal}">${EMAILS.support}</a> straight away so we can secure your account.`),
    lines: [`Hi {{{USERNAME}}}, the email address for your ${SITE_NAME} account was changed to {{{NEW_EMAIL_TEXT}}}. From now on, account emails go there instead of this address.`, "", `If this wasn't you, write to ${EMAILS.support} straight away so we can secure your account.`],
  }),
  account_deleted: template({
    subject: `Your ${SITE_NAME} account was deleted`,
    heading: "Your account was deleted",
    preheader: "Sorry to see you go.",
    body:
      para(`Hi {{{USERNAME}}}, your ${SITE_NAME} account has been deleted. Your listings, want list and sign-in links are gone, and any pending proposals were declined.`) +
      para("Past trades keep a copy of their cards for the other player's records, without your details. Moderation records are kept for accountability.") +
      para(`If you didn't do this, write to <a href="mailto:${EMAILS.support}" style="color:${C.teal}">${EMAILS.support}</a>. You're welcome back any time.`, true),
    lines: [
      `Hi {{{USERNAME}}}, your ${SITE_NAME} account has been deleted. Your listings, want list and sign-in links are gone, and any pending proposals were declined.`,
      "",
      "Past trades keep a copy of their cards for the other player's records, without your details. Moderation records are kept for accountability.",
      "",
      `If you didn't do this, write to ${EMAILS.support}. You're welcome back any time.`,
    ],
  }),
  moderator: template({
    subject: `You're now a ${SITE_NAME} moderator`,
    heading: "You're a moderator now",
    preheader: "Here's what moderators do.",
    body:
      para(`Hi {{{USERNAME}}}, an administrator has made you a moderator on ${SITE_NAME}. Thank you for helping keep trading safe and friendly.`) +
      para("Moderators review reports from players, remove listings that break the rules, suspend accounts when needed, and read players' suggestions. Each action asks for a reason and is kept in the moderation log.") +
      button("Open the moderation queue", "{{{SITE}}}/moderation") +
      para(`Please read the ${textLink("{{{SITE}}}/terms", "trading rules")} so your decisions match them, and never share players' details outside the site.`, true),
    lines: [
      `Hi {{{USERNAME}}}, an administrator has made you a moderator on ${SITE_NAME}. Thank you for helping keep trading safe and friendly.`,
      "",
      "Moderators review reports from players, remove listings that break the rules, suspend accounts when needed, and read players' suggestions. Each action asks for a reason and is kept in the moderation log.",
      "",
      "Moderation queue: {{{SITE}}}/moderation",
      "Trading rules: {{{SITE}}}/terms",
    ],
  }),
  trade_request: tradeTemplate({
    subject: "{{{FROM}}} sent you a trade request",
    heading: "New trade request",
    intro: "{{{FROM}}} ({{{FROM_CITY}}}) would like to trade with you.",
    next: "Accept it, decline it, or send a counter-offer from your Trades page.",
    cta: "Review the request",
  }),
  trade_counter: tradeTemplate({
    subject: "{{{FROM}}} sent you a counter-offer",
    heading: "Counter-offer",
    intro: "{{{FROM}}} ({{{FROM_CITY}}}) changed the trade and sent it back to you.",
    next: "Accept it, decline it, or send a counter-offer from your Trades page.",
    cta: "Review the counter-offer",
  }),
  trade_accepted: tradeTemplate({
    subject: "{{{FROM}}} accepted your trade request",
    heading: "Trade accepted",
    intro: "{{{FROM}}} ({{{FROM_CITY}}}) accepted your proposal. That means you've both agreed to meet; nothing has changed hands yet.",
    next: "Agree on a time to meet{{{MEET_PLACE}}}. Check the cards before you swap, then update your inventory.",
    cta: "View the trade",
  }),
  trade_declined: tradeTemplate({
    subject: "{{{FROM}}} declined your trade request",
    heading: "Trade declined",
    intro: "{{{FROM}}} ({{{FROM_CITY}}}) declined your proposal.",
    next: "You can send them a new request with different cards, or look for these cards near you.",
    cta: "View the proposal",
  }),
  listing_removed: template({
    subject: `A moderator removed one of your ${SITE_NAME} listings`,
    heading: "A listing was removed",
    preheader: "It didn't follow the trading rules.",
    body:
      para("Hi {{{USERNAME}}}, a moderator removed your listing for {{{CARD_HTML}}} because it didn't follow the trading rules. Past proposals that include it keep their copy.") +
      para(`Please check the ${textLink("{{{SITE}}}/terms", "trading rules")} before listing it again. If you think this was a mistake, reply to this email within 30 days.`),
    lines: [
      "Hi {{{USERNAME}}}, a moderator removed your listing for {{{CARD_TEXT}}} because it didn't follow the trading rules. Past proposals that include it keep their copy.",
      "",
      "Please check the trading rules before listing it again: {{{SITE}}}/terms",
      "If you think this was a mistake, reply to this email within 30 days.",
    ],
  }),
  account_suspended: template({
    subject: `Your ${SITE_NAME} account was suspended`,
    heading: "Your account was suspended",
    preheader: "You can't sign in while it's suspended.",
    body:
      para(`Hi {{{USERNAME}}}, a moderator has suspended your ${SITE_NAME} account for breaking the ${textLink("{{{SITE}}}/terms", "trading rules")}. You can't sign in or trade while it's suspended.`) +
      para(`If you think this was a mistake, write to <a href="mailto:${EMAILS.support}" style="color:${C.teal}">${EMAILS.support}</a> within 30 days and tell us what happened. We'll look at it again.`),
    lines: [
      `Hi {{{USERNAME}}}, a moderator has suspended your ${SITE_NAME} account for breaking the trading rules ({{{SITE}}}/terms). You can't sign in or trade while it's suspended.`,
      "",
      `If you think this was a mistake, write to ${EMAILS.support} within 30 days and tell us what happened. We'll look at it again.`,
    ],
  }),
  account_reinstated: template({
    subject: `Your ${SITE_NAME} account is active again`,
    heading: "Your account is active again",
    preheader: "You can sign in and trade again.",
    body: para(`Hi {{{USERNAME}}}, a moderator has lifted the suspension on your ${SITE_NAME} account. You can sign in and trade again.`) + button("Log in", "{{{SITE}}}/login"),
    lines: [`Hi {{{USERNAME}}}, a moderator has lifted the suspension on your ${SITE_NAME} account. You can sign in and trade again.`, "", "{{{SITE}}}/login"],
  }),
  report_received: template({
    subject: `Thanks for your report`,
    heading: "Thanks for your report",
    preheader: "A moderator will look at it.",
    body:
      para("Hi {{{USERNAME}}}, thanks for reporting {{{REPORTED_HTML}}}. A moderator will look at it soon. We never tell the other player who reported them.") +
      para("You don't need to do anything else. If it's urgent or about your safety, contact local authorities first.", true),
    lines: [
      "Hi {{{USERNAME}}}, thanks for reporting {{{REPORTED_TEXT}}}. A moderator will look at it soon. We never tell the other player who reported them.",
      "",
      "You don't need to do anything else. If it's urgent or about your safety, contact local authorities first.",
    ],
  }),
};

/** The variable names a template uses, e.g. ["SITE", "USERNAME", ...] (Resend needs the list). */
export const templateVariables = (kind) => [...new Set(Object.values(TEMPLATES[kind]).join("").match(/\{\{\{(\w+)\}\}\}/g).map((v) => v.slice(3, -3)))];

// ---- turning data into variable values ----

const cardLine = (l) => {
  const finish = l.finish && l.finish !== "nonfoil" ? `, ${FINISH_LABELS[l.finish] ?? l.finish}` : "";
  return `${l.quantity} × ${l.cardName} (${String(l.setCode).toUpperCase()} #${l.collectorNumber}, ${l.condition}${finish})`;
};
const cardListHtml = (title, lines) =>
  lines?.length
    ? `<p style="margin:0 0 6px;font-weight:600">${escape(title)}</p><ul style="margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li>${escape(cardLine(l))}</li>`).join("")}</ul>`
    : "";
const cardListText = (title, lines) => (lines?.length ? `\n\n${[`${title}:`, ...lines.map((l) => `- ${cardLine(l)}`)].join("\n")}` : "");

// The headings over the two card lists, from the reader's side.
const TRADE_TITLES = {
  trade_request: ["They'd like from you", "They're offering"],
  trade_counter: ["They'd like from you", "They're offering"],
  trade_accepted: ["You'll receive", "You'll give"],
  trade_declined: ["You asked for", "You offered"],
};

function tradeVariables(kind, d) {
  // Request and counter go to the receiver, so "requested" lines are their cards. Accepted and declined go to the
  // original sender, so "requested" lines are what they asked for. Either way: requested first, offered second.
  const [mine, theirs] = TRADE_TITLES[kind];
  const spot = d.meetupSpot ? `${d.meetupSpot.name}, ${d.meetupSpot.address}, ${d.meetupSpot.city}` : null;
  return {
    FROM: escape(d.from),
    FROM_CITY_HTML: escape(d.fromCity),
    FROM_CITY_TEXT: d.fromCity,
    TRADE_ID: String(d.tradeId),
    CARDS_HTML: cardListHtml(mine, d.requested) + cardListHtml(theirs, d.offered),
    CARDS_TEXT: cardListText(mine, d.requested) + cardListText(theirs, d.offered),
    MESSAGE_HTML: d.message ? `<p style="margin:0 0 16px;padding:12px 14px;background:${C.tint};border-radius:10px">“${escape(d.message)}”</p>` : "",
    MESSAGE_TEXT: d.message ? `\n\nMessage: "${d.message}"` : "",
    MEETUP_HTML: spot ? para(`<strong>Suggested meetup spot:</strong> ${escape(spot)}`) : "",
    MEETUP_TEXT: spot ? `\n\nSuggested meetup spot: ${spot}` : "",
    MEET_PLACE: spot ? "" : " at a public place, like a game store or library",
  };
}

const TRADE_REASON = (site) => ({
  html: `<div style="margin:0 0 10px">You're getting this because trade emails are on for your account. <a href="${escape(site)}/settings" style="color:${C.teal}">Turn them off in Settings</a>.</div>`,
  text: `You're getting this because trade emails are on for your account. Turn them off in Settings: ${site}/settings\n\n`,
});

/**
 * The variable values for email `kind`, from `data` (always { site, username, ... } plus what that email needs)
 * and the admin's `note` and `footer` text. Values that go into HTML are already escaped.
 * Usernames only ever contain letters, numbers and underscores, so one USERNAME works for HTML and text.
 */
export function emailVariables(kind, { note, footer, ...data }) {
  if (!TEMPLATES[kind]) throw new Error(`Unknown email: ${kind}`);
  const vars = { username: data.username };
  const reason = kind.startsWith("trade_") ? TRADE_REASON(data.site) : null;
  const common = {
    SITE: escape(data.site),
    USERNAME: escape(data.username ?? ""),
    NOTE_HTML: note?.trim() ? `<tr><td style="padding:4px 28px 8px;font-size:15px;line-height:1.55">${noteHtml(note, vars)}</td></tr>` : "",
    NOTE_TEXT: note?.trim() ? `\n\n${fill(note, vars).trim()}` : "",
    FOOTER_HTML: footer?.trim() ? `<div style="margin:0 0 10px">${noteHtml(footer, vars).replaceAll("margin:0 0 12px", "margin:0 0 8px")}</div>` : "",
    FOOTER_TEXT: footer?.trim() ? `${fill(footer, vars).trim()}\n\n` : "",
    REASON_HTML: reason?.html ?? "",
    REASON_TEXT: reason?.text ?? "",
  };
  // The welcome email's confirm button: email sign-ups get one, Google sign-ups (already confirmed, no link) don't.
  const welcome = () =>
    data.link
      ? {
          PREHEADER: "Confirm your email to start trading.",
          CONFIRM_HTML:
            para("First, please confirm this is your email address. You'll need to before you can send trade requests.") +
            button("Confirm my email", escape(data.link)) +
            pasteLink(escape(data.link), `The button works for ${data.hours} hours. `),
          CONFIRM_TEXT: `\n\nFirst, please confirm this is your email address (the link works for ${data.hours} hours):\n${data.link}`,
        }
      : { PREHEADER: "Here's how to make your first trade.", CONFIRM_HTML: "", CONFIRM_TEXT: "" };
  // Each email's own values, worked out only for that email.
  const extra = {
    welcome,
    verify: () => ({ LINK: escape(data.link), HOURS: String(data.hours) }),
    reset: () => ({ LINK: escape(data.link), MINUTES: String(data.minutes) }),
    email_changed: () => ({ NEW_EMAIL_HTML: escape(data.newEmail), NEW_EMAIL_TEXT: data.newEmail }),
    listing_removed: () => ({ CARD_HTML: escape(data.card), CARD_TEXT: data.card }),
    report_received: () => ({ REPORTED_HTML: escape(data.reported), REPORTED_TEXT: data.reported }),
  }[kind];
  return { ...common, ...(kind.startsWith("trade_") ? tradeVariables(kind, data) : extra?.() ?? {}) };
}

/** Puts variable values into a template string. Unknown variables become empty. */
export const render = (template, vars) => template.replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => vars[key] ?? "");

/** Builds email `kind` here in the app (see the top of the file). Returns { subject, text, html }. */
export function buildEmail(kind, data) {
  const vars = emailVariables(kind, data);
  const t = TEMPLATES[kind];
  return { subject: render(t.subject, vars), text: render(t.text, vars), html: render(t.html, vars) };
}

// ---- made-up data for the Admin page preview and "Send me a test" ----

const SAMPLE_LINES = {
  requested: [{ quantity: 1, cardName: "Sol Ring", setCode: "c21", collectorNumber: "263", condition: "NM", finish: "nonfoil" }],
  offered: [
    { quantity: 2, cardName: "Lightning Bolt", setCode: "m10", collectorNumber: "146", condition: "LP", finish: "foil" },
    { quantity: 1, cardName: "Counterspell", setCode: "mh2", collectorNumber: "267", condition: "NM", finish: "nonfoil" },
  ],
};
export function sampleData(kind, site, username) {
  const link = `${site}/verify-email?token=sample`;
  const trades = { from: "bolt_burlington", fromCity: "Burlington, ON", tradeId: 1, message: "Happy to meet at the store on Friday.", meetupSpot: null, ...SAMPLE_LINES };
  const base = { site, username };
  return {
    welcome: { ...base, link, hours: 72 },
    verify: { ...base, link, hours: 72 },
    reset: { ...base, link: `${site}/reset-password?token=sample`, minutes: 60 },
    email_changed: { ...base, newEmail: "new-address@example.com" },
    trade_request: { ...base, ...trades },
    trade_counter: { ...base, ...trades },
    trade_accepted: { ...base, ...trades, message: null },
    trade_declined: { ...base, ...trades, message: null },
    listing_removed: { ...base, card: "Lightning Bolt (M10 #146, LP, Foil)" },
    report_received: { ...base, reported: "a listing by bolt_burlington" },
    footer: { ...base, link, hours: 72 }, // previewed on the welcome email
  }[kind] ?? base;
}
/** Which email shows a key's text in the preview ('footer' shows on the welcome email). */
export const previewKind = (key) => (key === "footer" ? "welcome" : key);
