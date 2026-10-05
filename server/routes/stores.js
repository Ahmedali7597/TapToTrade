import { Router } from "express";
import { query, tx } from "../db.js";
import { HttpError, checkFields, httpsLinkOrBlank, idParam } from "../lib/http.js";
import { requireRole } from "../middleware.js";
import { CITIES } from "../../shared/validation.js";
import { cityDistance, citiesWithin, RADII, searchCities } from "../../shared/cities.js";
import { STORE_TAGS, storeIdFromSlug, storePath } from "../../shared/stores.js";
import { logAction } from "../lib/audit.js";
import { canManage, eventView, nextEvents, upcomingEvents } from "../lib/events.js";

// Partner game stores: official, public meetup spots with their own pages (what they offer, a perk for
// Tap to Trade players, the account the store runs). Anyone can see the active ones; only admins add, edit or
// retire them, and each change is written to mod_actions (5.2.3).
const router = Router();

// Stores with the username of the player account the store runs (if it's still active).
const SELECT = `SELECT s.*, u.username AS account_username FROM stores s LEFT JOIN users u ON u.id = s.account_user_id AND u.status = 'active'`;
const TAGS = new Set(STORE_TAGS.map((t) => t.value));

/** API shape for a store, with its distance from `from` (a city) when one is given. */
const storeView = (s, from) => ({
  id: s.id,
  name: s.name,
  address: s.address,
  city: s.city,
  lat: s.lat,
  lng: s.lng,
  website: s.website,
  notes: s.notes,
  active: s.active,
  tags: s.tags ?? [],
  featured: s.featured,
  perk: s.perk,
  hours: s.hours,
  account: s.account_username ?? null,
  path: storePath(s),
  distanceKm: from ? cityDistance(from, s.city) : null,
});

/** Validates a store form. `partial` lets PATCH bodies omit fields. */
function readStore(body = {}, partial = false) {
  const fields = {};
  const out = {};
  const text = (key, min, max, label) => {
    if (partial && body[key] === undefined) return;
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (v.length < min || v.length > max) fields[key] = `${label} must be ${min}-${max} characters.`;
    else out[key] = v;
  };
  text("name", 2, 100, "Name");
  text("address", 5, 200, "Address");
  if (!partial || body.city !== undefined) {
    if (CITIES.includes(body.city)) out.city = body.city;
    else fields.city = "Choose the store's city from the list.";
  }
  // Optional exact position, e.g. copied from a map app. Both or neither.
  if (!partial || body.lat !== undefined || body.lng !== undefined) {
    const blank = (v) => v === undefined || v === null || v === "";
    if (blank(body.lat) && blank(body.lng)) [out.lat, out.lng] = [null, null];
    else {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= 41 && lat <= 84 && lng >= -142 && lng <= -52) [out.lat, out.lng] = [lat, lng];
      else fields.lat = "Enter a latitude and longitude in Canada, or leave both blank.";
    }
  }
  if (!partial || body.website !== undefined) {
    const website = httpsLinkOrBlank(body.website);
    if (website === undefined) fields.website = "Use a full https:// link, or leave it blank.";
    else out.website = website;
  }
  // Optional free text: blank means none.
  const optional = (key, max, message) => {
    if (partial && body[key] === undefined) return;
    const v = typeof body[key] === "string" ? body[key].trim() : "";
    if (v.length > max) fields[key] = message;
    else out[key] = v || null;
  };
  optional("notes", 500, "Keep the description under 500 characters.");
  optional("perk", 200, "Keep the member perk under 200 characters.");
  optional("hours", 300, "Keep the hours under 300 characters.");
  if (!partial || body.tags !== undefined) {
    const tags = Array.isArray(body.tags) ? [...new Set(body.tags)] : body.tags === undefined ? [] : null;
    if (tags && tags.every((t) => TAGS.has(t))) out.tags = tags;
    else fields.tags = "Choose tags from the list.";
  }
  if (body.featured !== undefined) {
    if (typeof body.featured === "boolean") out.featured = body.featured;
    else fields.featured = "Featured must be true or false.";
  }
  if (body.active !== undefined) {
    if (typeof body.active === "boolean") out.active = body.active;
    else fields.active = "Active must be true or false.";
  }
  checkFields(fields);
  return out;
}

/** The player account a store runs, from the admin form's username box ("" unlinks it). Adds account_user_id to `s`. */
async function readAccount(c, body, s) {
  if (body.accountUsername === undefined) return;
  const name = typeof body.accountUsername === "string" ? body.accountUsername.trim() : "";
  if (!name) {
    s.account_user_id = null;
    return;
  }
  const { rows } = await c.query("SELECT id FROM users WHERE lower(username) = lower($1) AND status = 'active'", [name]);
  if (!rows[0]) checkFields({ accountUsername: "No active player has that username." });
  s.account_user_id = rows[0].id;
}

/** Turns "another store already uses that account" into a field error. */
const accountTaken = (err) => {
  if (err.constraint === "stores_account_user_id_key") {
    return new HttpError(409, "Please fix the highlighted fields.", { accountUsername: "That player is already linked to another store." });
  }
  return err;
};

// Active stores, optionally near a city (within `radius` km, or that city only), nearest first.
router.get("/", async (req, res) => {
  const city = CITIES.includes(req.query.city) ? req.query.city : null;
  const radius = RADII.includes(Number(req.query.radius)) ? Number(req.query.radius) : null;
  const cities = searchCities(city, radius);
  const featured = req.query.featured === "1";
  const { rows } = await query(
    `${SELECT} WHERE s.active AND ($1::text[] IS NULL OR s.city = ANY($1::text[])) AND (NOT $2 OR s.featured)
      ORDER BY s.featured DESC, s.name, s.id LIMIT 500`,
    [cities, featured],
  );
  const from = city ?? req.user?.city;
  // The next couple of events at each store, for the directory.
  const events = await nextEvents(rows.map((s) => s.id));
  const stores = rows.map((s) => ({ ...storeView(s, from), nextEvents: (events.get(String(s.id)) ?? []).map((e) => eventView(e, s.city)) }));
  // Nearest first; stores at the same distance keep the featured-then-name order (sort is stable).
  stores.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  res.json({ stores });
});

// Admin list, retired stores included.
router.get("/all", requireRole("admin"), async (req, res) => {
  const { rows } = await query(`${SELECT} ORDER BY s.active DESC, s.city, s.name, s.id`);
  res.json({ stores: rows.map((s) => storeView(s)) });
});

// One store's public page: its details, upcoming events, and how many cards players have shared within 25 km of it.
// canManage says whether the viewer may post the store's events (an admin or the store's own account).
router.get("/:slug", async (req, res, next) => {
  const id = storeIdFromSlug(req.params.slug);
  if (!id) return next();
  const { rows } = await query(`${SELECT} WHERE s.id = $1 AND s.active`, [id]);
  if (!rows[0]) throw new HttpError(404, "That store was not found.");
  const near = citiesWithin(rows[0].city, 25);
  const { rows: counts } = await query(
    `SELECT count(*)::int AS listings, count(DISTINCT u.id)::int AS players
       FROM inventory_items i JOIN users u ON u.id = i.owner_id
      WHERE i.available AND u.status = 'active' AND u.city = ANY($1::text[])`,
    [near],
  );
  res.json({
    store: storeView(rows[0], req.user?.city),
    nearby: { radiusKm: 25, ...counts[0] },
    events: (await upcomingEvents(id)).map((e) => eventView(e, rows[0].city)),
    canManage: canManage(req.user, rows[0]),
  });
});

router.post("/", requireRole("admin"), async (req, res) => {
  const s = readStore(req.body);
  const store = await tx(async (c) => {
    await readAccount(c, req.body, s);
    const { rows } = await c.query(
      `INSERT INTO stores (name, address, city, lat, lng, website, notes, active, created_by, tags, featured, perk, hours, account_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
      [s.name, s.address, s.city, s.lat, s.lng, s.website, s.notes, s.active ?? true, req.user.id, s.tags, s.featured ?? false, s.perk, s.hours, s.account_user_id ?? null],
    ).catch((err) => {
      throw accountTaken(err);
    });
    await logAction(c, { actorId: req.user.id, action: "store_added", details: { storeId: rows[0].id, name: s.name, city: s.city } });
    return (await c.query(`${SELECT} WHERE s.id = $1`, [rows[0].id])).rows[0];
  });
  res.status(201).json({ store: storeView(store) });
});

// Edit or retire (active: false). Stores are never deleted, because past proposals may point at them.
router.patch("/:id", requireRole("admin"), async (req, res) => {
  const id = idParam(req, "That store");
  const s = readStore(req.body, true);
  const store = await tx(async (c) => {
    await readAccount(c, req.body, s);
    const keys = Object.keys(s);
    if (!keys.length) throw new HttpError(400, "Nothing to change.");
    // Column names come from readStore's and readAccount's fixed keys, never from the request.
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(", ");
    const { rows } = await c.query(`UPDATE stores SET ${sets}, updated_at = now() WHERE id = $1 RETURNING id`, [id, ...keys.map((k) => s[k])]).catch(
      (err) => {
        throw accountTaken(err);
      },
    );
    if (!rows[0]) throw new HttpError(404, "That store was not found.");
    await logAction(c, { actorId: req.user.id, action: "store_updated", details: { storeId: id, changes: s } });
    return (await c.query(`${SELECT} WHERE s.id = $1`, [id])).rows[0];
  });
  res.json({ store: storeView(store) });
});

export default router;
