import { Router } from "express";
import { query, tx } from "../db.js";
import { HttpError, idParam } from "../lib/http.js";
import { requireAuth, requireRole, revokeSessions } from "../middleware.js";
import { escapeLike } from "../lib/search.js";
import { logAction } from "../lib/audit.js";
import { notice, promoted } from "../lib/notify.js";
import { FINISH_LABELS, outranks } from "../../shared/validation.js";

// Reports (4.6.1), moderation (4.6.2–4.6.4) and role management (4.7). Every action writes mod_actions (5.2.3).
const router = Router();
const moderator = requireRole("moderator", "admin");
const admin = requireRole("admin");

/** A listing as one line, e.g. "Lightning Bolt (M10 #146, LP, Foil)". Non-foil is the default, so it isn't mentioned. */
const listingLabel = (r) => `${r.name} (${r.set_code.toUpperCase()} #${r.collector_number}, ${r.condition}${r.finish === "nonfoil" ? "" : `, ${FINISH_LABELS[r.finish]}`})`;

// Moderators have to say why they did something; resolving a report can skip it.
function readReason(body, required = true) {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (required && (reason.length < 5 || reason.length > 1000)) {
    throw new HttpError(400, "Give a reason between 5 and 1000 characters.", { reason: "5–1000 characters." });
  }
  return reason || null;
}

/** Optionally closes the report a moderator acted from. */
async function closeReport(c, reportId, actorId) {
  if (!reportId) return null;
  const id = Number(reportId);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid report.");
  await c.query("UPDATE reports SET status = 'reviewed', reviewed_at = now(), reviewed_by = $2 WHERE id = $1 AND status = 'pending'", [
    id,
    actorId,
  ]);
  return id;
}

// ---- 4.6.1 any signed-in user can report a user or a specific listing ----
router.post("/reports", requireAuth, async (req, res) => {
  const reason = readReason(req.body);
  let reportedUserId = Number(req.body?.reportedUserId);
  let itemId = null;
  let snapshot = null;
  // Reporting a listing: work out the owner from the listing and keep a text copy of the card,
  // since the listing might be deleted before a moderator looks at it.
  if (req.body?.inventoryItemId != null) {
    const { rows } = await query(
      `SELECT i.id, i.owner_id, p.name, p.set_code, p.collector_number, i.condition, i.finish
         FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id WHERE i.id = $1`,
      [Number(req.body.inventoryItemId)],
    );
    if (!rows[0]) throw new HttpError(404, "That listing was not found.");
    itemId = rows[0].id;
    reportedUserId = rows[0].owner_id;
    snapshot = listingLabel(rows[0]);
  }
  if (!Number.isInteger(reportedUserId) || reportedUserId <= 0) throw new HttpError(400, "Choose who you are reporting.");
  if (reportedUserId === req.user.id) throw new HttpError(400, "You can't report yourself.");
  const { rows: target } = await query("SELECT id, username FROM users WHERE id = $1 AND status <> 'deleted'", [reportedUserId]);
  if (!target[0]) throw new HttpError(404, "That player was not found.");

  const { rows } = await query(
    `INSERT INTO reports (reporter_id, reported_user_id, inventory_item_id, item_snapshot, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, status, created_at`,
    [req.user.id, reportedUserId, itemId, snapshot, reason],
  );
  notice("report_received", req.user.id, { reported: snapshot ? `the listing ${snapshot}` : `the player ${target[0].username}` });
  res.status(201).json({ report: { id: rows[0].id, status: rows[0].status } });
});

// ---- 4.6.2 moderators view reports (pending by default) ----
router.get("/moderation/reports", moderator, async (req, res) => {
  const status = ["pending", "reviewed", "dismissed"].includes(req.query.status) ? req.query.status : "pending";
  const { rows } = await query(
    `SELECT r.id, r.reason, r.status, r.created_at, r.item_snapshot, r.inventory_item_id,
            rep.username AS reporter_username,
            tu.id AS target_id, tu.username AS target_username, tu.city AS target_city,
            tu.status AS target_status, tu.role AS target_role
       FROM reports r
       LEFT JOIN users rep ON rep.id = r.reporter_id
       JOIN users tu ON tu.id = r.reported_user_id
      WHERE r.status = $1
      ORDER BY r.created_at ASC, r.id ASC
      LIMIT 100`,
    [status],
  );
  res.json({
    reports: rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      reporter: r.reporter_username,
      item: r.item_snapshot ? { id: r.inventory_item_id, label: r.item_snapshot } : null,
      target: { id: r.target_id, username: r.target_username, city: r.target_city, status: r.target_status, role: r.target_role },
    })),
  });
});

// Mark a report reviewed or dismissed without taking any other action.
router.post("/moderation/reports/:id/resolve", moderator, async (req, res) => {
  const id = idParam(req, "That report");
  const status = req.body?.status;
  if (!["reviewed", "dismissed"].includes(status)) throw new HttpError(400, "Choose reviewed or dismissed.");
  const reason = readReason(req.body, false);
  await tx(async (c) => {
    const { rowCount } = await c.query(
      "UPDATE reports SET status = $2, reviewed_at = now(), reviewed_by = $3 WHERE id = $1 AND status = 'pending'",
      [id, status, req.user.id],
    );
    if (!rowCount) throw new HttpError(409, "That report was already handled.");
    await logAction(c, { actorId: req.user.id, action: `report_${status}`, reportId: id, reason });
  });
  res.json({ ok: true });
});

// ---- 4.6.3 remove an inventory listing (AT-10) ----
router.delete("/moderation/inventory/:id", moderator, async (req, res) => {
  const id = idParam(req);
  const reason = readReason(req.body);
  const removed = await tx(async (c) => {
    // RETURNING gives us the card details for the audit log before the row is gone.
    const { rows } = await c.query(
      `DELETE FROM inventory_items i USING card_printings p
        WHERE i.id = $1 AND p.id = i.printing_id
        RETURNING i.id, i.owner_id, i.quantity, i.condition, i.finish, p.name, p.set_code, p.collector_number`,
      [id],
    );
    if (!rows[0]) throw new HttpError(404, "That listing was not found.");
    const reportId = await closeReport(c, req.body?.reportId, req.user.id);
    await logAction(c, {
      actorId: req.user.id,
      action: "remove_item",
      reportId,
      targetUserId: rows[0].owner_id,
      targetItemId: id,
      reason,
      details: rows[0],
    });
    return rows[0];
  });
  // The owner hears about it, with the card, so they can fix the listing or appeal.
  notice("listing_removed", removed.owner_id, { card: listingLabel(removed) });
  res.json({ removed: { id: removed.id, name: removed.name } });
});

// ---- 4.6.4 suspend / reinstate accounts ----
// Shared by suspend and unsuspend. Locks the target row, checks rank and current status, then logs it.
async function setStatus(req, from, to, action) {
  const id = idParam(req, "That player");
  const reason = readReason(req.body);
  await tx(async (c) => {
    const { rows } = await c.query("SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE", [id]);
    const target = rows[0];
    if (!target || target.status === "deleted") throw new HttpError(404, "That player was not found.");
    if (!outranks(req.user.role, target.role)) throw new HttpError(403, "You can't change the status of that account.");
    if (target.status !== from) throw new HttpError(409, `That account is already ${target.status}.`);
    await c.query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1", [id, to]);
    const reportId = await closeReport(c, req.body?.reportId, req.user.id);
    await logAction(c, { actorId: req.user.id, action, reportId, targetUserId: id, reason });
  });
  // Kick a suspended user out right away instead of waiting for their session to expire, and tell them either way.
  if (to === "suspended") await revokeSessions(id);
  notice(to === "suspended" ? "account_suspended" : "account_reinstated", id, {}, { suspended: true });
}

router.post("/moderation/users/:id/suspend", moderator, async (req, res) => {
  await setStatus(req, "active", "suspended", "suspend_user");
  res.json({ ok: true });
});

router.post("/moderation/users/:id/unsuspend", moderator, async (req, res) => {
  await setStatus(req, "suspended", "active", "unsuspend_user");
  res.json({ ok: true });
});

// ---- 4.7 administrators assign roles (promote to / revoke moderator) ----
// Admin user list with a simple username/email filter. Staff are listed first.
router.get("/admin/users", admin, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const { rows } = await query(
    `SELECT id, username, email, city, role, status, created_at FROM users
      WHERE status <> 'deleted' AND ($1 = '' OR username ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
      ORDER BY (role = 'user'), lower(username) LIMIT 50`,
    [escapeLike(q)],
  );
  res.json({
    users: rows.map((u) => ({ id: u.id, username: u.username, email: u.email, city: u.city, role: u.role, status: u.status })),
  });
});

// Promote someone to moderator or back to user. Admins themselves can only be changed with make-admin.
router.patch("/admin/users/:id/role", admin, async (req, res) => {
  const id = idParam(req, "That player");
  const role = req.body?.role;
  if (!["user", "moderator"].includes(role)) throw new HttpError(400, "Role must be user or moderator.");
  if (id === req.user.id) throw new HttpError(400, "You can't change your own role.");
  const user = await tx(async (c) => {
    const { rows } = await c.query("SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE", [id]);
    if (!rows[0] || rows[0].status === "deleted") throw new HttpError(404, "That player was not found.");
    if (rows[0].role === "admin") throw new HttpError(403, "Administrator roles are managed outside the app.");
    const { rows: updated } = await c.query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1 RETURNING id, username, role", [
      id,
      role,
    ]);
    await logAction(c, { actorId: req.user.id, action: "set_role", targetUserId: id, details: { from: rows[0].role, to: role } });
    return { ...updated[0], from: rows[0].role };
  });
  // A new moderator gets the "you're a moderator" email, if their address is confirmed.
  const emailed = role === "moderator" && user.from !== "moderator" ? await promoted(id) : false;
  res.json({ user: { id: user.id, username: user.username, role: user.role }, emailed });
});

export default router;
