// Trader reputation: after an accepted trade each player can say whether it happened and rate the other player
// 1-5 stars. A player's reputation is the number of completed trades and the average rating others gave them.
import { query } from "../db.js";

/** A player's public reputation from feedback others left them: completed trades and the average rating. */
export const reputationView = (row) => ({
  completedTrades: row?.completed ?? 0,
  rating: row?.rating == null ? null : Math.round(Number(row.rating) * 10) / 10,
});

/** Feedback on an accepted trade: { completed: true, rating: 1-5 } or { completed: false }. Returns an error or null. */
export function feedbackError({ completed, rating } = {}) {
  if (typeof completed !== "boolean") return "Tell us whether the trade happened.";
  if (completed && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return "Choose a rating from 1 to 5 stars.";
  if (!completed && rating != null) return "Only rate trades that happened.";
  return null;
}

/** Reputation for several players at once: Map of id -> { completedTrades, rating }. Used by search, profiles and want-list matches. */
export async function loadReputation(userIds) {
  const { rows } = await query(
    `SELECT subject_id, count(*) FILTER (WHERE completed)::int AS completed, avg(rating) AS rating
       FROM trade_feedback WHERE subject_id = ANY($1) GROUP BY subject_id`,
    [userIds],
  );
  const byId = new Map(rows.map((r) => [String(r.subject_id), r]));
  return new Map(userIds.map((id) => [String(id), reputationView(byId.get(String(id)))]));
}
