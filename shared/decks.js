// Deck rules shared by the server (validation) and the deck page (warnings, stats). Moxfield-style: a deck is
// cards on boards (commander, main, side, maybe); the checks below are advice shown on the page, never blocking.

/** Formats a deck can be built for: [value, label]. Casual has no rules beyond the basics. */
export const FORMATS = [
  ["commander", "Commander"],
  ["standard", "Standard"],
  ["pioneer", "Pioneer"],
  ["modern", "Modern"],
  ["legacy", "Legacy"],
  ["vintage", "Vintage"],
  ["pauper", "Pauper"],
  ["casual", "Casual"],
];
export const FORMAT_LABELS = Object.fromEntries(FORMATS);
/** The formats Scryfall reports legality for (every format above except casual). */
export const DECK_FORMATS = FORMATS.map(([f]) => f).filter((f) => f !== "casual");

export const BOARDS = [
  ["commander", "Commander"],
  ["main", "Main deck"],
  ["side", "Sideboard"],
  ["maybe", "Maybeboard"],
];
export const BOARD_LABELS = Object.fromEntries(BOARDS);
export const VISIBILITY = [
  ["private", "Private: only you"],
  ["unlisted", "Unlisted: anyone with the link"],
  ["public", "Public: on your profile"],
];

export const MAX_DECKS = 50;
export const MAX_DECK_ROWS = 300;

// Cards a deck may run any number of (their rules text says so), besides basic lands.
const ANY_NUMBER = new Set([
  "Relentless Rats",
  "Rat Colony",
  "Shadowborn Apostle",
  "Persistent Petitioners",
  "Dragon's Approach",
  "Slime Against Humanity",
  "Hare Apparent",
  "Templar Knight",
  "Cid, Timeless Artificer",
]);
const LIMITED = { "Seven Dwarves": 7, "Nazgûl": 9 };
const isBasic = (p) => /\bBasic\b/.test(p.typeLine ?? "");

/** Copies of one card a deck may have in `format`. */
export function copyLimit(printing, format) {
  if (isBasic(printing) || ANY_NUMBER.has(printing.name)) return Infinity;
  if (LIMITED[printing.name]) return LIMITED[printing.name];
  if (format === "casual") return Infinity;
  if (format === "commander") return 1;
  if (printing.legalities?.[format] === "restricted") return 1;
  return 4;
}

/** Cards on a board, counting quantity. `cards` are [{ board, quantity, printing }]. */
export const countOn = (cards, ...boards) => cards.filter((c) => boards.includes(c.board)).reduce((n, c) => n + c.quantity, 0);

/**
 * What's wrong with a deck for its format, as plain sentences for the page. Checks size, copies, legality and,
 * for Commander, the commander and colour identity. Cards whose details aren't known yet are given the benefit
 * of the doubt.
 */
export function deckProblems(format, cards) {
  const problems = [];
  const playing = cards.filter((c) => c.board === "commander" || c.board === "main");
  const main = countOn(cards, "commander", "main");
  const side = countOn(cards, "side");
  if (format === "commander") {
    if (main !== 100) problems.push(`A Commander deck has exactly 100 cards, counting the commander. This one has ${main}.`);
    const commanders = cards.filter((c) => c.board === "commander");
    if (!commanders.length) problems.push("Choose a commander: add a legendary creature to the Commander board.");
    if (commanders.length > 2) problems.push("A deck can have at most two commanders (with Partner or a similar ability).");
    for (const c of commanders) {
      const t = c.printing.typeLine ?? "";
      if (t && !(/Legendary/.test(t) && /Creature/.test(t)) && !/Planeswalker|Background/.test(t)) problems.push(`${c.printing.name} isn't a legendary creature, so it usually can't be a commander.`);
    }
    const identity = new Set(commanders.flatMap((c) => c.printing.colorIdentity ?? []));
    if (commanders.length && commanders.every((c) => c.printing.colorIdentity)) {
      const outside = playing.filter((c) => c.board === "main" && c.printing.colorIdentity?.some((col) => !identity.has(col)));
      for (const c of outside.slice(0, 10)) problems.push(`${c.printing.name} is outside your commander's colour identity.`);
      if (outside.length > 10) problems.push(`…and ${outside.length - 10} more cards outside the colour identity.`);
    }
  } else if (format !== "casual") {
    if (main < 60) problems.push(`A ${format[0].toUpperCase()}${format.slice(1)} deck needs at least 60 main-deck cards. This one has ${main}.`);
    if (side > 15) problems.push(`A sideboard can have at most 15 cards. This one has ${side}.`);
  }
  // Copies by name across the boards that count (main and sideboard, or commander and main).
  const counted = cards.filter((c) => c.board !== "maybe");
  const byName = new Map();
  for (const c of counted) byName.set(c.printing.name, { printing: c.printing, n: (byName.get(c.printing.name)?.n ?? 0) + c.quantity });
  for (const { printing, n } of byName.values()) {
    const limit = copyLimit(printing, format);
    if (n > limit) problems.push(limit === 1 ? `${printing.name}: only one copy is allowed, and the deck has ${n}.` : `${printing.name}: at most ${limit} copies are allowed, and the deck has ${n}.`);
  }
  if (format !== "casual") {
    for (const { printing } of byName.values()) {
      const status = printing.legalities?.[format];
      if (status === "banned") problems.push(`${printing.name} is banned in ${FORMAT_LABELS[format]}.`);
      else if (status === "not_legal") problems.push(`${printing.name} isn't legal in ${FORMAT_LABELS[format]}.`);
    }
  }
  return problems;
}

/** Mana curve of the non-land cards being played: [{ value: "0"…"7+", count }]. */
export function manaCurve(cards) {
  const bins = Array.from({ length: 8 }, (_, i) => ({ value: i === 7 ? "7+" : String(i), count: 0 }));
  for (const c of cards) {
    if (!["commander", "main"].includes(c.board) || /\bLand\b/.test(c.printing.typeLine ?? "")) continue;
    bins[Math.min(7, Math.floor(Number(c.printing.manaValue) || 0))].count += c.quantity;
  }
  return bins;
}

/** Mana symbols across the deck's mana costs, for the colour bar: { W, U, B, R, G, C }. Hybrid counts for both. */
export function colourPips(cards) {
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const c of cards) {
    if (!["commander", "main"].includes(c.board)) continue;
    for (const [, sym] of (c.printing.manaCost ?? "").matchAll(/\{([^}]+)\}/g)) for (const k of sym.split("/")) if (k in pips) pips[k] += c.quantity;
  }
  return pips;
}

/** A decklist in the text format Moxfield, Archidekt and Arena import: sections, then "1 Sol Ring (C21) 263". */
export function deckText(cards) {
  const line = (c) => `${c.quantity} ${c.printing.name} (${c.printing.setCode.toUpperCase()}) ${c.printing.collectorNumber}`;
  const out = [];
  for (const [board, label] of BOARDS) {
    const rows = cards.filter((c) => c.board === board).sort((a, b) => a.printing.name.localeCompare(b.printing.name));
    if (!rows.length) continue;
    if (out.length) out.push("");
    out.push(board === "main" ? "Deck" : label);
    out.push(...rows.map(line));
  }
  return out.join("\n") + "\n";
}
