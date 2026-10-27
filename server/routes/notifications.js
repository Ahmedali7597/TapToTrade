import { Router } from "express";
import { HttpError } from "../lib/http.js";
import { subscribe } from "../lib/live.js";
import { listNotifications, markRead, userChannel } from "../lib/notifications.js";
import { requireAuth } from "../middleware.js";

// The header's bell, and each player's live connection: one Server-Sent Events stream per open tab that carries
// their notifications plus messages and meetup changes on their trades, the moment they happen.
// requireAuth goes on each route: this router shares the /api prefix, so a router-wide check would turn every
// unknown /api address into "sign in" instead of "not found".
const router = Router();

router.get("/notifications", requireAuth, async (req, res) => {
  res.json(await listNotifications(req.user.id));
});

// Mark notifications read: { ids: [...] }, or every one when ids is left out.
router.post("/notifications/read", requireAuth, async (req, res) => {
  const ids = req.body?.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length > 100 || !ids.every((id) => Number.isSafeInteger(id) && id > 0))) {
    throw new HttpError(400, "Choose the notifications to mark as read.");
  }
  await markRead(req.user.id, ids ?? null);
  res.json(await listNotifications(req.user.id));
});

router.get("/live", requireAuth, (req, res) => subscribe(userChannel(req.user.id), req, res));

export default router;
