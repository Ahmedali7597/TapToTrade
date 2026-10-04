import { Router } from "express";
import { query } from "../db.js";
import { HttpError } from "../lib/http.js";
import { buildCityCountsQuery, buildSearchQuery, PAGE_SIZE, parseSearchParams, searchOrigin } from "../lib/search.js";
import { cityDistance } from "../../shared/cities.js";
import { itemView, storeBadge } from "../lib/views.js";
import { listItems } from "./inventory.js";
import { loadReputation } from "../lib/reputation.js";

// Card search (4.4.1–4.4.4) and public profiles (4.2.1). Open to visitors too, so people can see who has a
// card before signing up; a signed-in player's own listings are left out of their results.
const router = Router();

// Search everyone else's shared listings, with filters and paging.
router.get("/search", async (req, res) => {
  const filters = parseSearchParams(req.query);
  const { sql, params } = buildSearchQuery(filters, req.user?.id, req.user?.city);
  const { rows } = await query(sql, params);
  const origin = searchOrigin(filters, req.user?.city);
  // Every row carries the same total (window function), so just read it off the first one.
  const total = Number(rows[0]?.total ?? 0);
  const reputation = await loadReputation([...new Set(rows.map((r) => r.owner_id))]);
  res.json({
    results: rows.map((r) => ({
      ...itemView({ ...r, available: true }),
      owner: {
        id: r.owner_id,
        username: r.username,
        city: r.city,
        travelKm: r.travel_km,
        store: storeBadge(r.store),
        reputation: reputation.get(String(r.owner_id)),
      },
      // City-centre to city-centre, from the searched city (or the viewer's own city).
      distanceKm: cityDistance(origin, r.city),
    })),
    origin,
    filters,
    page: filters.page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});

// Same filters, totalled per city, for the map view. Cities only, so nobody's address is ever exposed.
router.get("/search/cities", async (req, res) => {
  const { sql, params } = buildCityCountsQuery(parseSearchParams(req.query), req.user?.id);
  res.json({ cities: (await query(sql, params)).rows });
});

// Public profile: username, city, reputation and intentionally shared inventory only. No email, role or report counts.
router.get("/users/:username", async (req, res) => {
  const { rows } = await query(
    "SELECT id, username, city, travel_km, created_at FROM users WHERE lower(username) = lower($1) AND status = 'active'",
    [req.params.username],
  );
  if (!rows[0]) throw new HttpError(404, "That player was not found.");
  const u = rows[0];
  const { rows: store } = await query("SELECT id, name FROM stores WHERE account_user_id = $1 AND active", [u.id]);
  res.json({
    user: {
      id: u.id,
      username: u.username,
      city: u.city,
      travelKm: u.travel_km,
      distanceKm: req.user ? cityDistance(req.user.city, u.city) : null,
      memberSince: u.created_at,
      store: storeBadge(store[0]),
      reputation: (await loadReputation([u.id])).get(String(u.id)),
    },
    inventory: await listItems(u.id, { availableOnly: true }),
  });
});

export default router;
