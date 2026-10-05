// The moderation and admin audit log (requirement 5.2.3): every moderator or admin action is written to
// mod_actions with who did it, what, to whom and why.

// Writes one row to the audit log. Always called inside the same transaction as the action itself.
export const logAction = (c, { actorId, action, reportId = null, targetUserId = null, targetItemId = null, reason = null, details = null }) =>
  c.query(
    `INSERT INTO mod_actions (actor_id, action, report_id, target_user_id, target_item_id, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorId, action, reportId, targetUserId, targetItemId, reason, details && JSON.stringify(details)],
  );
