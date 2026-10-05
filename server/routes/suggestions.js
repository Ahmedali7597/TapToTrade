import { Router } from "express";
import { query } from "../db.js";
import { HttpError, checkFields, idParam } from "../lib/http.js";
import { requireAuth, requireRole, suggestionLimiter } from "../middleware.js";
import { SUGGESTION_TOPICS } from "../../shared/validation.js";

// Suggestions: any signed-in player can send one; moderators and admins read them and mark them reviewed.
const router = Router();
const staff = requireRole("moderator", "admin");

const TOPICS = SUGGESTION_TOPICS.map((t) => t.value);

/** API shape for a suggestion. `from` is only included for staff. */
const view = (s, withAuthor = false) => ({
  id: s.id,
  topic: s.topic,
  message: s.message,
  status: s.status,
  createdAt: s.created_at,
  ...(withAuthor && { from: s.username }),
});

/** Validates { topic, message } from a request body. */
function readSuggestion(body = {}) {
  const fields = {};
  if (!TOPICS.includes(body.topic)) fields.topic = "Choose what your suggestion is about.";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < 10 || message.length > 2000) fields.message = "Write between 10 and 2000 characters.";
  checkFields(fields);
  return { topic: body.topic, message };
}

// Send a suggestion.
router.post("/suggestions", requireAuth, suggestionLimiter, async (req, res) => {
  const { topic, message } = readSuggestion(req.body);
  const { rows } = await query("INSERT INTO suggestions (user_id, topic, message) VALUES ($1, $2, $3) RETURNING *", [req.user.id, topic, message]);
  res.status(201).json({ suggestion: view(rows[0]) });
});

// The player's own suggestions, newest first, so they can see which ones were reviewed.
router.get("/suggestions/mine", requireAuth, async (req, res) => {
  const { rows } = await query("SELECT * FROM suggestions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50", [req.user.id]);
  res.json({ suggestions: rows.map((s) => view(s)) });
});

// Staff inbox: new suggestions oldest first (like the report queue), reviewed ones newest first.
router.get("/moderation/suggestions", staff, async (req, res) => {
  const status = req.query.status === "reviewed" ? "reviewed" : "new";
  const { rows } = await query(
    `SELECT s.*, u.username FROM suggestions s JOIN users u ON u.id = s.user_id
      WHERE s.status = $1 ORDER BY s.created_at ${status === "new" ? "ASC" : "DESC"}, s.id LIMIT 100`,
    [status],
  );
  res.json({ suggestions: rows.map((s) => view(s, true)) });
});

// Mark one reviewed. Not a moderation action against anyone, so it isn't written to mod_actions.
router.post("/moderation/suggestions/:id/review", staff, async (req, res) => {
  const { rowCount } = await query(
    "UPDATE suggestions SET status = 'reviewed', reviewed_at = now(), reviewed_by = $2 WHERE id = $1 AND status = 'new'",
    [idParam(req, "That suggestion"), req.user.id],
  );
  if (!rowCount) throw new HttpError(409, "That suggestion was already reviewed.");
  res.json({ ok: true });
});

export default router;
