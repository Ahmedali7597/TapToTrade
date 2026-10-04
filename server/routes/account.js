import { Router } from "express";
import { query, tx } from "../db.js";
import { HttpError } from "../lib/http.js";
import { hashPassword, verifyPassword } from "../lib/security.js";
import { background, notice, sendTemplate, verificationLink, VERIFY_HOURS } from "../lib/notify.js";
import { requireAuth, revokeSessions, verifyLimiter } from "../middleware.js";
import { cityMessage, emailMessage, normalizeEmail, parseTravelKm, passwordMessage, usernameMessage } from "../../shared/validation.js";
import { duplicateAccountError, selfView } from "./auth.js";

// Private account settings (4.1.7, 4.2.2–4.2.4). Everything here requires the signed-in user.
const router = Router();
router.use(requireAuth);

// Sensitive changes (email, password, deleting the account) ask for the current password again.
async function confirmPassword(userId, password) {
  const { rows } = await query("SELECT password_hash FROM users WHERE id = $1", [userId]);
  // Google-only accounts have no password to confirm with yet.
  if (rows[0].password_hash === "!") {
    const message = "Your account signs in with Google. Set a password under Password first.";
    throw new HttpError(400, message, { currentPassword: message, password: message });
  }
  if (!(await verifyPassword(rows[0].password_hash, String(password ?? "")))) {
    throw new HttpError(400, "Your current password is incorrect.", { currentPassword: "Incorrect password." });
  }
}

// Change city. No password needed since it only affects which searches you show up in.
router.patch("/city", async (req, res) => {
  const problem = cityMessage(req.body?.city);
  if (problem) throw new HttpError(400, problem, { city: problem });
  const { rows } = await query("UPDATE users SET city = $1, updated_at = now() WHERE id = $2 RETURNING *", [req.body.city, req.user.id]);
  res.json({ user: selfView(rows[0]) });
});

// Meetup range: how far you'll travel to trade. Shown on your profile and used as your default search radius.
router.patch("/travel", async (req, res) => {
  const [travelKm, problem] = parseTravelKm(req.body?.travelKm);
  if (problem) throw new HttpError(400, problem, { travelKm: problem });
  const { rows } = await query("UPDATE users SET travel_km = $1, updated_at = now() WHERE id = $2 RETURNING *", [travelKm, req.user.id]);
  res.json({ user: selfView(rows[0]) });
});

// Change username. Profiles, listings and trades look the name up by id, so they all follow the change.
// No password needed, like city: it's public display info and doesn't affect sign-in or recovery.
router.patch("/username", async (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const problem = usernameMessage(username);
  if (problem) throw new HttpError(400, problem, { username: problem });
  const { rows } = await query("UPDATE users SET username = $1, updated_at = now() WHERE id = $2 RETURNING *", [username, req.user.id]).catch(
    (err) => {
      throw duplicateAccountError(err);
    },
  );
  res.json({ user: selfView(rows[0]) });
});

// Change email. Same duplicate handling as sign-up. A new address has to be confirmed again, so a link goes to it.
router.patch("/email", async (req, res) => {
  const problem = emailMessage(req.body?.email);
  if (problem) throw new HttpError(400, problem, { email: problem });
  await confirmPassword(req.user.id, req.body.currentPassword);
  const email = normalizeEmail(req.body.email);
  const { rows } = await query(
    `UPDATE users SET email = $1, updated_at = now(),
            email_verified_at = CASE WHEN email = $1 THEN email_verified_at END
      WHERE id = $2 RETURNING *`,
    [email, req.user.id],
  ).catch((err) => {
    throw duplicateAccountError(err);
  });
  const user = rows[0];
  if (!user.email_verified_at) background(async () => sendTemplate("verify", user.email, { username: user.username, link: await verificationLink(user), hours: VERIFY_HOURS }));
  // Tell the old (confirmed) address too, in case someone else made the change.
  if (req.user.email_verified && req.user.email !== email) {
    background(() => sendTemplate("email_changed", req.user.email, { username: user.username, newEmail: email }));
  }
  res.json({ user: selfView(user) });
});

// Send a fresh "confirm your email" link (the banner's "Send a new link" button).
router.post("/verify-email", verifyLimiter, async (req, res) => {
  if (req.user.email_verified) return res.json({ message: "Your email is already confirmed." });
  const link = await verificationLink(req.user);
  const sent = await sendTemplate("verify", req.user.email, { username: req.user.username, link, hours: VERIFY_HOURS });
  if (!sent) throw new HttpError(502, "We couldn't send the email just now. Please try again in a few minutes.");
  res.json({ message: `We sent a new link to ${req.user.email}. It works for ${VERIFY_HOURS} hours.` });
});

// Email notifications: whether trade requests, counter-offers and acceptances also arrive by email.
router.patch("/notifications", async (req, res) => {
  if (typeof req.body?.emailTrades !== "boolean") throw new HttpError(400, "Choose on or off.");
  const { rows } = await query("UPDATE users SET email_trades = $1, updated_at = now() WHERE id = $2 RETURNING *", [req.body.emailTrades, req.user.id]);
  res.json({ user: selfView(rows[0]) });
});

// Change password while signed in. Google-only accounts set their first password without a current one.
router.patch("/password", async (req, res) => {
  const problem = passwordMessage(req.body?.newPassword);
  if (problem) throw new HttpError(400, problem, { newPassword: problem });
  if (req.user.has_password) await confirmPassword(req.user.id, req.body.currentPassword);
  await query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
    await hashPassword(req.body.newPassword),
    req.user.id,
  ]);
  await revokeSessions(req.user.id, req.sessionID); // sign out other devices, keep this one
  notice("password_changed", req.user.id);
  res.json({ message: "Password changed." });
});

/**
 * 4.2.4: deletion anonymizes rather than hard-deletes. Listings, the want list, reset and confirmation links, a store account
 * link and sessions are removed; trade snapshots, trade feedback, moderation records and suggestions are retained (documented in
 * README "Retention").
 */
router.delete("/", async (req, res) => {
  await confirmPassword(req.user.id, req.body?.password);
  const id = req.user.id;
  await tx(async (c) => {
    // Remove listings and reset links, close any open trades, then scrub the user row itself.
    await c.query("DELETE FROM inventory_items WHERE owner_id = $1", [id]);
    await c.query("DELETE FROM want_items WHERE user_id = $1", [id]);
    await c.query("DELETE FROM password_resets WHERE user_id = $1", [id]);
    await c.query("DELETE FROM email_verifications WHERE user_id = $1", [id]);
    await c.query("UPDATE stores SET account_user_id = NULL WHERE account_user_id = $1", [id]);
    await c.query(
      "UPDATE trade_requests SET status = 'declined', updated_at = now() WHERE status = 'pending' AND (sender_id = $1 OR receiver_id = $1)",
      [id],
    );
    await c.query(
      `UPDATE users SET email = 'deleted-' || id || '@deleted.invalid', username = 'deleted-' || id,
              password_hash = '!', google_sub = NULL, travel_km = NULL, city = 'Removed', status = 'deleted', role = 'user',
              email_verified_at = NULL, updated_at = now()
        WHERE id = $1`,
      [id],
    );
  });
  await revokeSessions(id);
  // The account row is anonymized now, so use the address and name it had (only if the address was confirmed).
  if (req.user.email_verified) background(() => sendTemplate("account_deleted", req.user.email, { username: req.user.username }));
  res.status(204).end();
});

export default router;
