import { Router } from "express";
import { query, tx, valuesList } from "../db.js";
import { identifierFor } from "../lib/collectionImport.js";
import { parseDeckList } from "../lib/deckList.js";
import { commanderSuggestions } from "../lib/edhrec.js";
import { HttpError, checkFields, idFrom, idParam, isUuid } from "../lib/http.js";
import { lookupCollection } from "../lib/scryfall.js";
import { hasSlur, SLUR_MESSAGE } from "../lib/slurs.js";
import { PRINTING_COLUMNS, printingView } from "../lib/views.js";
import { MAX_WANTS } from "../lib/wants.js";
import { importLimiter, requireAuth } from "../middleware.js";
import { BOARDS, deckText, FORMATS, MAX_DECK_ROWS, MAX_DECKS, VISIBILITY } from "../../shared/decks.js";
import { cachePrintings, fillCardDetails } from "./cards.js";

// Deck building (after Moxfield). A deck belongs to one player; private decks are theirs alone, unlisted ones open
// to anyone with the link, public ones are also listed on their profile. Viewing a shared deck needs no account
// (Fan Content Policy); everything that changes a deck needs its owner.
const router = Router();

const BOARD_KEYS = BOARDS.map(([b]) => b);
const FORMAT_KEYS = FORMATS.map(([f]) => f);

/** Validates { name, format, description, visibility }; `partial` lets PATCH leave fields out. */
export function readDeckFields(body = {}, partial = false) {
  const out = {};
  const fields = {};
  if (!partial || body.name !== undefined) {
    out.name = typeof body.name === "string" ? body.name.trim() : "";
    if (!out.name || out.name.length > 100) fields.name = "Give the deck a name of up to 100 characters.";
    else if (hasSlur(out.name)) fields.name = SLUR_MESSAGE;
  }
  if (!partial || body.format !== undefined) {
    out.format = body.format ?? "commander";
    if (!FORMAT_KEYS.includes(out.format)) fields.format = "Choose a format.";
  }
  if (body.description !== undefined || !partial) {
    out.description = typeof body.description === "string" ? body.description.trim() : "";
    if (out.description.length > 2000) fields.description = "Keep the description under 2,000 characters.";
    else if (hasSlur(out.description)) fields.description = SLUR_MESSAGE;
  }
  if (!partial || body.visibility !== undefined) {
    out.visibility = body.visibility ?? "private";
    if (!VISIBILITY.some(([v]) => v === out.visibility)) fields.visibility = "Choose who can see the deck.";
  }
  checkFields(fields);
  return out;
}

const deckView = (d) => ({
  id: d.id,
  name: d.name,
  format: d.format,
  description: d.description,
  visibility: d.visibility,
  updatedAt: d.updated_at,
  owner: { id: d.owner_id, username: d.username },
});

/** The deck if `viewer` may see it (owner, or not private), else a 404 that doesn't reveal private decks. */
async function loadDeck(id, viewer) {
  const { rows } = await query("SELECT d.*, u.username FROM decks d JOIN users u ON u.id = d.owner_id WHERE d.id = $1 AND u.status = 'active'", [id]);
  const d = rows[0];
  if (!d || (d.visibility === "private" && d.owner_id !== viewer?.id)) throw new HttpError(404, "That deck was not found.");
  return d;
}
async function ownDeck(req) {
  const d = await loadDeck(idParam(req, "That deck"), req.user);
  if (d.owner_id !== req.user.id) throw new HttpError(403, "Only the deck's owner can change it.");
  return d;
}
const touch = (c, deckId) => c.query("UPDATE decks SET updated_at = now() WHERE id = $1", [deckId]);

const CARD_SELECT = `SELECT c.id, c.board, c.quantity, ${PRINTING_COLUMNS} FROM deck_cards c JOIN card_printings p ON p.id = c.printing_id`;
const cardView = (r) => ({ id: r.id, board: r.board, quantity: r.quantity, printing: printingView(r, r.printing_id) });
const listCards = async (deckId) => (await query(`${CARD_SELECT} WHERE c.deck_id = $1 ORDER BY p.name, c.id`, [deckId])).rows.map(cardView);

/** Adds `quantity` of a printing to a board (or more copies to a row already there), capped at 99. */
async function addCard(c, deckId, printingId, board, quantity) {
  const { rows } = await c.query(
    `INSERT INTO deck_cards (deck_id, printing_id, board, quantity) VALUES ($1, $2, $3, $4)
     ON CONFLICT (deck_id, printing_id, board) DO UPDATE SET quantity = LEAST(99, deck_cards.quantity + EXCLUDED.quantity)
     RETURNING id`,
    [deckId, printingId, board, quantity],
  );
  return rows[0].id;
}
async function checkRoom(deckId, adding = 1) {
  const { rows } = await query("SELECT count(*)::int AS n FROM deck_cards WHERE deck_id = $1", [deckId]);
  if (rows[0].n + adding > MAX_DECK_ROWS) throw new HttpError(400, `A deck can hold up to ${MAX_DECK_ROWS} different cards.`);
}

// ---- Decks ----

/** Deck tiles (name, format, card count, a cover card and the commander's colours) for decks matching `where`. */
async function deckTiles(where, params, limit = 200) {
  const { rows } = await query(
    `SELECT d.id, d.name, d.format, d.visibility, d.updated_at, u.username,
            COALESCE(sum(c.quantity) FILTER (WHERE c.board IN ('commander', 'main')), 0)::int AS cards,
            (array_agg(p.image_url ORDER BY c.board = 'commander' DESC, c.id) FILTER (WHERE p.image_url IS NOT NULL))[1] AS cover,
            -- A subquery, not a join: joining the colours repeated the commander's row once per colour in the count.
            COALESCE((SELECT array_agg(DISTINCT col ORDER BY col) FROM deck_cards x JOIN card_printings xp ON xp.id = x.printing_id,
                             unnest(xp.color_identity) AS col WHERE x.deck_id = d.id AND x.board = 'commander'), '{}') AS colors
       FROM decks d
       LEFT JOIN deck_cards c ON c.deck_id = d.id
       LEFT JOIN card_printings p ON p.id = c.printing_id
       JOIN users u ON u.id = d.owner_id
      WHERE ${where}
      GROUP BY d.id, u.username ORDER BY d.updated_at DESC LIMIT ${Number(limit)}`,
    params,
  );
  return rows.map((d) => ({
    id: d.id,
    name: d.name,
    format: d.format,
    visibility: d.visibility,
    updatedAt: d.updated_at,
    owner: { username: d.username },
    cards: d.cards,
    cover: d.cover,
    colors: d.colors,
  }));
}

// The signed-in player's decks, newest first.
router.get("/", requireAuth, async (req, res) => {
  res.json({ decks: await deckTiles("d.owner_id = $1", [req.user.id]) });
});

// Recently updated public decks with at least one card, for anyone (the /decks page). Must come before /:id.
router.get("/public", async (req, res) => {
  const decks = await deckTiles("d.visibility = 'public' AND u.status = 'active' AND EXISTS (SELECT 1 FROM deck_cards x WHERE x.deck_id = d.id)", [], 24);
  res.json({ decks });
});

router.post("/", requireAuth, async (req, res) => {
  const f = readDeckFields(req.body);
  const { rows: count } = await query("SELECT count(*)::int AS n FROM decks WHERE owner_id = $1", [req.user.id]);
  if (count[0].n >= MAX_DECKS) throw new HttpError(400, `You can have up to ${MAX_DECKS} decks. Delete one you don't use first.`);
  const { rows } = await query(
    "INSERT INTO decks (owner_id, name, format, description, visibility) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [req.user.id, f.name, f.format, f.description, f.visibility],
  );
  res.status(201).json({ deck: deckView(await loadDeck(rows[0].id, req.user)) });
});

// One deck with its cards. A signed-in viewer also gets `owned`: how many copies of each card name they have in
// their own inventory (any printing), so the page can show what they'd still need to trade for.
router.get("/:id", async (req, res) => {
  const d = await loadDeck(idParam(req, "That deck"), req.user);
  let cards = await listCards(d.id);
  if (await fillCardDetails(cards.map((c) => c.printing))) cards = await listCards(d.id);
  let owned = null;
  if (req.user) {
    const { rows } = await query(
      `SELECT p.name, sum(i.quantity)::int AS n FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id
        WHERE i.owner_id = $1 AND p.name = ANY($2::text[]) GROUP BY p.name`,
      [req.user.id, [...new Set(cards.map((c) => c.printing.name))]],
    );
    owned = Object.fromEntries(rows.map((r) => [r.name, r.n]));
  }
  res.json({ deck: deckView(d), mine: d.owner_id === req.user?.id, cards, owned });
});

router.patch("/:id", requireAuth, async (req, res) => {
  const d = await ownDeck(req);
  const f = readDeckFields(req.body, true);
  await query(
    `UPDATE decks SET name = COALESCE($2, name), format = COALESCE($3, format), description = COALESCE($4, description),
            visibility = COALESCE($5, visibility), updated_at = now() WHERE id = $1`,
    [d.id, f.name ?? null, f.format ?? null, f.description ?? null, f.visibility ?? null],
  );
  res.json({ deck: deckView(await loadDeck(d.id, req.user)) });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const d = await ownDeck(req);
  await query("DELETE FROM decks WHERE id = $1", [d.id]);
  res.status(204).end();
});

// The decklist as text, for Moxfield, Archidekt, Arena or anywhere else that takes "1 Sol Ring (C21) 263".
router.get("/:id/export", async (req, res) => {
  const d = await loadDeck(idParam(req, "That deck"), req.user);
  const file = `${d.name.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "deck"}.txt`;
  res.attachment(file).type("text/plain").send(deckText(await listCards(d.id)));
});

// ---- Cards in a deck ----

/**
 * Add a card: { printingId } for an exact printing the card search saved, or { name } for Scryfall's default
 * printing of that card. `board` defaults to the main deck, `quantity` to 1.
 */
router.post("/:id/cards", requireAuth, async (req, res) => {
  const d = await ownDeck(req);
  const board = req.body?.board ?? "main";
  const quantity = req.body?.quantity === undefined ? 1 : Number(req.body.quantity);
  if (!BOARD_KEYS.includes(board)) throw new HttpError(400, "Choose a board.");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError(400, "Quantity must be a whole number from 1 to 99.");
  await checkRoom(d.id);
  let printingId = req.body?.printingId;
  if (printingId !== undefined) {
    if (!isUuid(printingId) || !(await query("SELECT 1 FROM card_printings WHERE id = $1", [printingId])).rows[0]) throw new HttpError(400, "Choose a card from the search results.");
  } else {
    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    if (!name) throw new HttpError(400, "Type a card name.");
    let found;
    try {
      found = await lookupCollection([["n", { name }]]);
    } catch (err) {
      console.warn(`Deck card lookup failed: ${err.message}`);
      throw new HttpError(503, "Card data from Scryfall isn't available right now. Please try again in a few minutes.");
    }
    const printing = found.get("n");
    if (!printing) throw new HttpError(404, `Scryfall doesn't know a card called "${name}".`);
    await cachePrintings([printing]);
    printingId = printing.id;
  }
  const id = await tx(async (c) => {
    const cardId = await addCard(c, d.id, printingId, board, quantity);
    await touch(c, d.id);
    return cardId;
  });
  res.status(201).json({ card: cardView((await query(`${CARD_SELECT} WHERE c.id = $1`, [id])).rows[0]) });
});

// Change a card's quantity or move it to another board (joining the copies already there).
router.patch("/:id/cards/:cardId", requireAuth, async (req, res) => {
  const d = await ownDeck(req);
  const cardId = idFrom(req.params.cardId, "That card");
  const { rows } = await query("SELECT * FROM deck_cards WHERE id = $1 AND deck_id = $2", [cardId, d.id]);
  const card = rows[0];
  if (!card) throw new HttpError(404, "That card isn't in this deck.");
  const quantity = req.body?.quantity === undefined ? card.quantity : Number(req.body.quantity);
  const board = req.body?.board ?? card.board;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new HttpError(400, "Quantity must be a whole number from 1 to 99.");
  if (!BOARD_KEYS.includes(board)) throw new HttpError(400, "Choose a board.");
  const id = await tx(async (c) => {
    let keep = card.id;
    if (board === card.board) await c.query("UPDATE deck_cards SET quantity = $2 WHERE id = $1", [card.id, quantity]);
    else {
      await c.query("DELETE FROM deck_cards WHERE id = $1", [card.id]);
      keep = await addCard(c, d.id, card.printing_id, board, quantity);
    }
    await touch(c, d.id);
    return keep;
  });
  res.json({ card: cardView((await query(`${CARD_SELECT} WHERE c.id = $1`, [id])).rows[0]) });
});

router.delete("/:id/cards/:cardId", requireAuth, async (req, res) => {
  const d = await ownDeck(req);
  const { rowCount } = await query("DELETE FROM deck_cards WHERE id = $1 AND deck_id = $2", [idFrom(req.params.cardId, "That card"), d.id]);
  if (!rowCount) throw new HttpError(404, "That card isn't in this deck.");
  await query("UPDATE decks SET updated_at = now() WHERE id = $1", [d.id]);
  res.status(204).end();
});

/**
 * Paste a decklist (Moxfield, Archidekt, Arena or MTGO text). `replace: true` swaps the whole deck for it;
 * otherwise the cards are added. Lines Scryfall can't match come back in `skipped`.
 */
router.post("/:id/import", requireAuth, importLimiter, async (req, res) => {
  const d = await ownDeck(req);
  const { rows, skipped } = parseDeckList(req.body?.text);
  if (!rows.length) throw new HttpError(400, 'Paste a decklist with lines like "1 Sol Ring" or "1 Sol Ring (C21) 263".');
  if (rows.length > MAX_DECK_ROWS) throw new HttpError(400, `A deck can hold up to ${MAX_DECK_ROWS} different cards.`);
  const byName = (r) => [`n:${r.name.toLowerCase()}`, { name: r.name }];
  let found;
  try {
    found = await lookupCollection([...new Map(rows.map((r) => identifierFor({ ...r, scryfallId: null })))]);
    const retry = rows.filter((r) => r.setCode && !found.get(identifierFor({ ...r, scryfallId: null })[0]));
    if (retry.length) for (const [k, p] of await lookupCollection([...new Map(retry.map(byName))])) found.set(k, p);
  } catch (err) {
    console.warn(`Deck import lookup failed: ${err.message}`);
    throw new HttpError(503, "Card data from Scryfall isn't available right now. Please try again in a few minutes.");
  }
  const lines = new Map();
  for (const r of rows) {
    const p = found.get(identifierFor({ ...r, scryfallId: null })[0]) ?? found.get(byName(r)[0]);
    if (!p) {
      skipped.push({ line: r.line, name: r.name, reason: "Scryfall doesn't know this card or printing." });
      continue;
    }
    const key = `${p.id}|${r.board}`;
    lines.set(key, { printing: p, board: r.board, quantity: Math.min(99, (lines.get(key)?.quantity ?? 0) + r.quantity) });
  }
  await cachePrintings([...new Map([...lines.values()].map((l) => [l.printing.id, l.printing])).values()]);
  await tx(async (c) => {
    if (req.body?.replace === true) await c.query("DELETE FROM deck_cards WHERE deck_id = $1", [d.id]);
    const all = [...lines.values()];
    if (all.length) {
      const values = valuesList(all.map((l) => [d.id, l.printing.id, l.board, l.quantity]));
      await c.query(
        `INSERT INTO deck_cards (deck_id, printing_id, board, quantity) VALUES ${values.sql}
         ON CONFLICT (deck_id, printing_id, board) DO UPDATE SET quantity = LEAST(99, deck_cards.quantity + EXCLUDED.quantity)`,
        values.params,
      );
    }
    const { rows: n } = await c.query("SELECT count(*)::int AS n FROM deck_cards WHERE deck_id = $1", [d.id]);
    if (n[0].n > MAX_DECK_ROWS) throw new HttpError(400, `A deck can hold up to ${MAX_DECK_ROWS} different cards.`);
    await touch(c, d.id);
  });
  skipped.sort((a, b) => a.line - b.line);
  res.json({ added: [...lines.values()].reduce((n, l) => n + l.quantity, 0), skippedCount: skipped.length, skipped: skipped.slice(0, 100) });
});

/**
 * Put every card the deck needs that the player doesn't own enough of on their want list (any printing), for
 * trading. Cards already on the want list are left as they are.
 */
router.post("/:id/want-missing", requireAuth, async (req, res) => {
  // Anyone who can see the deck may want its cards, not just its owner.
  const d = await loadDeck(idParam(req, "That deck"), req.user);
  const { rows: missing } = await query(
    `WITH need AS (SELECT p.name, min(c.printing_id::text)::uuid AS printing_id, sum(c.quantity)::int AS n
                     FROM deck_cards c JOIN card_printings p ON p.id = c.printing_id
                    WHERE c.deck_id = $1 AND c.board IN ('commander', 'main', 'side') AND p.type_line NOT LIKE '%Basic Land%'
                    GROUP BY p.name),
          have AS (SELECT p.name, sum(i.quantity)::int AS n FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id
                    WHERE i.owner_id = $2 GROUP BY p.name)
     SELECT need.name, need.printing_id, need.n - COALESCE(have.n, 0) AS short FROM need LEFT JOIN have USING (name)
      WHERE need.n > COALESCE(have.n, 0)
        AND NOT EXISTS (SELECT 1 FROM want_items w JOIN card_printings wp ON wp.id = w.printing_id WHERE w.user_id = $2 AND wp.name = need.name)
      ORDER BY need.name`,
    [d.id, req.user.id],
  );
  const { rows: count } = await query("SELECT count(*)::int AS n FROM want_items WHERE user_id = $1", [req.user.id]);
  const room = Math.max(0, MAX_WANTS - count[0].n);
  const adding = missing.slice(0, room);
  if (adding.length) {
    const values = valuesList(adding.map((m) => [req.user.id, m.printing_id, true, m.short]));
    await query(`INSERT INTO want_items (user_id, printing_id, any_printing, quantity) VALUES ${values.sql} ON CONFLICT DO NOTHING`, values.params);
  }
  res.json({ added: adding.length, full: missing.length > room });
});

// Printings for EDHREC's card names, kept for a day so paging through suggestions doesn't ask Scryfall again.
const suggestionPrintings = new Map();
async function printingsFor(names) {
  const fresh = (n) => {
    const hit = suggestionPrintings.get(n);
    return hit && Date.now() - hit.at < 86_400_000 ? hit.printing : undefined;
  };
  const missing = names.filter((n) => fresh(n) === undefined);
  if (missing.length) {
    const found = await lookupCollection(missing.map((n) => [n, { name: n }]));
    await cachePrintings([...found.values()]);
    for (const n of missing) suggestionPrintings.set(n, { at: Date.now(), printing: found.get(n) ?? null });
    if (suggestionPrintings.size > 5000) suggestionPrintings.clear(); // ponytail: crude cap, an LRU if it ever matters
  }
  return new Map(names.map((n) => [n, fresh(n)]));
}

/**
 * Card ideas for a Commander deck from EDHREC: its lists for the deck's commander (or partner pair), minus cards
 * already in the deck. `?list=<tag>` picks which list's cards come back with printings (the first one by default).
 */
router.get("/:id/suggestions", async (req, res) => {
  const d = await loadDeck(idParam(req, "That deck"), req.user);
  const cards = await listCards(d.id);
  const commanders = cards.filter((c) => c.board === "commander").map((c) => c.printing.name);
  if (!commanders.length) throw new HttpError(400, "Add a commander to the Commander board to get suggestions.");
  let page;
  try {
    page = await commanderSuggestions(commanders.slice(0, 2));
  } catch (err) {
    console.warn(`EDHREC unavailable: ${err.message}`);
    throw new HttpError(503, "EDHREC isn't answering right now. Please try again later.");
  }
  if (!page) return res.json({ url: null, lists: [], list: null });
  const inDeck = new Set(cards.map((c) => c.printing.name.toLowerCase()));
  // High synergy and top cards first (EDHREC's own page leads with brand-new cards, which are rarely the best picks).
  const first = ["highsynergycards", "topcards", "gamechangers"];
  const rank = (tag) => (first.includes(tag) ? first.indexOf(tag) : first.length);
  const lists = page.lists
    .map((l) => ({ ...l, cards: l.cards.filter((c) => !inDeck.has(c.name.toLowerCase())) }))
    .filter((l) => l.cards.length)
    .sort((a, b) => rank(a.tag) - rank(b.tag));
  const chosen = lists.find((l) => l.tag === req.query.list) ?? lists[0];
  let list = null;
  if (chosen) {
    let printings;
    try {
      printings = await printingsFor(chosen.cards.map((c) => c.name));
    } catch (err) {
      console.warn(`Suggestion printings lookup failed: ${err.message}`);
      throw new HttpError(503, "Card data from Scryfall isn't available right now. Please try again in a few minutes.");
    }
    list = { tag: chosen.tag, header: chosen.header, cards: chosen.cards.filter((c) => printings.get(c.name)).map((c) => ({ ...c, printing: printings.get(c.name) })) };
  }
  res.json({ url: page.url, lists: lists.map((l) => ({ tag: l.tag, header: l.header, count: l.cards.length })), list });
});

export default router;
