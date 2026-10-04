import { Router } from "express";
import { query, tx, valuesList } from "../db.js";
import { identifierFor, MAX_ROWS, parseCollection } from "../lib/collectionImport.js";
import { HttpError, checkFields, idParam, isUuid } from "../lib/http.js";
import { lookupCollection } from "../lib/scryfall.js";
import { importLimiter, requireAuth } from "../middleware.js";
import { CONDITIONS, FINISH_LABELS, FINISHES, parseQuantity } from "../../shared/validation.js";
import { itemView, PRINTING_COLUMNS } from "../lib/views.js";
import { cachePrintings } from "./cards.js";

// Inventory CRUD (4.3.1–4.3.4). Every statement filters by owner_id, so users can only touch their own rows.
const router = Router();
router.use(requireAuth);

// Columns every inventory query selects, so the list, add and edit responses all look the same.
const ITEM_COLUMNS = `i.id, i.quantity, i.condition, i.finish, i.available, i.created_at, ${PRINTING_COLUMNS}`;

// A player's listings, sorted like a binder. Profiles pass availableOnly so hidden cards stay private.
export async function listItems(ownerId, { availableOnly = false } = {}) {
  const { rows } = await query(
    `SELECT ${ITEM_COLUMNS} FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id
      WHERE i.owner_id = $1 AND (NOT $2 OR i.available)
      ORDER BY p.name, p.set_code, i.condition, i.finish, i.id`,
    [ownerId, availableOnly],
  );
  return rows.map(itemView);
}

// Fetch one listing, but only if it belongs to ownerId.
async function getItem(id, ownerId) {
  const { rows } = await query(
    `SELECT ${ITEM_COLUMNS} FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id
      WHERE i.id = $1 AND i.owner_id = $2`,
    [id, ownerId],
  );
  return rows[0];
}

/** Validates the editable fields; `partial` lets PATCH bodies omit fields. */
export function readItemFields(body = {}, partial = false) {
  const fields = {};
  const out = {};
  if (!partial || body.quantity !== undefined) {
    out.quantity = parseQuantity(body.quantity);
    if (out.quantity === null) fields.quantity = "Quantity must be a whole number from 1 to 9999.";
  }
  if (!partial || body.condition !== undefined) {
    out.condition = body.condition ?? "NM";
    if (!CONDITIONS.includes(out.condition)) fields.condition = "Choose a valid condition.";
  }
  // Finish is optional on create: when it's left out, the route picks the printing's first finish.
  if (body.finish !== undefined) {
    out.finish = body.finish;
    if (!FINISHES.includes(out.finish)) fields.finish = "Choose a valid finish.";
  }
  if (!partial || body.available !== undefined) {
    out.available = body.available ?? true;
    if (typeof out.available !== "boolean") fields.available = "Availability must be true or false.";
  }
  checkFields(fields);
  return out;
}

/** Rejects a finish the printing was never made in, e.g. an etched-foil Black Lotus. */
function checkFinish(finish, finishes) {
  if (!finishes.includes(finish)) {
    const message = `This printing doesn't come in ${FINISH_LABELS[finish].toLowerCase()}.`;
    throw new HttpError(400, message, { finish: message });
  }
}

const DUPLICATE = "You already list this printing in that condition and finish.";

// The signed-in user's whole inventory, hidden listings included.
router.get("/", async (req, res) => {
  res.json({ items: await listItems(req.user.id) });
});

// Add a card. The printing has to be one the card search already saved, and the finish has to exist for it.
router.post("/", async (req, res) => {
  const { quantity, condition, finish: chosen, available } = readItemFields(req.body);
  const printingId = req.body?.printingId;
  const notChosen = new HttpError(400, "Choose a card printing from the search results.", { printingId: "Choose a printing." });
  if (!isUuid(printingId)) throw notChosen;
  const { rows: printing } = await query("SELECT finishes FROM card_printings WHERE id = $1", [printingId]);
  if (!printing[0]) throw notChosen;
  const finish = chosen ?? printing[0].finishes[0];
  checkFinish(finish, printing[0].finishes);

  const { rows } = await query(
    `INSERT INTO inventory_items (owner_id, printing_id, quantity, condition, finish, available)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [req.user.id, printingId, quantity, condition, finish, available],
  ).catch((err) => {
    // 23505 = unique violation: same printing, condition and finish already listed.
    if (err.code === "23505") throw new HttpError(409, `${DUPLICATE} Edit its quantity instead.`);
    throw err;
  });
  res.status(201).json({ item: itemView(await getItem(rows[0].id, req.user.id)) });
});

/**
 * Collection import from Moxfield, Archidekt, ManaBox, Deckbox, TCGplayer, Dragon Shield and others,
 * or a plain text list. Cards already listed in the same printing, condition and finish are added to
 * (capped at 9999); new listings get the chosen visibility. Unmatched rows come back in `skipped`.
 */
router.post("/import", importLimiter, async (req, res) => {
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (!text.trim()) throw new HttpError(400, "Choose a file or paste your list first.");
  const available = req.body?.available !== false;
  const { format, rows, skipped } = parseCollection(text);
  if (rows.length > MAX_ROWS) throw new HttpError(400, `Imports are limited to ${MAX_ROWS} rows. Split the file and import it in parts.`);
  if (!rows.length) throw new HttpError(400, "We couldn't find any cards in that. Check it's a collection export or a list like \"4 Lightning Bolt\".");

  // One Scryfall lookup per distinct card/printing, then save the printings locally.
  let found;
  try {
    found = await lookupCollection([...new Map(rows.map(identifierFor))]);
  } catch (err) {
    console.warn(`Collection import lookup failed: ${err.message}`);
    throw new HttpError(503, "Card data from Scryfall isn't available right now. Please try the import again in a few minutes.");
  }
  await cachePrintings([...new Map([...found.values()].map((p) => [p.id, p])).values()]);

  // Merge rows that land on the same listing (e.g. the same card in two binders).
  const listings = new Map();
  let nameOnly = 0;
  let adjustedFinish = 0;
  for (const row of rows) {
    const printing = found.get(identifierFor(row)[0]);
    if (!printing) {
      skipped.push({ line: row.line, name: row.name, reason: "Scryfall doesn't know this card or printing." });
      continue;
    }
    if (!row.scryfallId && !row.setCode) nameOnly += row.quantity; // no set given, so Scryfall picked the printing
    let finish = row.finish;
    if (!printing.finishes.includes(finish)) {
      finish = printing.finishes[0];
      adjustedFinish += row.quantity;
    }
    const key = `${printing.id}|${row.condition}|${finish}`;
    const quantity = Math.min(9999, (listings.get(key)?.quantity ?? 0) + row.quantity);
    listings.set(key, { printingId: printing.id, condition: row.condition, finish, quantity });
  }

  const all = [...listings.values()];
  await tx(async (c) => {
    for (let start = 0; start < all.length; start += 500) {
      const chunk = all.slice(start, start + 500);
      const values = valuesList(chunk.map((l) => [req.user.id, l.printingId, l.quantity, l.condition, l.finish, available]));
      await c.query(
        `INSERT INTO inventory_items (owner_id, printing_id, quantity, condition, finish, available)
         VALUES ${values.sql}
         ON CONFLICT (owner_id, printing_id, condition, finish)
         DO UPDATE SET quantity = LEAST(9999, inventory_items.quantity + EXCLUDED.quantity), updated_at = now()`,
        values.params,
      );
    }
  });

  skipped.sort((a, b) => a.line - b.line);
  res.json({
    format,
    listings: all.length,
    cards: all.reduce((sum, l) => sum + l.quantity, 0),
    nameOnly,
    adjustedFinish,
    skippedCount: skipped.length,
    skipped: skipped.slice(0, 200),
  });
});

// Moxfield's column names and wording; Archidekt, ManaBox and most other sites import this format too.
const EXPORT_CONDITIONS = { NM: "Near Mint", LP: "Good (Lightly Played)", MP: "Played", HP: "Heavily Played", DMG: "Damaged" };
const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Download your whole inventory as a CSV to take it to another site.
router.get("/export", async (req, res) => {
  const header = ["Count", "Tradelist Count", "Name", "Edition", "Condition", "Language", "Foil", "Tags", "Last Modified", "Collector Number", "Alter", "Proxy", "Purchase Price"];
  const lines = (await listItems(req.user.id)).map((i) =>
    [
      i.quantity,
      i.available ? i.quantity : 0,
      i.printing.name,
      i.printing.setCode,
      EXPORT_CONDITIONS[i.condition],
      "English",
      i.finish === "nonfoil" ? "" : i.finish,
      "",
      "",
      i.printing.collectorNumber,
      "False",
      "False",
      "",
    ].map(csvCell).join(","),
  );
  res.attachment("taptotrade-collection.csv").type("text/csv").send([header.join(","), ...lines].join("\r\n") + "\r\n");
});

// Edit quantity, condition, finish or visibility. COALESCE keeps any field the request left out.
router.patch("/:id", async (req, res) => {
  const id = idParam(req);
  const f = readItemFields(req.body, true);
  // Load the listing first: it proves ownership and tells us which finishes the printing allows.
  const current = await getItem(id, req.user.id);
  if (!current) throw new HttpError(404, "That listing was not found.");
  if (f.finish) checkFinish(f.finish, current.finishes);
  await query(
    `UPDATE inventory_items SET quantity = COALESCE($3, quantity), condition = COALESCE($4, condition),
            finish = COALESCE($5, finish), available = COALESCE($6, available), updated_at = now()
      WHERE id = $1 AND owner_id = $2`,
    [id, req.user.id, f.quantity ?? null, f.condition ?? null, f.finish ?? null, f.available ?? null],
  ).catch((err) => {
    if (err.code === "23505") throw new HttpError(409, DUPLICATE);
    throw err;
  });
  res.json({ item: itemView(await getItem(id, req.user.id)) });
});

// Remove a listing. Trade snapshots keep their copy of the card, so old proposals still read fine.
router.delete("/:id", async (req, res) => {
  const { rowCount } = await query("DELETE FROM inventory_items WHERE id = $1 AND owner_id = $2", [idParam(req), req.user.id]);
  if (!rowCount) throw new HttpError(404, "That listing was not found.");
  res.status(204).end();
});

export default router;
