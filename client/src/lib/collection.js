// Grouping, sorting and filtering a player's collection on the inventory page, the way Moxfield and Archidekt
// lay out a collection or a Commander deck: by card type, colour, rarity or set.

// Checked in this order, so an artifact creature counts as a creature and an artifact land as a land.
const TYPE_MATCH = ["Creature", "Planeswalker", "Battle", "Land", "Instant", "Sorcery", "Artifact", "Enchantment"];
const TYPE_LABELS = {
  Creature: "Creatures",
  Planeswalker: "Planeswalkers",
  Battle: "Battles",
  Instant: "Instants",
  Sorcery: "Sorceries",
  Artifact: "Artifacts",
  Enchantment: "Enchantments",
  Land: "Lands",
  Other: "Other",
};
const COLOUR_NAMES = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
const RARITY_LABELS = { mythic: "Mythic rare", rare: "Rare", uncommon: "Uncommon", common: "Common", special: "Special", bonus: "Special" };

/** "Legendary Artifact Creature — Golem // ..." -> "Creature". Only the front face counts. "Other" if unknown. */
export function mainType(typeLine) {
  const front = (typeLine ?? "").split("//")[0];
  return TYPE_MATCH.find((t) => front.includes(t)) ?? "Other";
}

/** The colour group a printing goes in: one colour, "Multicolour", "Colourless", or "Lands" for lands. */
export function colourGroup(printing) {
  if (mainType(printing.typeLine) === "Land") return "Lands";
  const colors = printing.colors ?? [];
  if (colors.length > 1) return "Multicolour";
  return COLOUR_NAMES[colors[0]] ?? "Colourless";
}

// For each grouping: the group of one listing, and the order groups appear in (unlisted labels go last, A–Z).
const GROUPINGS = {
  none: { of: () => "All cards", order: [] },
  type: { of: (i) => TYPE_LABELS[mainType(i.printing.typeLine)], order: Object.values(TYPE_LABELS) },
  colour: { of: (i) => colourGroup(i.printing), order: [...Object.values(COLOUR_NAMES), "Multicolour", "Colourless", "Lands"] },
  rarity: { of: (i) => RARITY_LABELS[i.printing.rarity] ?? "Unknown rarity", order: ["Mythic rare", "Rare", "Uncommon", "Common", "Special"] },
  set: { of: (i) => i.printing.setName || i.printing.setCode?.toUpperCase() || "Unknown set", order: [] },
};
export const GROUP_OPTIONS = [
  ["none", "No grouping"],
  ["type", "Card type"],
  ["colour", "Colour"],
  ["rarity", "Rarity"],
  ["set", "Set"],
];

/** [{ label, items }] in display order; `items` keep the order they came in. */
export function groupItems(items, by = "none") {
  const g = GROUPINGS[by] ?? GROUPINGS.none;
  const groups = new Map();
  for (const item of items) {
    const label = g.of(item);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  const rank = (label) => {
    const i = g.order.indexOf(label);
    return i === -1 ? g.order.length : i;
  };
  return [...groups].map(([label, list]) => ({ label, items: list })).sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

const byName = (a, b) => a.printing.name.localeCompare(b.printing.name) || a.printing.setCode.localeCompare(b.printing.setCode) || a.id - b.id;
const collector = (p) => parseInt(p.collectorNumber, 10) || 0;
export const SORT_OPTIONS = [
  ["name", "Name"],
  ["price", "Price, highest first"],
  ["newest", "Recently added"],
  ["set", "Set and number"],
  ["quantity", "Quantity, most first"],
];

/** A sorted copy. `prices` is the /inventory/prices answer; unpriced cards go last in the price sort. */
export function sortItems(items, sort = "name", prices = null) {
  const price = (i) => prices?.prices[`${i.printing.id}:${i.finish}`]?.cad ?? -1;
  const compare = {
    name: byName,
    price: (a, b) => price(b) - price(a) || byName(a, b),
    newest: (a, b) => String(b.addedAt ?? "").localeCompare(String(a.addedAt ?? "")) || b.id - a.id,
    set: (a, b) => (a.printing.setName ?? "").localeCompare(b.printing.setName ?? "") || collector(a.printing) - collector(b.printing) || byName(a, b),
    quantity: (a, b) => b.quantity - a.quantity || byName(a, b),
  }[sort] ?? byName;
  return [...items].sort(compare);
}

/** Listings whose name, set or type contains `q`, limited to shared or private ones if `show` says so. */
export function filterItems(items, { q = "", show = "all" } = {}) {
  const needle = q.trim().toLowerCase();
  return items.filter((i) => {
    if (show === "shared" && !i.available) return false;
    if (show === "private" && i.available) return false;
    if (!needle) return true;
    const p = i.printing;
    return [p.name, p.setName, p.setCode, p.typeLine].some((s) => s?.toLowerCase().includes(needle));
  });
}

/**
 * The totals bar: cards (counting quantity), listings, how many are shared, the market value of the priced ones
 * and how many have no price, and cards per rarity.
 */
export function summarize(items, prices = null) {
  const out = { cards: 0, listings: items.length, shared: 0, value: 0, unpriced: 0, rarity: { mythic: 0, rare: 0, uncommon: 0, common: 0 } };
  for (const i of items) {
    out.cards += i.quantity;
    if (i.available) out.shared += 1;
    const cad = prices?.prices[`${i.printing.id}:${i.finish}`]?.cad;
    if (cad == null) out.unpriced += 1;
    else out.value += cad * i.quantity;
    if (i.printing.rarity in out.rarity) out.rarity[i.printing.rarity] += i.quantity;
  }
  out.value = Math.round(out.value * 100) / 100;
  return out;
}

/** Binder pages of 9 pockets. Each group starts on a fresh page, like a binder sorted by type: [{ label, items }]. */
export function binderPages(groups, perPage = 9) {
  const pages = [];
  for (const g of groups) for (let i = 0; i < g.items.length; i += perPage) pages.push({ label: g.label, items: g.items.slice(i, i + perPage) });
  return pages;
}
