// API shapes: how database rows become the JSON the React app receives (snake_case columns -> camelCase fields),
// plus the SQL column lists those shapes read. Used by several routes, so every response describes a card,
// a listing or a store the same way.
import { storePath } from "../../shared/stores.js";

// The card_printings columns printingView reads, for queries that join printings (alias p) onto listings or wants.
// The printing's id comes back as printing_id so it can't clash with the listing's own id.
export const PRINTING_COLUMNS = "p.id AS printing_id, p.name, p.set_code, p.set_name, p.collector_number, p.image_url, p.finishes";

/**
 * A card printing, from a card_printings row (the same shape scryfall.toPrinting gives).
 * Rows from the joined queries above pass their printing_id as `id`.
 * Use rows.map((r) => printingView(r)), not rows.map(printingView): map's second argument is the index.
 */
export const printingView = (r, id = r.id) => ({
  id,
  name: r.name,
  setCode: r.set_code,
  setName: r.set_name,
  collectorNumber: r.collector_number,
  imageUrl: r.image_url,
  finishes: r.finishes,
});

/** One inventory listing joined with its printing. */
export const itemView = (r) => ({
  id: r.id,
  quantity: r.quantity,
  condition: r.condition,
  finish: r.finish,
  available: r.available,
  printing: printingView(r, r.printing_id),
});

// The partner store a player runs, if any, as one JSON value named `store` (a player runs at most one store).
// Needs the player's users row aliased as u.
export const STORE_BADGE_COLUMN =
  "(SELECT json_build_object('id', st.id, 'name', st.name) FROM stores st WHERE st.account_user_id = u.id AND st.active) AS store";

/** The "official store account" badge beside a player's name: { id, name, path }, or null. */
export const storeBadge = (s) => (s ? { id: s.id, name: s.name, path: storePath(s) } : null);
