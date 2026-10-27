import { query } from "../db.js";
import { publish } from "./live.js";

// In-app notifications: the bell in the header. Each one is saved (so the red count survives a reload) and pushed
// straight to the player's open tabs over their live connection (lib/live.js).

/** A player's live channel: every open tab of theirs listens to it. */
export const userChannel = (userId) => `user:${userId}`;

/** Sends `type` with `data` to each player's open tabs (a message both players should see, say). */
export function publishTo(userIds, type, data) {
  for (const id of new Set(userIds)) publish(userChannel(id), type, data);
}

const SELECT = `SELECT n.id, n.kind, n.trade_id, n.created_at, n.read_at, u.username AS actor
                  FROM notifications n LEFT JOIN users u ON u.id = n.actor_id`;
const view = (r, threadId) => ({
  id: r.id,
  kind: r.kind,
  tradeId: r.trade_id,
  ...(threadId !== undefined && { threadId }),
  actor: { username: r.actor ?? "A player" },
  createdAt: r.created_at,
  read: Boolean(r.read_at),
});

/** The first version of the negotiation trade version `tradeId` belongs to (what the trade page keys its view on). */
async function threadOf(tradeId) {
  const { rows } = await query(
    `WITH RECURSIVE up AS (SELECT id, parent_id FROM trade_requests WHERE id = $1
                            UNION ALL SELECT t.id, t.parent_id FROM trade_requests t JOIN up ON t.id = up.parent_id)
     SELECT id FROM up WHERE parent_id IS NULL`,
    [tradeId],
  );
  return rows[0]?.id ?? tradeId;
}

/**
 * Tells player `userId` that `actorId` did `kind` on trade version `tradeId`. A message while an earlier message
 * notice in the same trade is still unread just moves that one to the top, so a chat is one line, not twenty.
 */
export async function notify({ userId, kind, tradeId, actorId }) {
  let row;
  if (kind === "trade_message") {
    ({ rows: [row] } = await query(
      `UPDATE notifications SET created_at = now(), actor_id = $4
        WHERE id = (SELECT id FROM notifications WHERE user_id = $1 AND kind = $2 AND trade_id = $3 AND read_at IS NULL LIMIT 1)
        RETURNING id`,
      [userId, kind, tradeId, actorId],
    ));
  }
  if (!row) {
    ({ rows: [row] } = await query("INSERT INTO notifications (user_id, kind, trade_id, actor_id) VALUES ($1, $2, $3, $4) RETURNING id", [
      userId,
      kind,
      tradeId,
      actorId,
    ]));
    // Keep each player's list short: drop read notices older than 90 days.
    await query("DELETE FROM notifications WHERE user_id = $1 AND read_at < now() - interval '90 days'", [userId]);
  }
  const { rows } = await query(`${SELECT} WHERE n.id = $1`, [row.id]);
  publish(userChannel(userId), "notification", view(rows[0], await threadOf(tradeId)));
}

/** A player's 30 newest notifications and how many are unread. */
export async function listNotifications(userId) {
  const { rows } = await query(`${SELECT} WHERE n.user_id = $1 ORDER BY n.created_at DESC, n.id DESC LIMIT 30`, [userId]);
  const { rows: count } = await query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL", [userId]);
  return { notifications: rows.map((r) => view(r)), unread: count[0].n };
}

/** Marks a player's notifications read: the ones in `ids`, or all of them. */
export async function markRead(userId, ids = null) {
  await query(
    "UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))",
    [userId, ids],
  );
}
