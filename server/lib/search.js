import { CITIES, CONDITIONS, FINISHES, parseQuantity } from "../../shared/validation.js";
import { citiesWithin, RADII, searchCities } from "../../shared/cities.js";
import { PRINTING_COLUMNS, STORE_BADGE_COLUMN } from "./views.js";

// Results per page on the search screen.
export const PAGE_SIZE = 20;

// Whitelisted ORDER BY clauses; the trailing id makes pagination deterministic.
// "distance" orders by the position of the owner's city in $8, a list of cities nearest first.
const SORTS = {
  name: "p.name ASC, p.set_code ASC, i.id ASC",
  quantity: "i.quantity DESC, p.name ASC, i.id ASC",
  newest: "i.created_at DESC, i.id DESC",
  distance: "array_position($8::text[], u.city) ASC NULLS LAST, p.name ASC, i.id ASC",
};

/** Escapes LIKE wildcards so user input is matched literally. */
export const escapeLike = (s) => s.replace(/[\\%_]/g, "\\$&");

/** Normalizes query-string filters (4.4.1–4.4.4). Unknown values fall back to safe defaults. */
export function parseSearchParams(q = {}) {
  const name = typeof q.name === "string" ? q.name.trim().slice(0, 100) : "";
  const page = Math.min(Math.max(parseInt(q.page, 10) || 1, 1), 500);
  const city = CITIES.includes(q.city) ? q.city : null;
  return {
    name,
    city,
    // Radius only means something around a city; without one it's ignored.
    radius: city && RADII.includes(Number(q.radius)) ? Number(q.radius) : null,
    minQty: parseQuantity(q.minQty) ?? 1,
    condition: CONDITIONS.includes(q.condition) ? q.condition : null,
    finish: FINISHES.includes(q.finish) ? q.finish : null,
    sort: SORTS[q.sort] ? q.sort : "name",
    page,
  };
}

/** Where distances are measured from: the searched city, or else the viewer's own city. */
export const searchOrigin = (filters, viewerCity = null) => filters.city ?? viewerCity;

// Shared WHERE clause. $2 is the list of allowed cities (null = anywhere): just the chosen city,
// or every listed city within the radius. Distances use city centres, never addresses.
function where({ name, city, radius, minQty, condition, finish }, viewerId) {
  const cities = searchCities(city, radius);
  const sql = `
      FROM inventory_items i
      JOIN card_printings p ON p.id = i.printing_id
      JOIN users u ON u.id = i.owner_id
     WHERE i.available AND u.status = 'active'
       AND ($1 = '' OR p.name ILIKE '%' || $1 || '%')
       AND ($2::text[] IS NULL OR u.city = ANY($2::text[]))
       AND i.quantity >= $3
       AND ($4::text IS NULL OR i.condition = $4)
       AND ($5::bigint IS NULL OR u.id <> $5)
       AND ($6::text IS NULL OR i.finish = $6)`;
  return { sql, params: [escapeLike(name), cities, minQty, condition, viewerId, finish] };
}

/** Builds a fully parameterized search query (5.1.2). Only the whitelisted sort is interpolated. */
export function buildSearchQuery(filters, viewerId = null, viewerCity = null) {
  // Only shared listings from active players, never the viewer's own cards (visitors see everyone's).
  // `store` is the partner store an owner runs, if any (at most one, so the subquery returns one row or none).
  // count(*) OVER () gives the total match count on every row, so we don't need a second COUNT query.
  const w = where(filters, viewerId);
  const sql = `
    SELECT i.id, i.quantity, i.condition, i.finish, i.created_at,
           ${PRINTING_COLUMNS},
           u.id AS owner_id, u.username, u.city, u.travel_km,
           ${STORE_BADGE_COLUMN},
           count(*) OVER () AS total
      ${w.sql}
     ORDER BY ${SORTS[filters.sort]}
     LIMIT ${PAGE_SIZE} OFFSET $7`;
  const params = [...w.params, (filters.page - 1) * PAGE_SIZE];
  // Postgres needs every numbered parameter to be used, so $8 is only sent with the distance sort.
  if (filters.sort === "distance") params.push(citiesWithin(searchOrigin(filters, viewerCity)));
  return { sql, params };
}

/** Same filters, counted per city, for the map. Not paginated: one row per city with matches. */
export function buildCityCountsQuery(filters, viewerId = null) {
  const w = where(filters, viewerId);
  return { sql: `SELECT u.city, count(*)::int AS listings, count(DISTINCT u.id)::int AS players ${w.sql} GROUP BY u.city`, params: w.params };
}
