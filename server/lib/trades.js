// Pure trade rules (unit-tested without a database). Section 4.5 and ERD notes 9.1/9.2.

// Only a pending version can change, and only once. Accepted/declined/countered are final.
const TRANSITIONS = { pending: ["accepted", "declined", "countered"] };

export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

// Keeps a single proposal readable and stops someone posting a 5000-line trade.
export const MAX_LINES = 30;

/**
 * Checks the shape of requested/offered lines: [{ inventoryItemId, quantity }].
 * Returns an error message or null. At least one requested card is required (4.5.2); offers are optional (4.5.3).
 */
export function lineShapeError(requested, offered) {
  if (!Array.isArray(requested) || requested.length === 0) return "Choose at least one card to request.";
  if (offered != null && !Array.isArray(offered)) return "Offered cards must be a list.";
  const all = [...requested, ...(offered ?? [])];
  if (all.length > MAX_LINES) return `A proposal can include at most ${MAX_LINES} lines.`;
  // Walk every line once: valid id, sane quantity, and no listing used twice.
  const ids = new Set();
  for (const line of all) {
    if (!Number.isInteger(line?.inventoryItemId) || line.inventoryItemId <= 0) return "Each line needs a valid listing.";
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) return "Quantities must be positive whole numbers.";
    if (ids.has(line.inventoryItemId)) return "Each listing can appear only once.";
    ids.add(line.inventoryItemId);
  }
  return null;
}

/**
 * 4.5.7: every line must point at an item owned by `ownerId` with enough quantity.
 * `itemsById` maps inventory id -> { owner_id, quantity, available, card_name }.
 * Requested lines must also be shared (available) by their owner.
 */
export function stockErrors(lines, itemsById, ownerId, { requireAvailable = false } = {}) {
  const errors = [];
  for (const line of lines) {
    // Missing, owned by someone else, or hidden all look the same to the user: "no longer available".
    const item = itemsById.get(line.inventoryItemId);
    if (!item || String(item.owner_id) !== String(ownerId) || (requireAvailable && !item.available)) {
      errors.push(`Listing ${line.inventoryItemId} is no longer available.`);
    } else if (line.quantity > item.quantity) {
      errors.push(`Only ${item.quantity} × ${item.card_name} available (you chose ${line.quantity}).`);
    }
  }
  return errors;
}
