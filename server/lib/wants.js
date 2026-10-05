// Pure rules for want lists and their matches (unit-tested without a database). Ratings are in reputation.js.
import { FINISHES, parseQuantity } from "../../shared/validation.js";

// Plenty for a real want list, small enough that matching stays quick.
export const MAX_WANTS = 500;
// Players shown on the matches page, best first.
export const MAX_MATCH_PLAYERS = 50;

/**
 * Validates { quantity, finish, anyPrinting } from a request body; `partial` lets PATCH bodies omit fields.
 * finish null (or "any") means any finish. Returns { values, fields } where fields maps inputs to messages.
 */
export function readWantFields(body = {}, partial = false) {
  const values = {};
  const fields = {};
  if (!partial || body.quantity !== undefined) {
    values.quantity = body.quantity === undefined ? 1 : parseQuantity(body.quantity);
    if (values.quantity === null) fields.quantity = "Quantity must be a whole number from 1 to 9999.";
  }
  if (!partial || body.finish !== undefined) {
    values.finish = body.finish == null || body.finish === "" || body.finish === "any" ? null : body.finish;
    if (values.finish !== null && !FINISHES.includes(values.finish)) fields.finish = "Choose a valid finish.";
  }
  if (!partial || body.anyPrinting !== undefined) {
    values.anyPrinting = body.anyPrinting ?? true;
    if (typeof values.anyPrinting !== "boolean") fields.anyPrinting = "Choose any printing or this printing only.";
  }
  return { values, fields };
}

/**
 * Groups match rows by the other player. `theyHave` rows are their listings that fill one of the viewer's
 * wants (`player_id` = the listing's owner); `theyWant` rows are the viewer's listings on their want list
 * (`player_id` = who wants it). Players with something both ways come first, then whoever covers the most
 * of the viewer's wants, then the nearest. `distance(city)` gives km from the viewer.
 */
export function groupMatches(theyHave, theyWant, distance = () => null) {
  const players = new Map();
  const entry = (id) => {
    const key = String(id);
    if (!players.has(key)) players.set(key, { playerId: Number(id), theyHave: [], theyWant: [] });
    return players.get(key);
  };
  for (const row of theyHave) entry(row.player_id).theyHave.push(row);
  for (const row of theyWant) entry(row.player_id).theyWant.push(row);
  const ranked = [...players.values()].map((p) => ({
    ...p,
    mutual: p.theyHave.length > 0 && p.theyWant.length > 0,
    wantsCovered: new Set(p.theyHave.map((r) => String(r.want_id))).size,
    city: (p.theyHave[0] ?? p.theyWant[0]).city,
  }));
  for (const p of ranked) p.distanceKm = distance(p.city);
  return ranked.sort(
    (a, b) =>
      Number(b.mutual) - Number(a.mutual) ||
      b.wantsCovered - a.wantsCovered ||
      (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
      a.playerId - b.playerId,
  );
}
