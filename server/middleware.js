import rateLimit from "express-rate-limit";
import { query } from "./db.js";
import { HttpError } from "./lib/http.js";
import { newToken, safeEqual } from "./lib/security.js";

export const IDLE_MINUTES = 30; // 5.1.4 session timeout after inactivity (ST-03)

/** Loads the signed-in user on every request so suspensions and deletions apply immediately. */
export async function loadUser(req, res, next) {
  const id = req.session?.userId;
  if (!id) return next();
  const { rows } = await query(
    `SELECT id, email, username, city, role, status, travel_km, email_trades,
            google_sub IS NOT NULL AS google_linked, password_hash <> '!' AS has_password, email_verified_at IS NOT NULL AS email_verified
       FROM users WHERE id = $1`,
    [id],
  );
  if (rows[0]?.status === "active") req.user = rows[0];
  else delete req.session.userId;
  next();
}

// Guard for routes that need a signed-in user.
export function requireAuth(req, res, next) {
  if (!req.user) throw new HttpError(401, "Please log in to continue.");
  next();
}

/** Every privileged action is checked on the server (section 2). */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) throw new HttpError(401, "Please log in to continue.");
    if (!roles.includes(req.user.role)) throw new HttpError(403, "You don't have permission to do that.");
    next();
  };

/** Synchronizer-token CSRF check: unsafe methods must echo the session's token in X-CSRF-Token. */
export function csrf(req, res, next) {
  // Hand out a token on the first request; the client reads it from /api/auth/me.
  req.session.csrfToken ??= newToken();
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (!safeEqual(req.get("x-csrf-token"), req.session.csrfToken)) {
    throw new HttpError(403, "Your session expired. Please refresh the page and try again.");
  }
  next();
}

/** Revokes a user's sessions (password change/reset, suspension, deletion), optionally keeping one. */
export const revokeSessions = (userId, exceptSid = "") =>
  query("DELETE FROM session WHERE sess->>'userId' = $1 AND sid <> $2", [String(userId), exceptSid]);

// Note: in-memory rate limit counters (single instance). Use a shared store before adding instances (plan 8.6).
// The API tests fire lots of requests quickly, so the limits are effectively off there.
const testing = process.env.NODE_ENV === "test";
const limiter = (windowMs, limit, error) =>
  rateLimit({ windowMs, limit: testing ? 100000 : limit, standardHeaders: "draft-8", legacyHeaders: false, message: { error } });

// General cap for the whole API, plus a much tighter one for login/register/reset to slow down guessing.
export const apiLimiter = limiter(60_000, 300, "Too many requests. Please slow down.");
export const authLimiter = limiter(15 * 60_000, 20, "Too many attempts. Please wait a few minutes and try again.");
// Collection imports can mean dozens of Scryfall calls each, so keep them occasional.
export const importLimiter = limiter(60 * 60_000, 20, "That's a lot of imports. Please wait a while before importing again.");
// Confirmation emails on request, and admins' test emails: enough for typos, not enough to flood an inbox.
export const verifyLimiter = limiter(60 * 60_000, 5, "We've sent a few links already. Check your spam folder, or wait a while and try again.");
export const testEmailLimiter = limiter(60 * 60_000, 20, "That's a lot of test emails. Please wait a while before sending more.");
// Suggestions are read by people, so a handful an hour is plenty.
export const suggestionLimiter = limiter(60 * 60_000, 10, "Thanks for all the ideas! Please wait a while before sending more.");
