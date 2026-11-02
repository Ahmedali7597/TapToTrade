import { Router } from "express";
import { query } from "../db.js";
import { buildPool, commanderProblem, front, lookupNames, poolCard } from "../lib/cedh.js";
import { parseDeckList } from "../lib/deckList.js";
import { HttpError } from "../lib/http.js";
import { storeBadge, STORE_BADGE_COLUMN } from "../lib/views.js";
import { optimizerLimiter, requireAuth } from "../middleware.js";
import { cityDistance } from "../../shared/cities.js";
import { MAX_DECK_ROWS } from "../../shared/decks.js";

// The Commander deck optimizer's data. The server checks the commander and gathers the candidate pool and combos
// (Scryfall, EDHREC, Commander Spellbook, all free); the page itself runs the optimizer (shared/optimizer.js), so
// moving the budget slider never asks the server again. Signed-in players only: each new commander means a few
// dozen requests to those services.
const router = Router();
router.use(requireAuth);

const unavailable = (err) => {
  console.warn(`Optimizer data unavailable: ${err.message}`);
  return new HttpError(503, "Card data from Scryfall, EDHREC or Commander Spellbook isn't available right now. Please try again in a few minutes.");
};

/**
 * { commanders: ["name", ...], text: "decklist" } -> the locked commanders, the player's 99 as pool names, lines
 * we couldn't read, and the pool and combos. A Commander section in the list is only used when no commander is
 * chosen: the chosen commander always wins, and copies of it in the 99 are dropped.
 */
router.post("/analyze", optimizerLimiter, async (req, res) => {
  const { rows, skipped } = parseDeckList(req.body?.text);
  if (rows.length > MAX_DECK_ROWS) throw new HttpError(400, `A decklist can have up to ${MAX_DECK_ROWS} lines.`);
  let names = Array.isArray(req.body?.commanders) ? req.body.commanders.filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim().slice(0, 200)) : [];
  if (!names.length) names = rows.filter((r) => r.board === "commander").map((r) => r.name);
  if (!names.length) throw new HttpError(400, "Choose your commander first.", { commander: "Choose your commander." });
  if (names.length > 2) throw new HttpError(400, "Choose one commander, or two partners.", { commander: "Choose one commander, or two partners." });

  let found;
  try {
    found = await lookupNames(names);
  } catch (err) {
    throw unavailable(err);
  }
  const commanders = names.map((n) => found.get(front(n)));
  const unknown = names.find((n, i) => !commanders[i]);
  if (unknown) throw new HttpError(400, `Scryfall doesn't know a card called "${unknown}".`, { commander: `Scryfall doesn't know a card called "${unknown}".` });
  const problem = commanderProblem(commanders);
  if (problem) throw new HttpError(400, problem, { commander: problem });

  const main = rows.filter((r) => r.board === "main");
  let data;
  try {
    data = await buildPool(commanders, main.map((r) => r.name));
  } catch (err) {
    throw unavailable(err);
  }
  const commanderNames = commanders.map((c) => c.name);
  const byFront = new Map(data.pool.map((c) => [front(c.name), c.name]));
  const original = [];
  for (const r of main) {
    const name = byFront.get(front(r.name));
    if (!name) skipped.push({ line: r.line, name: r.name, reason: "Scryfall doesn't know this card." });
    else if (commanderNames.includes(name)) skipped.push({ line: r.line, name: r.name, reason: "This is your commander: it lives in the command zone, not in the 99." });
    else original.push(...Array(r.quantity).fill(name));
  }
  // Only cards the optimizer may add, plus the player's own (even illegal ones, so the page can say why they go).
  const mine = new Set([...original, ...commanderNames]);
  const pool = data.pool.filter((c) => (c.legal && c.inIdentity) || mine.has(c.name));
  res.json({
    commanders: commanderNames.map((n) => data.pool.find((c) => c.name === n) ?? poolCard(commanders[commanderNames.indexOf(n)], data.identity, data.rate.usdCad)),
    identity: data.identity,
    original,
    skipped: skipped.sort((a, b) => a.line - b.line).slice(0, 100),
    pool,
    combos: data.combos,
    rate: data.rate,
    strategy: data.strategy,
    sources: data.sources,
  });
});

/**
 * { names: [...] } -> real TapToTrade listings for those cards: other players' shared copies, nearest first, at most
 * five per card. Listings are for trading, so they have no asking price; the page shows the market estimate beside them.
 */
router.post("/listings", async (req, res) => {
  const names = Array.isArray(req.body?.names) ? [...new Set(req.body.names.filter((n) => typeof n === "string").map((n) => n.slice(0, 200)))].slice(0, 120) : [];
  if (!names.length) return res.json({ listings: {} });
  const { rows } = await query(
    `SELECT i.id, i.quantity, i.condition, i.finish, p.name, p.set_code, p.collector_number, u.username, u.city, ${STORE_BADGE_COLUMN}
       FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id JOIN users u ON u.id = i.owner_id
      WHERE i.available AND u.status = 'active' AND u.id <> $1 AND p.name = ANY($2::text[])`,
    [req.user.id, names],
  );
  const listings = {};
  for (const r of rows) {
    (listings[r.name] ??= []).push({
      itemId: r.id,
      quantity: r.quantity,
      condition: r.condition,
      finish: r.finish,
      printing: `${r.set_code.toUpperCase()} #${r.collector_number}`,
      owner: { username: r.username, city: r.city, store: storeBadge(r.store) },
      distanceKm: cityDistance(req.user.city, r.city),
    });
  }
  for (const name of Object.keys(listings)) {
    const all = listings[name].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    listings[name] = { total: all.length, nearest: all.slice(0, 5) };
  }
  res.json({ listings });
});

export default router;
