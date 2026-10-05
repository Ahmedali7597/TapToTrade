import { Router } from "express";
import { query, tx } from "../db.js";
import { HttpError, checkFields, idFrom } from "../lib/http.js";
import { canManage, eventView, icsCalendar, MAX_UPCOMING, nextDay, readEvent, readRepeat, UPCOMING, upcomingEvents } from "../lib/events.js";
import { siteUrl } from "../lib/seo.js";
import { timeZoneFor } from "../../shared/events.js";
import { slugify } from "../../shared/stores.js";
import { logAction } from "../lib/audit.js";

// Partner store events: trade nights, Commander nights, prereleases. Anyone can see an active store's
// upcoming events and download them as a calendar file; admins and the store's own account post and edit
// them. Every change is written to mod_actions, like other store changes.
const router = Router({ mergeParams: true });

/** The active store in the URL, or a 404. */
async function activeStore(req) {
  const id = idFrom(req.params.storeId, "That store");
  const { rows } = await query("SELECT * FROM stores WHERE id = $1 AND active", [id]);
  if (!rows[0]) throw new HttpError(404, "That store was not found.");
  return rows[0];
}

/** The store, if the signed-in player may post its events. */
async function managedStore(req) {
  if (!req.user) throw new HttpError(401, "Please log in to continue.");
  const store = await activeStore(req);
  if (!canManage(req.user, store)) throw new HttpError(403, "Only the store's own account or an admin can change its events.");
  return store;
}

/** Sends a calendar file. Subscribed calendars and downloads both read this. */
function sendCalendar(res, store, events, filename) {
  res.set("Content-Disposition", `inline; filename="${filename}.ics"`);
  res.set("Cache-Control", "public, max-age=900");
  res.type("text/calendar; charset=utf-8").send(icsCalendar(store, events, siteUrl()));
}

// The store's upcoming events as a calendar people can subscribe to.
router.get("/events.ics", async (req, res) => {
  const store = await activeStore(req);
  sendCalendar(res, store, await upcomingEvents(store.id), `${slugify(store.name) || "store"}-events`);
});

// One event as a calendar file ("Add to calendar").
router.get("/events/:eventId.ics", async (req, res) => {
  const store = await activeStore(req);
  const { rows } = await query("SELECT * FROM store_events WHERE id = $1 AND store_id = $2", [idFrom(req.params.eventId, "That event"), store.id]);
  if (!rows[0]) throw new HttpError(404, "That event was not found.");
  sendCalendar(res, store, rows, `${slugify(rows[0].title) || "event"}`);
});

// Post an event, optionally repeating weekly (each week becomes its own event, so one can be changed alone).
router.post("/events", async (req, res) => {
  const store = await managedStore(req);
  const timeZone = timeZoneFor(store.city);
  const { values, fields } = readEvent(req.body, { timeZone });
  const weeks = readRepeat(req.body?.repeatWeeks);
  if (weeks === null) fields.repeatWeeks = "Repeat for 1 to 12 weeks.";
  checkFields(fields);
  const created = await tx(async (c) => {
    const { rows: count } = await c.query(`SELECT count(*)::int AS n FROM store_events e WHERE e.store_id = $1 AND ${UPCOMING}`, [store.id]);
    if (count[0].n + weeks > MAX_UPCOMING) throw new HttpError(400, `A store can list up to ${MAX_UPCOMING} upcoming events.`);
    const ids = [];
    for (let week = 0; week < weeks; week++) {
      // Same local time each week, even across a daylight saving change.
      const shifted = week === 0 ? values : readEvent({ ...req.body, date: nextDay(req.body.date, week * 7) }, { timeZone }).values;
      const { rows } = await c.query(
        `INSERT INTO store_events (store_id, title, kind, starts_at, ends_at, details, cost, link, cancelled, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [store.id, values.title, values.kind, shifted.starts_at, shifted.ends_at, values.details, values.cost, values.link, values.cancelled ?? false, req.user.id],
      );
      ids.push(rows[0].id);
    }
    await logAction(c, { actorId: req.user.id, action: "store_event_added", details: { storeId: store.id, eventIds: ids, title: values.title } });
    return (await c.query("SELECT * FROM store_events WHERE id = ANY($1) ORDER BY starts_at", [ids])).rows;
  });
  res.status(201).json({ events: created.map((e) => eventView(e, store.city)) });
});

// Edit an event, or mark it cancelled (it stays listed as cancelled, so subscribed calendars hear about it).
router.patch("/events/:eventId", async (req, res) => {
  const store = await managedStore(req);
  const id = idFrom(req.params.eventId, "That event");
  const { values, fields } = readEvent(req.body, { timeZone: timeZoneFor(store.city), partial: true });
  checkFields(fields);
  const keys = Object.keys(values);
  if (!keys.length) throw new HttpError(400, "Nothing to change.");
  const event = await tx(async (c) => {
    // Column names come from readEvent's fixed keys, never from the request.
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(", ");
    const { rows } = await c.query(`UPDATE store_events SET ${sets}, updated_at = now() WHERE id = $1 AND store_id = $2 RETURNING *`, [
      id,
      store.id,
      ...keys.map((k) => values[k]),
    ]);
    if (!rows[0]) throw new HttpError(404, "That event was not found.");
    await logAction(c, { actorId: req.user.id, action: "store_event_updated", details: { storeId: store.id, eventId: id, changes: values } });
    return rows[0];
  });
  res.json({ event: eventView(event, store.city) });
});

// Remove an event entirely (for mistakes; use "cancelled" for events that were called off).
router.delete("/events/:eventId", async (req, res) => {
  const store = await managedStore(req);
  const id = idFrom(req.params.eventId, "That event");
  await tx(async (c) => {
    const { rows } = await c.query("DELETE FROM store_events WHERE id = $1 AND store_id = $2 RETURNING title", [id, store.id]);
    if (!rows[0]) throw new HttpError(404, "That event was not found.");
    await logAction(c, { actorId: req.user.id, action: "store_event_removed", details: { storeId: store.id, eventId: id, title: rows[0].title } });
  });
  res.status(204).end();
});

export default router;
