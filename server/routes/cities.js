import { Router } from "express";
import { query } from "../db.js";
import { HttpError } from "../lib/http.js";
import { citiesWithin, cityFromSlug, cityPath } from "../../shared/cities.js";
import { CITY_RADIUS_KM, cityIndexable } from "../../shared/pages.js";
import { eventView, nextEvents } from "../lib/events.js";
import { SELECT as STORE_SELECT, storeView } from "./stores.js";

// City landing pages (/trade/hamilton-on): what's being traded near one city, for people who search for local
// trading. Counts and card names only, never usernames: profiles are kept out of search engines on purpose.
const router = Router();

// Players sharing cards and active partner stores, per city.
const ACTIVITY = `
  SELECT city, sum(players)::int AS players, sum(stores)::int AS stores FROM (
    SELECT u.city, count(DISTINCT u.id) AS players, 0 AS stores
      FROM inventory_items i JOIN users u ON u.id = i.owner_id
     WHERE i.available AND u.status = 'active' GROUP BY u.city
    UNION ALL
    SELECT city, 0, count(*) FROM stores WHERE active GROUP BY city
  ) t GROUP BY city`;

/** Cards are named on a city page only once this many players are nearby, so no single player's binder is spelled out. */
const MIN_PLAYERS_FOR_CARDS = 3;

/**
 * What's happening near `city`: players and listings within the radius, partner stores (nearest first), their next
 * events, and the cards most players there have shared. `localPlayers`/`localStores` count the city itself.
 */
export async function cityStats(city) {
  const near = citiesWithin(city, CITY_RADIUS_KM);
  const [{ rows: counts }, { rows: local }, { rows: storeRows }] = await Promise.all([
    query(
      `SELECT count(*)::int AS listings, count(DISTINCT u.id)::int AS players
         FROM inventory_items i JOIN users u ON u.id = i.owner_id
        WHERE i.available AND u.status = 'active' AND u.city = ANY($1::text[])`,
      [near],
    ),
    query(
      `SELECT count(DISTINCT u.id)::int AS players FROM inventory_items i JOIN users u ON u.id = i.owner_id
        WHERE i.available AND u.status = 'active' AND u.city = $1`,
      [city],
    ),
    query(`${STORE_SELECT} WHERE s.active AND s.city = ANY($1::text[]) ORDER BY s.featured DESC, s.name, s.id`, [near]),
  ]);
  // The store's own account name is left off too: these pages carry no usernames at all.
  const stores = storeRows.map((s) => ({ ...storeView(s, city), account: undefined })).sort((a, b) => a.distanceKm - b.distanceKm);
  const { players, listings } = counts[0];
  const cards =
    players >= MIN_PLAYERS_FOR_CARDS
      ? (
          await query(
            `SELECT p.name, count(DISTINCT i.owner_id)::int AS players
               FROM inventory_items i JOIN users u ON u.id = i.owner_id JOIN card_printings p ON p.id = i.printing_id
              WHERE i.available AND u.status = 'active' AND u.city = ANY($1::text[])
              GROUP BY p.name ORDER BY players DESC, p.name LIMIT 12`,
            [near],
          )
        ).rows
      : [];
  const byStore = stores.length ? await nextEvents(stores.map((s) => s.id)) : new Map();
  const events = stores
    .flatMap((s) => (byStore.get(String(s.id)) ?? []).map((e) => ({ ...eventView(e, s.city), store: { name: s.name, path: s.path } })))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 6);
  return {
    city,
    path: cityPath(city),
    radiusKm: CITY_RADIUS_KM,
    players,
    listings,
    localPlayers: local[0].players,
    localStores: stores.filter((s) => s.city === city).length,
    stores,
    events,
    cards,
  };
}

/** Cities whose pages are worth finding (cityIndexable), busiest first: for the sitemap and the "trade near you" links. */
export async function activeCities() {
  const { rows } = await query(ACTIVITY);
  const byCity = new Map(rows.map((r) => [r.city, r]));
  return rows
    .map(({ city, players: localPlayers, stores: localStores }) => {
      const players = citiesWithin(city, CITY_RADIUS_KM).reduce((n, c) => n + (byCity.get(c)?.players ?? 0), 0);
      return { city, path: cityPath(city), players, localPlayers, localStores };
    })
    .filter(cityIndexable)
    .sort((a, b) => b.players - a.players || b.localStores - a.localStores || a.city.localeCompare(b.city));
}

router.get("/", async (req, res) => {
  res.json({ cities: (await activeCities()).map(({ city, path, players, localStores }) => ({ city, path, players, stores: localStores })) });
});

router.get("/:slug", async (req, res) => {
  const city = cityFromSlug(req.params.slug);
  if (!city) throw new HttpError(404, "We don't have a page for that city.");
  const stats = await cityStats(city);
  res.json({ ...stats, indexable: cityIndexable(stats) });
});

export default router;
