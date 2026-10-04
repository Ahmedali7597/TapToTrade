import { query } from "../db.js";
import { buildEmail, EMAIL_KINDS, emailVariables } from "../../shared/emails.js";
import { sendEmail } from "./email.js";
import { siteUrl } from "./seo.js";
import { newToken, sha256 } from "./security.js";

// Sends the site's emails (built in shared/emails.js) with the text admins added on the Admin page.
// Emails that shouldn't hold up a page (welcome, trade updates, the moderator note) are sent in the background.

/** How long a "confirm your email" link works. */
export const VERIFY_HOURS = 72;

/** Admin-written text, keyed like EMAIL_KEYS ('footer' goes on every email). */
export async function emailTexts() {
  const { rows } = await query("SELECT key, body FROM email_texts");
  return Object.fromEntries(rows.map((r) => [r.key, r.body]));
}

// With EMAIL_TEMPLATES=resend (set in Render once `npm run emails:sync` has created the templates), emails are sent as
// Resend templates, so wording edited in Resend's dashboard is what players get. Otherwise the app fills in its own
// copy of the same templates.
const useResendTemplates = () => process.env.EMAIL_TEMPLATES === "resend" && Boolean(process.env.EMAIL_API_KEY);
const ALIASES = Object.fromEntries(EMAIL_KINDS.map((k) => [k.key, k.alias]));

/** Sends email `kind` to `to`, with the admin's extra text. Resolves to true if the provider accepted it. */
export async function sendTemplate(kind, to, data) {
  const texts = await emailTexts();
  const full = { ...data, site: siteUrl(), note: texts[kind], footer: texts.footer };
  if (useResendTemplates()) {
    const sent = await sendEmail({ to, template: { id: ALIASES[kind], variables: emailVariables(kind, full) } });
    if (sent) return true;
    // A missing template or a value too long for Resend (2,000 characters) mustn't lose the email: send our own copy.
    console.warn(`Resend template ${ALIASES[kind]} wasn't accepted; sent the built-in copy instead.`);
  }
  return sendEmail({ to, ...buildEmail(kind, full) });
}

// Background sends: failures are logged (without the address), never thrown at the player.
const pending = new Set();
export function background(task) {
  const p = Promise.resolve()
    .then(task)
    .catch((err) => console.error(`Background email failed: ${err.message}`))
    .finally(() => pending.delete(p));
  pending.add(p);
}
/** Resolves once every background email so far has finished (used by the tests). */
export const settle = () => Promise.allSettled([...pending]);

/** A new single-use confirm link for the user's current address. Older unused links stop working. */
export async function verificationLink(user) {
  const token = newToken();
  await query("DELETE FROM email_verifications WHERE user_id = $1 AND used_at IS NULL", [user.id]);
  await query(
    "INSERT INTO email_verifications (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => $4))",
    [user.id, user.email, sha256(token), VERIFY_HOURS],
  );
  return `${siteUrl()}/verify-email?token=${token}`;
}

/** Welcome email after sign-up. Email sign-ups get a confirm button; Google already confirmed the address. */
export function welcome(user, { confirm = true } = {}) {
  background(async () => {
    const link = confirm ? await verificationLink(user) : null;
    await sendTemplate("welcome", user.email, { username: user.username, link, hours: VERIFY_HOURS });
  });
}

/**
 * The player's email and name, if they may be emailed: only confirmed addresses get notifications, so a typo
 * never emails a stranger. `trades` also requires their trade emails to be on; `suspended` allows a suspended
 * account (for the suspension notice itself).
 */
const reachable = async (id, { trades = false, suspended = false } = {}) =>
  (
    await query(
      `SELECT id, email, username FROM users
        WHERE id = $1 AND (status = 'active' OR ($3 AND status = 'suspended')) AND email_verified_at IS NOT NULL AND (NOT $2 OR email_trades)`,
      [id, trades, suspended],
    )
  ).rows[0];

/**
 * An account notice to one player (password changed, listing removed, suspended...), in the background.
 * These always go out when the address is confirmed, whatever the trade-email setting, because they're about
 * the account's safety or a moderator's decision.
 */
export function notice(kind, userId, data = {}, { suspended = false } = {}) {
  background(async () => {
    const user = await reachable(userId, { suspended });
    if (user) await sendTemplate(kind, user.email, { username: user.username, ...data });
  });
}

/** Tells a newly promoted moderator. Resolves to whether an email was queued (false if their email isn't confirmed). */
export async function promoted(userId) {
  const user = await reachable(userId);
  if (user) background(() => sendTemplate("moderator", user.email, { username: user.username }));
  return Boolean(user);
}

const line = (l) => ({ quantity: l.quantity, cardName: l.card_name, setCode: l.set_code, collectorNumber: l.collector_number, condition: l.condition, finish: l.finish });

/**
 * Emails the other player about trade version `tradeId`: a new request or counter-offer goes to its receiver,
 * an acceptance or a decline to its sender. Skipped when that player turned trade emails off.
 */
export function tradeUpdate(kind, tradeId) {
  background(async () => {
    const { rows } = await query(
      `SELECT t.id, t.message, t.sender_id, t.receiver_id, s.username AS s_name, s.city AS s_city, r.username AS r_name, r.city AS r_city,
              st.name AS store_name, st.address AS store_address, st.city AS store_city
         FROM trade_requests t JOIN users s ON s.id = t.sender_id JOIN users r ON r.id = t.receiver_id
         LEFT JOIN stores st ON st.id = t.meetup_store_id WHERE t.id = $1`,
      [tradeId],
    );
    const t = rows[0];
    if (!t) return;
    // Accepted and declined are answers, so they go back to whoever sent this version.
    const answer = kind === "trade_accepted" || kind === "trade_declined";
    const to = await reachable(answer ? t.sender_id : t.receiver_id, { trades: true });
    if (!to) return;
    const { rows: lines } = await query("SELECT * FROM trade_request_items WHERE trade_request_id = $1 ORDER BY card_name, id", [t.id]);
    await sendTemplate(kind, to.email, {
      username: to.username,
      from: answer ? t.r_name : t.s_name,
      fromCity: answer ? t.r_city : t.s_city,
      tradeId: t.id,
      message: t.message,
      meetupSpot: t.store_name ? { name: t.store_name, address: t.store_address, city: t.store_city } : null,
      requested: lines.filter((l) => l.side === "requested").map(line),
      offered: lines.filter((l) => l.side === "offered").map(line),
    });
  });
}
