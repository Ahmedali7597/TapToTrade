import { Router } from "express";
import { query } from "../db.js";
import { HttpError, checkFields, idParam, isUuid } from "../lib/http.js";
import { loadReputation } from "../lib/reputation.js";
import { groupMatches, MAX_MATCH_PLAYERS, MAX_WANTS, readWantFields } from "../lib/wants.js";
import { requireAuth } from "../middleware.js";
import { citiesWithin, cityDistance, RADII } from "../../shared/cities.js";
import { itemView, PRINTING_COLUMNS, printingView, STORE_BADGE_COLUMN, storeBadge } from "../lib/views.js";

// Want lists (cards a player is looking for) and their automatic matches: nearby players who list a card
// you want, and nearby players who want a card you list. Everything here needs a signed-in player.
const router = Router();
router.use(requireAuth);

const WANT_SELECT = `
  SELECT w.id, w.quantity, w.finish, w.any_printing, w.created_at,
         ${PRINTING_COLUMNS}
    FROM want_items w JOIN card_printings p ON p.id = w.printing_id`;

const wantView = (r) => ({
  id: r.id,
  quantity: r.quantity,
  finish: r.finish,
  anyPrinting: r.any_printing,
  createdAt: r.created_at,
  printing: printingView(r, r.printing_id),
});

const getWant = async (id, userId) => (await query(`${WANT_SELECT} WHERE w.id = $1 AND w.user_id = $2`, [id, userId])).rows[0];

// The same card name already wanted in "any printing" mode would match the same listings twice.
async function assertNoOverlap(userId, printingId, anyPrinting, exceptId = 0) {
  const { rows } = await query(
    `SELECT 1 FROM want_items w JOIN card_printings p ON p.id = w.printing_id
      WHERE w.user_id = $1 AND w.id <> $4 AND p.name = (SELECT name FROM card_printings WHERE id = $2)
        AND (w.any_printing OR $3)`,
    [userId, printingId, anyPrinting, exceptId],
  );
  if (rows[0]) throw new HttpError(409, "That card is already on your want list. Edit it there instead.");
}

// The signed-in player's want list, alphabetical.
router.get("/", async (req, res) => {
  const { rows } = await query(`${WANT_SELECT} WHERE w.user_id = $1 ORDER BY p.name, p.set_code, w.id`, [req.user.id]);
  res.json({ wants: rows.map(wantView) });
});

// Add a card to the want list. Like inventory, the printing has to be one the card search already saved.
router.post("/", async (req, res) => {
  const { values, fields } = readWantFields(req.body);
  const printingId = req.body?.printingId;
  const notChosen = new HttpError(400, "Choose a card from the search results.", { printingId: "Choose a card." });
  if (!isUuid(printingId)) throw notChosen;
  checkFields(fields);
  const { rows: printing } = await query("SELECT finishes FROM card_printings WHERE id = $1", [printingId]);
  if (!printing[0]) throw notChosen;
  // Only an exact-printing want is limited to that printing's finishes; any printing can be any finish.
  if (values.finish && !values.anyPrinting && !printing[0].finishes.includes(values.finish)) {
    throw new HttpError(400, "This printing doesn't come in that finish.", { finish: "Not made in this finish." });
  }
  const { rows: count } = await query("SELECT count(*)::int AS n FROM want_items WHERE user_id = $1", [req.user.id]);
  if (count[0].n >= MAX_WANTS) throw new HttpError(400, `Want lists can hold up to ${MAX_WANTS} cards. Remove some you've found first.`);
  await assertNoOverlap(req.user.id, printingId, values.anyPrinting);
  const { rows } = await query(
    "INSERT INTO want_items (user_id, printing_id, any_printing, finish, quantity) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [req.user.id, printingId, values.anyPrinting, values.finish, values.quantity],
  ).catch((err) => {
    if (err.code === "23505") throw new HttpError(409, "That card is already on your want list. Edit it there instead.");
    throw err;
  });
  res.status(201).json({ want: wantView(await getWant(rows[0].id, req.user.id)) });
});

// Edit quantity, finish or printing mode. Fields left out stay as they are.
router.patch("/:id", async (req, res) => {
  const id = idParam(req, "That want");
  const { values, fields } = readWantFields(req.body, true);
  checkFields(fields);
  const current = await getWant(id, req.user.id);
  if (!current) throw new HttpError(404, "That want was not found.");
  const next = {
    quantity: values.quantity ?? current.quantity,
    finish: values.finish === undefined ? current.finish : values.finish,
    anyPrinting: values.anyPrinting ?? current.any_printing,
  };
  if (next.finish && !next.anyPrinting && !current.finishes.includes(next.finish)) {
    throw new HttpError(400, "This printing doesn't come in that finish.", { finish: "Not made in this finish." });
  }
  if (next.anyPrinting && !current.any_printing) await assertNoOverlap(req.user.id, current.printing_id, true, id);
  await query(
    "UPDATE want_items SET quantity = $3, finish = $4, any_printing = $5, updated_at = now() WHERE id = $1 AND user_id = $2",
    [id, req.user.id, next.quantity, next.finish, next.anyPrinting],
  );
  res.json({ want: wantView(await getWant(id, req.user.id)) });
});

router.delete("/:id", async (req, res) => {
  const { rowCount } = await query("DELETE FROM want_items WHERE id = $1 AND user_id = $2", [idParam(req, "That want"), req.user.id]);
  if (!rowCount) throw new HttpError(404, "That want was not found.");
  res.status(204).end();
});

// Listing columns plus the owner's city, for both directions of matching.
const LISTING_COLUMNS = `i.id, i.quantity, i.condition, i.finish, i.created_at, ${PRINTING_COLUMNS}, u.city`;

/**
 * Matches within the player's meetup range (or ?radius=, or 100 km): who nearby lists cards on your want list,
 * and who nearby wants cards you share. Only shared listings and active players count; cities only, never addresses.
 */
router.get("/matches", async (req, res) => {
  const radius = RADII.includes(Number(req.query.radius))
    ? Number(req.query.radius)
    : RADII.includes(req.user.travel_km)
      ? req.user.travel_km
      : 100;
  const cities = citiesWithin(req.user.city, radius);
  // Their shared listings that fill one of your wants. Same name, and the exact printing unless any will do.
  const theyHave = query(
    `SELECT DISTINCT ON (i.id) ${LISTING_COLUMNS}, i.owner_id AS player_id, w.id AS want_id
       FROM want_items w
       JOIN card_printings wp ON wp.id = w.printing_id
       JOIN card_printings p ON p.name = wp.name AND (w.any_printing OR p.id = w.printing_id)
       JOIN inventory_items i ON i.printing_id = p.id AND i.available AND (w.finish IS NULL OR i.finish = w.finish)
       JOIN users u ON u.id = i.owner_id AND u.status = 'active'
      WHERE w.user_id = $1 AND i.owner_id <> $1 AND u.city = ANY($2)
      ORDER BY i.id, w.id
      LIMIT 2000`,
    [req.user.id, cities],
  );
  // Your shared listings that are on someone else's want list.
  const theyWant = query(
    `SELECT DISTINCT ON (i.id, w.user_id) ${LISTING_COLUMNS}, w.user_id AS player_id, w.id AS want_id
       FROM inventory_items i
       JOIN card_printings p ON p.id = i.printing_id
       JOIN card_printings wp ON wp.name = p.name
       JOIN want_items w ON w.printing_id = wp.id AND (w.any_printing OR w.printing_id = p.id) AND (w.finish IS NULL OR w.finish = i.finish)
       JOIN users u ON u.id = w.user_id AND u.status = 'active'
      WHERE i.owner_id = $1 AND i.available AND w.user_id <> $1 AND u.city = ANY($2)
      ORDER BY i.id, w.user_id, w.id
      LIMIT 2000`,
    [req.user.id, cities],
  );
  const [have, want] = await Promise.all([theyHave, theyWant]);
  const ranked = groupMatches(have.rows, want.rows, (city) => cityDistance(req.user.city, city)).slice(0, MAX_MATCH_PLAYERS);

  // Names, ranges, store badges and reputation for the players who made the cut.
  const ids = ranked.map((p) => p.playerId);
  const [{ rows: people }, reputation] = await Promise.all([
    query(
      `SELECT u.id, u.username, u.city, u.travel_km,
              ${STORE_BADGE_COLUMN}
         FROM users u WHERE u.id = ANY($1)`,
      [ids],
    ),
    loadReputation(ids),
  ]);
  const byId = new Map(people.map((u) => [String(u.id), u]));
  const listing = (r) => ({ ...itemView({ ...r, available: true }), wantId: r.want_id });
  res.json({
    radius,
    city: req.user.city,
    players: ranked.map((p) => {
      const u = byId.get(String(p.playerId));
      return {
        player: {
          id: p.playerId,
          username: u.username,
          city: u.city,
          travelKm: u.travel_km,
          store: storeBadge(u.store),
          reputation: reputation.get(String(p.playerId)),
        },
        distanceKm: p.distanceKm,
        mutual: p.mutual,
        theyHave: p.theyHave.map(listing),
        theyWant: p.theyWant.map(listing),
      };
    }),
  });
});

export default router;
