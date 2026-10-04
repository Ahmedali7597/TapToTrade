import { Router } from "express";
import { query, tx } from "../db.js";
import { HttpError, checkFields, logEvent } from "../lib/http.js";
import { notice, sendTemplate, welcome } from "../lib/notify.js";
import { siteUrl } from "../lib/seo.js";
import { hashPassword, newToken, safeEqual, sha256, verifyDummy, verifyPassword } from "../lib/security.js";
import { authUrl, exchangeCode, googleConfigured } from "../lib/google.js";
import { authLimiter, revokeSessions } from "../middleware.js";
import { TERMS_UPDATED } from "../../shared/pages.js";
import { cityMessage, normalizeEmail, passwordMessage, safeNext, usernameMessage, validateRegistration } from "../../shared/validation.js";

const router = Router();
// How long a reset link stays valid.
const RESET_TTL_MINUTES = 60;

/**
 * The signed-in user's own view. Never includes the password hash or Google id (AT-03), only whether they exist.
 * Works on both loadUser rows (has_password, google_linked) and full RETURNING * rows.
 */
export const selfView = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  city: u.city,
  role: u.role,
  travelKm: u.travel_km ?? null,
  emailLogin: u.has_password ?? u.password_hash !== "!",
  googleLinked: u.google_linked ?? Boolean(u.google_sub),
  emailVerified: u.email_verified ?? Boolean(u.email_verified_at),
  emailTrades: u.email_trades,
});

// express-session only has a callback API, so wrap regenerate in a promise.
const regenerate = (req) => new Promise((ok, fail) => req.session.regenerate((err) => (err ? fail(err) : ok())));

/** New session id on login/registration (prevents session fixation) with a fresh CSRF token. */
async function startSession(req, user) {
  await regenerate(req);
  req.session.userId = user.id;
  req.session.csrfToken = newToken();
}

/** Maps unique-constraint violations to friendly field errors (AT-02: 409). */
export function duplicateAccountError(err) {
  if (err.code !== "23505") return err;
  const field = err.constraint === "users_email_key" ? "email" : "username";
  const message = field === "email" ? "An account with this email already exists." : "That username is taken.";
  return new HttpError(409, message, { [field]: message });
}

// The client calls this on load to find out who is signed in and to pick up its CSRF token.
// googleEnabled tells the login and sign-up pages whether to show "Continue with Google".
router.get("/me", (req, res) => {
  res.json({ user: req.user ? selfView(req.user) : null, csrfToken: req.session.csrfToken, googleEnabled: googleConfigured() });
});

// Sign up, then log the new user straight in.
router.post("/register", authLimiter, async (req, res) => {
  const { email, username, password, city } = req.body ?? {};
  const fields = validateRegistration({ email, username, password, city });
  checkFields(fields);

  // Let the unique indexes catch duplicates instead of checking first; it avoids a race between two sign-ups.
  const passwordHash = await hashPassword(password);
  const {
    rows: [user],
  } = await query(
    // Signing up means agreeing to the terms and privacy policy shown on the form; record which version and when.
    "INSERT INTO users (email, username, password_hash, city, terms_version, terms_accepted_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING *",
    [normalizeEmail(email), username, passwordHash, city, TERMS_UPDATED],
  ).catch((err) => {
    throw duplicateAccountError(err);
  });
  await startSession(req, user);
  welcome(user); // thank-you note with the confirm-your-email button, sent in the background
  res.status(201).json({ user: selfView(user), csrfToken: req.session.csrfToken });
});

// Log in. Wrong email and wrong password give the same message on purpose.
router.post("/login", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  if (!email || !password) throw new HttpError(400, "Enter your email and password.");

  const { rows } = await query("SELECT * FROM users WHERE email = $1 AND status <> 'deleted'", [email]);
  const user = rows[0];
  const ok = user ? await verifyPassword(user.password_hash, password) : await verifyDummy(password);
  if (!ok) {
    logEvent("auth.login_failed", { userId: user ? user.id : null, ip: req.ip });
    throw new HttpError(401, "Email or password is incorrect.");
  }
  // Only tell someone they're suspended after they've proven they know the password.
  if (user.status === "suspended") {
    logEvent("auth.login_suspended", { userId: user.id, ip: req.ip });
    throw new HttpError(403, "This account is suspended. Contact the moderators if you think this is a mistake.");
  }
  await startSession(req, user);
  res.json({ user: selfView(user), csrfToken: req.session.csrfToken });
});

// Log out: drop the session row and clear the cookie.
router.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("ttt.sid").status(204).end();
  });
});

// 4.1.5: always 202 so the response doesn't reveal whether an account exists.
router.post("/forgot-password", authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const { rows } = await query("SELECT id, email, username FROM users WHERE email = $1 AND status = 'active'", [email]);
  if (rows[0]) {
    // Kill any older unused links first so only the newest email works.
    const token = newToken();
    await tx(async (c) => {
      await c.query("UPDATE password_resets SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [rows[0].id]);
      await c.query(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))",
        [rows[0].id, sha256(token), RESET_TTL_MINUTES],
      );
    });
    const link = `${siteUrl()}/reset-password?token=${token}`;
    await sendTemplate("reset", rows[0].email, { username: rows[0].username, link, minutes: RESET_TTL_MINUTES });
  }
  res.status(202).json({ message: "If that email has an account, a reset link is on its way." });
});

// Finish a reset: the token has to be unused, unexpired, not revoked, and belong to an active user.
router.post("/reset-password", authLimiter, async (req, res) => {
  const { token, password } = req.body ?? {};
  const problem = passwordMessage(password);
  if (problem) throw new HttpError(400, problem, { password: problem });
  if (typeof token !== "string" || !token) throw new HttpError(400, "This reset link is invalid or has expired.");

  const passwordHash = await hashPassword(password);
  const userId = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT r.id, r.user_id FROM password_resets r JOIN users u ON u.id = r.user_id
        WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > now() AND u.status = 'active'
        FOR UPDATE OF r`,
      [sha256(token)],
    );
    if (!rows[0]) return null;
    // Burn this token, revoke any others, and set the new password, all or nothing.
    await c.query("UPDATE password_resets SET used_at = now() WHERE id = $1", [rows[0].id]);
    await c.query("UPDATE password_resets SET revoked_at = now() WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL", [rows[0].user_id]);
    await c.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [passwordHash, rows[0].user_id]);
    return rows[0].user_id;
  });
  if (!userId) {
    logEvent("auth.reset_rejected", { ip: req.ip });
    throw new HttpError(400, "This reset link is invalid or has expired.");
  }
  // Anyone who was signed in with the old password gets logged out everywhere.
  await revokeSessions(userId);
  notice("password_changed", userId);
  res.json({ message: "Password updated. You can log in now." });
});

// Confirm an email address from the link in the welcome or confirmation email. Works without being signed in,
// since people often open the email on another device. The link only counts for the address it was sent to.
router.post("/verify-email", authLimiter, async (req, res) => {
  const token = req.body?.token;
  const invalid = new HttpError(400, "This confirmation link is invalid or has expired. Log in to send yourself a new one.");
  if (typeof token !== "string" || !token) throw invalid;
  const result = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT v.id, v.user_id, v.used_at, u.email_verified_at FROM email_verifications v JOIN users u ON u.id = v.user_id
        WHERE v.token_hash = $1 AND v.expires_at > now() AND u.status = 'active' AND u.email = v.email
        FOR UPDATE OF v`,
      [sha256(token)],
    );
    const v = rows[0];
    if (!v) return null;
    // A second click on the same link is fine: the address is already confirmed.
    if (v.used_at) return v.email_verified_at ? "already" : null;
    await c.query("UPDATE email_verifications SET used_at = now() WHERE id = $1", [v.id]);
    await c.query("UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1", [v.user_id]);
    return "confirmed";
  });
  if (!result) {
    logEvent("auth.verify_rejected", { ip: req.ip });
    throw invalid;
  }
  res.json({ message: result === "already" ? "Your email is already confirmed." : "Email confirmed. You can send trade requests now." });
});

// ---- Continue with Google (see lib/google.js) ----

// How long a verified Google identity waits in the session while a new player picks a username and city.
const GOOGLE_SIGNUP_MINUTES = 15;
const pendingSignup = (req) => {
  const p = req.session.googleSignup;
  return p && Date.now() - p.at < GOOGLE_SIGNUP_MINUTES * 60_000 ? p : null;
};

// Step 1: send the browser to Google with a fresh state (CSRF for the callback) and nonce (replay guard).
router.get("/google", authLimiter, (req, res) => {
  if (!googleConfigured()) throw new HttpError(404, "Google sign-in isn't set up.");
  const state = newToken();
  const nonce = newToken();
  const next = safeNext(req.query.next);
  req.session.google = { state, nonce, next };
  res.redirect(authUrl({ state, nonce }));
});

// Step 2: Google sends the browser back here. Problems go back to /login with a reason the page explains.
router.get("/google/callback", authLimiter, async (req, res) => {
  const fail = (reason) => res.redirect(`/login?google=${reason}`);
  const pending = req.session.google;
  delete req.session.google; // single use
  if (!googleConfigured() || !pending) return fail("expired");
  if (req.query.error) return fail("cancelled");
  if (typeof req.query.code !== "string" || !safeEqual(req.query.state, pending.state)) return fail("failed");

  let account;
  try {
    account = await exchangeCode(req.query.code, pending.nonce);
  } catch (err) {
    logEvent("auth.google_failed", { ip: req.ip, reason: err.message });
    return fail("failed");
  }
  const email = normalizeEmail(account.email);

  // Already linked, or an existing account with the same Google-verified email (linked on first use).
  const { rows } = await query(
    `SELECT * FROM users WHERE (google_sub = $1 OR email = $2) AND status <> 'deleted'
      ORDER BY (google_sub = $1) DESC NULLS LAST LIMIT 1`,
    [account.sub, email],
  );
  let user = rows[0];
  if (user) {
    if (user.google_sub && user.google_sub !== account.sub) return fail("other");
    if (user.status === "suspended") {
      logEvent("auth.login_suspended", { userId: user.id, ip: req.ip });
      return fail("suspended");
    }
    if (!user.google_sub) {
      user = (await query("UPDATE users SET google_sub = $1, updated_at = now() WHERE id = $2 RETURNING *", [account.sub, user.id])).rows[0];
    }
    // Google has confirmed this address, so the player doesn't need our confirmation email too.
    if (!user.email_verified_at && user.email === email) {
      await query("UPDATE users SET email_verified_at = now() WHERE id = $1", [user.id]);
    }
    await startSession(req, user);
    return res.redirect(pending.next);
  }

  // New player: remember the verified identity briefly while they choose a username and city.
  req.session.googleSignup = { sub: account.sub, email, at: Date.now() };
  res.redirect("/register/google");
});

// The finish-sign-up page shows which Google email is being used.
router.get("/google/pending", (req, res) => {
  res.json({ email: pendingSignup(req)?.email ?? null });
});

// Step 3 for new players: create the account (no password yet; they can set one in Settings).
router.post("/google/complete", authLimiter, async (req, res) => {
  const pending = pendingSignup(req);
  if (!pending) throw new HttpError(400, "Your Google sign-in expired. Please start again.");
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const city = req.body?.city;
  const fields = Object.fromEntries(
    Object.entries({ username: usernameMessage(username), city: city ? cityMessage(city) : "City is required." }).filter(([, v]) => v),
  );
  checkFields(fields);

  const {
    rows: [user],
  } = await query(
    `INSERT INTO users (email, username, password_hash, city, google_sub, email_verified_at, terms_version, terms_accepted_at)
     VALUES ($1, $2, '!', $3, $4, now(), $5, now()) RETURNING *`,
    [pending.email, username, city, pending.sub, TERMS_UPDATED],
  ).catch((err) => {
    if (err.constraint === "users_google_sub_key") throw new HttpError(409, "This Google account already has a Tap to Trade account. Log in instead.");
    throw duplicateAccountError(err);
  });
  delete req.session.googleSignup;
  await startSession(req, user);
  welcome(user, { confirm: false }); // Google already confirmed the address
  res.status(201).json({ user: selfView(user), csrfToken: req.session.csrfToken });
});

export default router;
