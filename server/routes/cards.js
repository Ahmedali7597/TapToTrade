import { Router } from "express";
import { query, valuesList } from "../db.js";
import { HttpError, isUuid } from "../lib/http.js";
import { autocompleteNames, cardDetails, sample, searchPrintings, showcasePool } from "../lib/scryfall.js";
import { escapeLike } from "../lib/search.js";
import { printingView } from "../lib/views.js";
import { requireAuth } from "../middleware.js";

// Card data. Browsing cards, card details and the showcase are public (the Fan Content Policy asks for Magic
// content to be free to view without an account). The add-card printing search needs a signed-in player.
const router = Router();

// Order of the fields when we bulk-insert printings below.
const COLS = ["id", "name", "setCode", "setName", "collectorNumber", "imageUrl", "finishes"];

// Saves printings locally (multi-row upserts, 1000 at a time) so listings can reference them by id.
// Also used by collection import.
export async function cachePrintings(printings) {
  for (let start = 0; start < printings.length; start += 1000) {
    const chunk = printings.slice(start, start + 1000);
    const values = valuesList(chunk.map((p) => COLS.map((c) => p[c])));
    await query(
      `INSERT INTO card_printings (id, name, set_code, set_name, collector_number, image_url, finishes)
       VALUES ${values.sql}
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, set_name = EXCLUDED.set_name,
         image_url = EXCLUDED.image_url, finishes = EXCLUDED.finishes, updated_at = now()`,
      values.params,
    );
  }
}

// The search box text, trimmed. Needs at least two characters to avoid huge result sets.
function readQuery(req) {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (q.length < 2) throw new HttpError(400, "Type at least two characters of the card name.");
  return q;
}

// Random cards for the home page and sign-in pages, different on every visit. Falls back to cards players have
// listed when Scryfall is unreachable; the client has its own small fallback list if both come up short.
router.get("/showcase", async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.query.count, 10) || 24, 1), 40);
  let cards;
  try {
    cards = sample(await showcasePool(), count);
  } catch (err) {
    console.warn(`Showcase pool unavailable, using local cards: ${err.message}`);
    const { rows } = await query("SELECT * FROM card_printings WHERE image_url IS NOT NULL ORDER BY random() LIMIT $1", [count]);
    cards = rows.map((r) => printingView(r));
  }
  res.set("Cache-Control", "no-store").json({ cards: cards.map(({ id, name, setCode, imageUrl }) => ({ id, name, setCode, imageUrl })) });
});

// Public card browser: each matching card once, plus how many players near and far have it shared for trade.
router.get("/browse", async (req, res) => {
  const q = readQuery(req);
  let cards;
  try {
    cards = await searchPrintings(q, { unique: "cards" });
  } catch (err) {
    console.warn(`Scryfall browse failed: ${err.message}`);
    throw new HttpError(503, "Card data from Scryfall isn't available right now. Please try again in a minute.");
  }
  const { rows } = await query(
    `SELECT p.name, count(DISTINCT i.owner_id)::int AS players
       FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id JOIN users u ON u.id = i.owner_id
      WHERE i.available AND u.status = 'active' AND p.name = ANY($1)
      GROUP BY p.name`,
    [cards.map((c) => c.name)],
  );
  const players = new Map(rows.map((r) => [r.name, r.players]));
  res.json({ cards: cards.map((c) => ({ ...c, players: players.get(c.name) ?? 0 })) });
});

// Suggestions while typing a card name (public, like the card browser): up to 10 names. If Scryfall can't be
// reached, names of cards already saved here are used instead. Fewer than two characters gets an empty list.
router.get("/autocomplete", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (q.length < 2) return res.json({ names: [] });
  let names;
  try {
    names = await autocompleteNames(q);
  } catch (err) {
    console.warn(`Scryfall autocomplete failed, using local names: ${err.message}`);
    const { rows } = await query("SELECT DISTINCT name FROM card_printings WHERE name ILIKE $1 || '%' ORDER BY name LIMIT 10", [escapeLike(q)]);
    names = rows.map((r) => r.name);
  }
  // Browsers may reuse an answer for an hour, so backspacing and retyping doesn't ask again.
  res.set("Cache-Control", "public, max-age=3600").json({ names: names.slice(0, 10) });
});

// Card name lookup for the "add a card" form.
router.get("/search", requireAuth, async (req, res) => {
  const q = readQuery(req);
  try {
    const printings = await searchPrintings(q);
    await cachePrintings(printings);
    res.json({ printings, source: "scryfall" });
  } catch (err) {
    console.warn(`Scryfall lookup failed, using local cache: ${err.message}`);
    const { rows } = await query(
      "SELECT * FROM card_printings WHERE name ILIKE '%' || $1 || '%' ORDER BY name, set_code LIMIT 40",
      [escapeLike(q)],
    );
    res.json({ printings: rows.map((r) => printingView(r)), source: "cache" });
  }
});

// Everything the zoomed-in card view shows: text, rulings, legalities, prices and links to Scryfall.
router.get("/:id", async (req, res) => {
  if (!isUuid(req.params.id)) throw new HttpError(404, "That card was not found.");
  let card;
  try {
    card = await cardDetails(req.params.id.toLowerCase());
  } catch (err) {
    console.warn(`Scryfall card lookup failed: ${err.message}`);
    throw new HttpError(503, "Card details from Scryfall aren't available right now. Please try again in a minute.");
  }
  if (!card) throw new HttpError(404, "That card was not found.");
  res.json({ card });
});

export default router;
