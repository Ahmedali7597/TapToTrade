// The Commander deck optimizer: builds the strongest 99 it can around a locked commander within a budget in CAD,
// then reports the deck's odds and scores. Pure functions, so the page can re-run it on every budget change without
// asking the server, and the tests can check every rule. The server sends the candidate `pool` (cards it has
// verified on Scryfall: legal, inside the colour identity, with a real price) and the `combos` (Commander Spellbook
// lines whose pieces are all in the pool).
//
// Pool card: { name, roles: [primary, ...], price (CAD or null), manaValue, typeLine, legal, inIdentity, basic, cedh
//   (share of cEDH decks for this commander running it, from EDHREC), staple, free, cheap, net (mana a fast-mana card
//   adds), finds (what a tutor can find: "any" or type words), produces (land colours), tapped, rank (EDHREC rank) }
// Combo: { id, pieces: [names], produces: [text], win, manaNeeded (mana value to run it), prerequisites, popularity }
import { hash, hyperAtLeast, hyperBetween, margin, seenBy, simulate } from "./probability.js";

export const MODES = [
  ["max", "Maximum competitive power"],
  ["preserve", "Preserve my strategy"],
  ["value", "Best value per dollar"],
];
export const ROLES = {
  fastMana: "fast mana",
  ramp: "ramp",
  tutor: "tutor",
  draw: "card advantage",
  interaction: "interaction",
  protection: "protection",
  wincon: "win condition",
  land: "land",
  other: "synergy",
};
/** How many cards of each role a cEDH deck usually wants; past these the next copy of a role is worth half. */
export const TARGETS = { fastMana: 10, ramp: 4, tutor: 9, draw: 9, interaction: 12, protection: 4, wincon: 2, other: 12 };
export const LANDS = 28;
export const BUDGET_TIERS = [250, 500, 1000, Infinity];
/** Score points the simulation can wobble by; differences this small don't decide between two decks. */
const NOISE = 1;

const WEIGHT = { fastMana: 30, tutor: 24, draw: 16, interaction: 16, protection: 14, wincon: 10, ramp: 8, other: 0, land: 0 };
const primary = (c) => c.roles?.[0] ?? "other";
const isLand = (c) => primary(c) === "land";
const priceOf = (c) => c.price ?? null;

/** How good a card is on its own, before role balance: mostly how often cEDH players run it with this commander. */
export function cardValue(c) {
  if (c.basic) return 5;
  let v = 8 + (c.cedh ?? 0) * 60 + (c.staple ? 12 : 0) + (c.gameChanger ? 4 : 0);
  if (c.rank) v += Math.max(0, 8 - Math.log10(c.rank) * 2); // EDHREC rank 1 adds 8, rank 10,000 adds nothing
  if (isLand(c)) return v + Math.max(0, (c.produces?.length ?? 1) - 1) * 4 - (c.tapped ? 12 : 0);
  v += Math.max(...c.roles.map((r) => WEIGHT[r] ?? 0));
  if (c.roles.includes("interaction")) v += c.free ? 14 : c.cheap ? 5 : 0;
  return v - Math.max(0, (c.manaValue ?? 0) - 2) * 4;
}

/** A card's worth in a deck that already has `counts` of each role: full value up to the role's target, half after. */
const marginal = (c, counts) => {
  const role = primary(c);
  const over = role !== "land" && (counts[role] ?? 0) >= (TARGETS[role] ?? 0);
  return cardValue(c) * (over ? 0.5 : 1);
};

/** Legal, inside the colour identity and not the commander: the only cards the optimizer may ever add. */
const playable = (c, commanders) => c.legal && c.inIdentity && !commanders.includes(c.name);

/** CA$ total of `names` (the 99) plus the commanders; `unpriced` lists cards with no known price. */
export function deckCost(names, byName, commanders) {
  let total = 0;
  const unpriced = [];
  for (const n of [...commanders, ...names]) {
    const p = priceOf(byName.get(n) ?? {});
    if (p == null) unpriced.push(n);
    else total += p;
  }
  return { total: Math.round(total * 100) / 100, unpriced: [...new Set(unpriced)] };
}

/** Total mana a combo line needs: pieces that must be on the battlefield first, plus running it (which includes casting the rest). */
export const lineMana = (line, byName) => (line.battlefield ?? line.pieces).reduce((n, p) => n + (byName.get(p)?.manaValue ?? 0), 0) + (line.manaNeeded ?? 0);

/**
 * 0–100: how efficient a combo line is. Fewer pieces, less mana, fewer extra conditions and more players running
 * it score higher. The commander is a free piece: it starts in the command zone.
 */
export function lineEfficiency(line, byName, commanders) {
  const pieces = line.pieces.filter((p) => !commanders.includes(p)).length;
  const prereqs = (line.prerequisites ?? "").split("\n").filter(Boolean).length;
  const score = 100 - Math.max(0, pieces - 2) * 18 - lineMana(line, byName) * 4 - prereqs * 4 + Math.log10((line.popularity ?? 0) + 1) * 3 - (line.win ? 0 : 25);
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Basic lands for the colours the deck's spells use (Wastes for a colourless deck), `count` of them. */
function basics(pool, chosen, count, byName) {
  const options = pool.filter((c) => c.basic && c.legal && c.inIdentity);
  if (!options.length || count <= 0) return [];
  const colourOf = { Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G", Wastes: "C" };
  const weight = new Map(options.map((b) => [b.name, 0.01]));
  for (const n of chosen) {
    for (const [, sym] of (byName.get(n)?.manaCost ?? "").matchAll(/\{([^}]+)\}/g)) {
      for (const b of options) if (sym.split("/").includes(colourOf[b.name])) weight.set(b.name, weight.get(b.name) + 1);
    }
  }
  const total = [...weight.values()].reduce((a, b) => a + b, 0);
  // Largest remainder, so the counts add up to exactly `count`.
  const shares = options.map((b) => ({ name: b.name, exact: (weight.get(b.name) / total) * count }));
  const out = shares.map((s) => ({ ...s, n: Math.floor(s.exact) }));
  let left = count - out.reduce((a, s) => a + s.n, 0);
  for (const s of [...out].sort((a, b) => b.exact - b.n - (a.exact - a.n))) if (left-- > 0) s.n += 1;
  return out.flatMap((s) => Array(s.n).fill(s.name));
}

/**
 * One greedy build: lock `locked`, then fill the remaining nonland slots by marginal value minus `lambda` × price
 * (lambda 0 = power first, higher = cheaper cards), lands the same way, basics last. Never goes over `budget`.
 */
function build({ pool, byName, commanders, locked, budget, lambda, banned, lands = LANDS, linesOf = new Map() }) {
  const deck = [...locked];
  const counts = {};
  for (const n of deck) {
    const r = primary(byName.get(n));
    counts[r] = (counts[r] ?? 0) + 1;
  }
  let spent = deckCost(deck, byName, commanders).total;
  let value = deck.reduce((n, name) => n + cardValue(byName.get(name)), 0);
  const taken = new Set(deck);
  // Money held back for the slots still to fill: any of them can always become the cheapest basic land.
  const cheapBasic = pool.filter((c) => c.basic && c.legal && c.inIdentity).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
  const basicPrice = cheapBasic?.price ?? 0;
  const usable = pool.filter((c) => playable(c, commanders) && !c.basic && !taken.has(c.name) && !banned.has(c.name) && (budget === Infinity || c.price != null));
  const spells = usable.filter((c) => !isLand(c));
  const landCards = usable.filter(isLand);
  const lockedLands = deck.filter((n) => isLand(byName.get(n))).length;
  let spellSlots = Math.max(0, Math.min(99 - deck.length, 99 - lands - (deck.length - lockedLands)));
  let landSlots = 99 - deck.length - spellSlots;
  // Backup combo lines: a card that completes another winning line is worth a lot more, one that leaves it a piece short a little.
  const have = (p) => taken.has(p) || commanders.includes(p);
  const comboBonus = (c) => {
    let bonus = 0;
    for (const l of linesOf.get(c.name) ?? []) {
      const missing = l.pieces.filter((p) => p !== c.name && !have(p)).length;
      bonus = Math.max(bonus, missing === 0 ? 25 : missing === 1 ? 6 : 0);
    }
    return bonus;
  };
  const pick = (list, slotsLeft, reserveEach, slotsAfter, floor) => {
    let best = null;
    let bestScore = -Infinity;
    const room = budget - spent - (slotsLeft - 1) * reserveEach - slotsAfter * basicPrice;
    for (const c of list) {
      if (taken.has(c.name) || (c.price ?? 0) > room) continue;
      const m = marginal(c, counts) + comboBonus(c);
      if (m < floor) continue;
      const score = m - lambda * (c.price ?? 0);
      if (score > bestScore) [best, bestScore] = [c, score];
    }
    return best;
  };
  while (spellSlots > 0) {
    const c = pick(spells, spellSlots, basicPrice, landSlots, -Infinity);
    if (!c) break; // nothing affordable left: the slot becomes a basic land
    value += marginal(c, counts) + comboBonus(c);
    deck.push(c.name);
    taken.add(c.name);
    counts[primary(c)] = (counts[primary(c)] ?? 0) + 1;
    spent += c.price ?? 0;
    spellSlots -= 1;
  }
  landSlots = 99 - deck.length;
  while (landSlots > 0) {
    const c = pick(landCards, landSlots, basicPrice, 0, cardValue({ basic: true }) + 1);
    if (!c) break;
    deck.push(c.name);
    taken.add(c.name);
    spent += c.price ?? 0;
    value += cardValue(c);
    landSlots -= 1;
  }
  const fill = basics(pool, deck, 99 - deck.length, byName);
  // Basics split by colour can cost more than the cheapest one the budget was held for: swap the dearest down.
  const basicCost = (n) => byName.get(n)?.price ?? 0;
  fill.sort((a, b) => basicCost(b) - basicCost(a));
  let fillCost = fill.reduce((n, b) => n + basicCost(b), 0);
  for (let i = 0; i < fill.length && spent + fillCost > budget && cheapBasic; i++) {
    fillCost -= basicCost(fill[i]) - basicPrice;
    fill[i] = cheapBasic.name;
  }
  for (const b of fill) value += cardValue(byName.get(b));
  return { deck: [...deck, ...fill], value };
}

/** Builds over a few price weightings: a simple way to spend a budget well instead of on the first big card. */
function builds(args) {
  const perSlot = args.budget === Infinity ? 0 : 99 / Math.max(1, args.budget);
  const lambdas = args.budget === Infinity ? [0] : [0, 0.5, 1, 2, 4, 8, 16, 32].map((k) => k * perSlot);
  return lambdas.map((lambda) => build({ ...args, lambda }));
}
const bestBuild = (args) => builds(args).reduce((a, b) => (b.value > a.value ? b : a));

/** Combo lines fully inside `names` plus the commanders. */
export function linesIn(names, combos, commanders) {
  const have = new Set([...names, ...commanders]);
  return combos.filter((l) => l.pieces.every((p) => have.has(p)));
}

/** One-for-one swaps that turn `before` into `after` (both multisets of names), paired by role where possible. */
export function pairChanges(before, after, byName) {
  const count = (list) => list.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map());
  const a = count(before);
  const b = count(after);
  const removed = [];
  const added = [];
  for (const [n, k] of a) for (let i = 0; i < k - (b.get(n) ?? 0); i++) removed.push(n);
  for (const [n, k] of b) for (let i = 0; i < k - (a.get(n) ?? 0); i++) added.push(n);
  const pairs = [];
  const left = [...added];
  for (const r of removed) {
    const role = primary(byName.get(r) ?? {});
    let i = left.findIndex((n) => primary(byName.get(n) ?? {}) === role);
    if (i < 0) i = 0;
    pairs.push({ remove: r, add: left.splice(i, 1)[0] ?? null });
  }
  for (const n of left) pairs.push({ remove: null, add: n });
  return pairs;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const money = (n) => `CA$${Math.abs(n).toFixed(2)}`;

/** A plain-language reason for one swap, built only from the data we have about both cards. */
export function reasonFor({ remove, add }, byName, commanders, lines) {
  const out = byName.get(remove);
  const inn = byName.get(add);
  const parts = [];
  if (out && !out.legal) parts.push(`${remove} is banned or not legal in Commander`);
  else if (out && !out.inIdentity) parts.push(`${remove} is outside ${commanders.join(" and ")}'s colour identity`);
  const line = lines.find((l) => add && l.pieces.includes(add));
  if (line) parts.push(`${add} completes ${line.pieces.join(" + ")} (${line.produces[0] ?? "a combo"})`);
  if (inn && out && remove !== add) {
    const role = ROLES[primary(inn)];
    if (inn.cedh != null && out.legal && out.inIdentity && (out.cedh ?? 0) + 0.05 < inn.cedh) parts.push(`${add} is in ${pct(inn.cedh)} of cEDH ${commanders[0]} decks on EDHREC, ${remove} in ${pct(out.cedh ?? 0)}`);
    if (inn.free && !out.free) parts.push(`${add} can be cast for free`);
    if ((inn.manaValue ?? 0) < (out.manaValue ?? 0) && !isLand(inn)) parts.push(`${add} costs ${out.manaValue - inn.manaValue} less mana`);
    if (primary(inn) !== primary(out)) parts.push(`the deck needs ${role} more than ${ROLES[primary(out)]}`);
    const diff = (inn.price ?? 0) - (out.price ?? 0);
    if (cardValue(inn) < cardValue(out) && diff < 0) parts.push(`saves ${money(diff)} to stay in budget`);
  }
  if (!out && inn) parts.push(`fills an empty slot with ${ROLES[primary(inn)]}`);
  if (out && !inn) parts.push(`${remove} is cut to make room`);
  if (!parts.length && inn) parts.push(`${add} is the stronger ${ROLES[primary(inn)]} by TapToTrade's card score (${Math.round(cardValue(inn))} vs ${Math.round(cardValue(out ?? inn))})`);
  return parts.join("; ") + ".";
}

/** Same-role (or any role, for "value") upgrades to `deck`, best first, kept within the budget. Locked cards stay. */
function upgrade({ deck, pool, byName, commanders, budget, banned, keep, perDollar, crossRole, maxSwaps }) {
  const out = [...deck];
  const inDeck = new Set(out);
  let spent = deckCost(out, byName, commanders).total;
  const candidates = pool.filter((c) => playable(c, commanders) && !c.basic && !inDeck.has(c.name) && !banned.has(c.name) && c.price != null);
  const counts = {};
  for (const n of out) counts[primary(byName.get(n))] = (counts[primary(byName.get(n))] ?? 0) + 1;
  for (let swaps = 0; swaps < maxSwaps; swaps++) {
    let best = null;
    for (let i = 0; i < out.length; i++) {
      const y = byName.get(out[i]);
      if (keep.has(out[i])) continue;
      for (const x of candidates) {
        if (inDeck.has(x.name)) continue;
        const sameRole = primary(x) === primary(y);
        if (!sameRole && !(crossRole && !isLand(x) && !isLand(y) && (counts[primary(x)] ?? 0) < (TARGETS[primary(x)] ?? 0))) continue;
        const cost = (x.price ?? 0) - (y.price ?? 0);
        if (spent + cost > budget) continue;
        const gain = cardValue(x) - cardValue(y);
        if (gain < 3) continue;
        const score = perDollar ? gain / Math.max(0.5, cost) : gain;
        if (!best || score > best.score) best = { i, x, y, cost, score };
      }
    }
    if (!best) break;
    out[best.i] = best.x.name;
    inDeck.delete(best.y.name);
    inDeck.add(best.x.name);
    counts[primary(best.y)] -= 1;
    counts[primary(best.x)] = (counts[primary(best.x)] ?? 0) + 1;
    spent += best.cost;
  }
  return out;
}

/** Cheaper same-role replacements (or basics, for lands) until `deck` fits the budget, losing as little value as possible. */
function downgrade({ deck, pool, byName, commanders, budget, banned, keep }) {
  const out = [...deck];
  let spent = deckCost(out, byName, commanders).total;
  const basicsFor = basics(pool, out, 30, byName);
  while (spent > budget) {
    const inDeck = new Set(out);
    let best = null;
    for (let i = 0; i < out.length; i++) {
      const y = byName.get(out[i]);
      if (keep.has(out[i]) || !(y.price > 0.5)) continue;
      const options = isLand(y)
        ? basicsFor.slice(0, 1).map((n) => byName.get(n))
        : pool.filter((c) => playable(c, commanders) && !c.basic && primary(c) === primary(y) && !inDeck.has(c.name) && !banned.has(c.name) && c.price != null && c.price < y.price);
      for (const x of options) {
        const saved = y.price - x.price;
        const loss = Math.max(0, cardValue(y) - cardValue(x));
        const score = loss / saved;
        if (!best || score < best.score) best = { i, x, saved, score };
      }
    }
    if (!best) break; // nothing left to make cheaper: the page says the deck is still over budget
    out[best.i] = best.x.name;
    spent -= best.saved;
  }
  return out;
}

/**
 * Optimizes the 99 around `commanders` (locked: never removed, never replaced, never added to the 99).
 * `original` is the player's 99 as names (basics repeated), `budget` the CA$ ceiling for the whole deck including
 * the commander (Infinity for no limit), `rejected` = { adds: [names never to add], keeps: [names never to cut] }.
 * `consider` are decks found earlier (at lower budgets, same goal and rejections): one that fits and scores higher is
 * used instead, so raising the budget never shows a deck more than a point (simulation noise) weaker than a lower budget did.
 * Returns { deck, cost, lines, primary, changes, notes }.
 */
export function optimize({ pool, combos = [], commanders, original = [], budget = Infinity, mode = "max", rejected = {}, consider = [] }) {
  const byName = new Map(pool.map((c) => [c.name, c]));
  const banned = new Set(rejected.adds ?? []);
  const isOk = (n) => byName.has(n) && playable(byName.get(n), commanders);
  // Cards the player kept on purpose stay, if they're allowed in the deck at all.
  const keep = new Set((rejected.keeps ?? []).filter(isOk));
  // The player's cards that may stay: legal, in the colour identity, one copy of each non-basic.
  const seen = new Set();
  const legalOriginal = original.filter((n) => isOk(n) && (byName.get(n).basic || (!seen.has(n) && seen.add(n))));
  const notes = [];
  const usable = combos.filter((l) => l.win && l.pieces.every((p) => commanders.includes(p) || (isOk(p) && !banned.has(p) && (budget === Infinity || byName.get(p).price != null))));
  const linesOf = new Map();
  for (const l of usable) for (const p of l.pieces) linesOf.set(p, [...(linesOf.get(p) ?? []), l]);
  let deck;
  if (mode === "max" || !original.length) {
    const lockedBase = [...keep];
    // Try the strongest few affordable win lines (and no line) as the deck's spine; keep whichever build scores best.
    const ranked = usable.map((l) => ({ l, e: lineEfficiency(l, byName, commanders) })).sort((a, b) => b.e - a.e);
    const tries = [null, ...ranked.slice(0, 6)];
    const candidates = [];
    for (const t of tries) {
      const pieces = t ? t.l.pieces.filter((p) => !commanders.includes(p) && !lockedBase.includes(p)) : [];
      const locked = [...lockedBase, ...pieces];
      // The no-line build always runs, so even a budget below the commander's price gets the cheapest deck.
      if (t && budget !== Infinity && deckCost(locked, byName, commanders).total > budget) continue;
      for (const b of builds({ pool, byName, commanders, locked, budget, banned, linesOf })) {
        const lines = linesIn(b.deck, usable, commanders);
        candidates.push({ deck: b.deck, score: b.value + (lines.length ? Math.max(...lines.map((l) => lineEfficiency(l, byName, commanders))) * 1.5 : 0) });
      }
    }
    // The builder ranks cards by how much cEDH players run them; the dashboard scores speed, consistency, interaction
    // and so on. Of the builder's strongest few decks, keep the one the dashboard scores highest, so the two agree
    // (and a bigger budget, which can afford every cheaper build, doesn't come out with a lower score).
    const seenDecks = new Set();
    const shortlist = candidates
      .sort((a, b) => b.score - a.score)
      .filter((c) => {
        const key = [...c.deck].sort().join("|");
        return !seenDecks.has(key) && seenDecks.add(key);
      })
      .slice(0, 6);
    // Same simulation (seed and size) as the dashboard. Scores within a point of the best are simulation noise, and the
    // dashboard can't see everything (colour fixing, for one), so among those the builder's own ranking decides.
    const scored = shortlist.map((c) => ({ ...c, overall: report({ pool, combos, commanders, deck: c.deck }).scores.overall }));
    const top = Math.max(...scored.map((c) => c.overall));
    deck = scored.filter((c) => c.overall >= top - NOISE).sort((a, b) => b.score - a.score)[0].deck;
  } else {
    // Preserve and value start from the player's deck: illegal cards go, the combos it already has stay locked.
    const lock = new Set([...keep, ...linesIn(legalOriginal, combos, commanders).flatMap((l) => l.pieces)]);
    let start = [...legalOriginal];
    const missing = 99 - start.length;
    if (missing > 0) {
      // A short list (or one that lost illegal cards) is topped up first; the budget pass below trims it.
      start = bestBuild({ pool, byName, commanders, locked: start, budget: Infinity, banned, lands: Math.max(LANDS, start.filter((n) => isLand(byName.get(n))).length) }).deck;
    } else if (missing < 0) {
      start = [...start].sort((x, y) => (lock.has(y) - lock.has(x)) || cardValue(byName.get(y)) - cardValue(byName.get(x))).slice(0, 99);
    }
    if (budget !== Infinity) start = downgrade({ deck: start, pool, byName, commanders, budget, banned, keep: lock });
    deck = upgrade({ deck: start, pool, byName, commanders, budget, banned, keep: lock, perDollar: mode === "value", crossRole: mode === "value", maxSwaps: mode === "value" ? 30 : 15 });
  }
  const fits = (d) =>
    d.length === 99 &&
    d.every((n) => isOk(n) && !banned.has(n)) &&
    [...keep].every((k) => d.includes(k)) &&
    (budget === Infinity || deckCost(d, byName, commanders).total <= budget);
  const others = consider.filter(fits);
  if (others.length) {
    const score = (d) => report({ pool, combos, commanders, deck: d }).scores.overall;
    const best = others.map((d) => ({ d, s: score(d) })).reduce((x, y) => (y.s > x.s ? y : x));
    if (best.s > score(deck) + NOISE) deck = best.d;
  }
  const cost = deckCost(deck, byName, commanders);
  if (budget !== Infinity && cost.total > budget) notes.push(`Even the cheapest version found costs ${money(cost.total)}, over the ${money(budget)} budget. The commander alone costs ${money(deckCost([], byName, commanders).total)}.`);
  const lines = linesIn(deck, combos, commanders).map((l) => ({ ...l, efficiency: lineEfficiency(l, byName, commanders), mana: lineMana(l, byName) })).sort((a, b) => b.efficiency - a.efficiency);
  const changes = pairChanges(original, deck, byName).map((p) => ({
    ...p,
    costDiff: Math.round(((byName.get(p.add)?.price ?? 0) - (byName.get(p.remove)?.price ?? 0)) * 100) / 100,
    reason: reasonFor(p, byName, commanders, lines),
  }));
  return { deck, cost, lines, primary: lines[0] ?? null, changes, notes };
}

/** Applies the chosen swaps (each { remove, add }) to `original`, keeping the commander out of the 99. */
export function applyChanges(original, changes) {
  const out = [...original];
  for (const { remove, add } of changes) {
    if (remove != null) {
      const i = out.indexOf(remove);
      if (i >= 0) out.splice(i, 1);
    }
    if (add != null) out.push(add);
  }
  return out;
}

/** The earliest turn a perfect draw could run `line`: every piece in hand and the deck's best fast mana beside them. */
export function theoreticalTurn(line, deck, byName, commanders) {
  const pieces = line.pieces.filter((p) => !commanders.includes(p)).length;
  const need = lineMana(line, byName);
  const lands = deck.filter((n) => isLand(byName.get(n))).length;
  const fast = deck.map((n) => byName.get(n)).filter((c) => primary(c) === "fastMana").map((c) => c.net ?? 1).sort((a, b) => b - a);
  for (let turn = 1; turn <= 10; turn++) {
    const slots = seenBy(turn) - pieces;
    if (slots < 0) continue;
    // Any mix of lands (one per turn) and fast mana: try each number of lands, keep the most mana.
    let best = 0;
    for (let l = 0; l <= Math.min(turn, lands, slots); l++) best = Math.max(best, l + fast.slice(0, slots - l).reduce((a, b) => a + b, 0));
    if (best >= need) return turn;
  }
  return null;
}

/** Can a tutor card find `piece`? */
const finder = (tutor, byName) => (piece) => {
  if (tutor.finds === "any") return true;
  const type = (byName.get(piece)?.typeLine ?? "").toLowerCase();
  return (tutor.finds ?? []).some((t) => type.includes(t));
};

/**
 * Everything the dashboard shows for one 99: exact odds, a seeded simulation, combo lines and the scores.
 * Scores are TapToTrade's own 0–100 indices from the formulas in SCORE_NOTES, not win rates.
 */
export function report({ pool, combos = [], commanders, deck, trials = 3000 }) {
  const byName = new Map(pool.map((c) => [c.name, c]));
  const cards = deck.map((n) => byName.get(n)).filter(Boolean);
  const N = deck.length;
  const has = (role) => cards.filter((c) => c.roles?.includes(role));
  const count = (role) => has(role).length;
  const interaction = has("interaction");
  const free = interaction.filter((c) => c.free).length;
  const cheap = interaction.filter((c) => !c.free && c.cheap).length;
  const lands = cards.filter(isLand).length;
  const sources = lands + count("fastMana");
  const spells = cards.filter((c) => !isLand(c));
  const avgMv = spells.length ? spells.reduce((n, c) => n + (c.manaValue ?? 0), 0) / spells.length : 0;
  const lines = linesIn(deck, combos, commanders)
    .map((l) => ({ ...l, efficiency: lineEfficiency(l, byName, commanders), mana: lineMana(l, byName), earliest: theoreticalTurn(l, deck, byName, commanders) }))
    .sort((a, b) => b.efficiency - a.efficiency);
  const top = lines[0] ?? null;
  const tutors = has("tutor").length;

  const exact = [
    ["fastMana", "At least one fast mana card in the opening seven", hyperAtLeast(N, count("fastMana"), 7)],
    ["tutor", "At least one tutor in the opening seven", hyperAtLeast(N, tutors, 7)],
    ["interaction", "At least one interaction spell in the opening seven", hyperAtLeast(N, interaction.length, 7)],
    ["freeInteraction", "At least one free interaction spell in the opening seven", hyperAtLeast(N, free, 7)],
    ["draw", "At least one card advantage card in the opening seven", hyperAtLeast(N, count("draw"), 7)],
    ["mana", "Two to five mana sources (lands and fast mana) in the opening seven", hyperBetween(N, sources, 7, 2, 5)],
    ["lands", "At least three lands seen by turn 3", hyperAtLeast(N, lands, seenBy(3), 3)],
  ];
  if (top) {
    const pieces = top.pieces.filter((p) => !commanders.includes(p));
    // Any one piece of the main line, or a tutor that can find one, in the opening seven.
    const outs = new Set([...pieces, ...has("tutor").filter((t) => pieces.some(finder(t, byName))).map((t) => t.name)]);
    exact.push(["comboStart", `A piece of ${top.pieces.join(" + ")}, or a tutor that finds one, in the opening seven`, hyperAtLeast(N, outs.size, 7)]);
    for (const p of pieces) exact.push([`piece:${p}`, `${p} drawn by turn 4 (without tutoring)`, hyperAtLeast(N, 1, seenBy(4))]);
  }

  const library = cards.map((c) => ({
    name: c.name,
    land: isLand(c),
    mana: primary(c) === "fastMana" ? (c.net ?? 1) : primary(c) === "ramp" && (c.manaValue ?? 9) <= 2 ? 1 : 0,
    tutor: c.roles?.includes("tutor") ? { finds: finder(c, byName) } : null,
    draws: c.roles?.includes("draw") && !isLand(c) ? 1 : 0,
    cost: c.manaValue ?? 0,
  }));
  const sim = lines.length
    ? simulate({ library, lines: lines.slice(0, 4).map((l) => ({ pieces: l.pieces, mana: l.mana })), free: commanders, trials, seed: hash(commanders.join("|")) })
    : null;

  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  // The turn the simulated chance of a ready line reaches 50%, read between whole turns so small changes show smoothly.
  const half = sim ? sim.byTurn.findIndex((p) => p >= 0.5) : -1;
  const medianTurn = !sim ? null : half < 0 ? 11 : half === 0 ? 1 : half + (0.5 - sim.byTurn[half - 1]) / (sim.byTurn[half] - sim.byTurn[half - 1]);
  const speed = sim ? clamp(((10 - medianTurn) / 7) * 100) : clamp(((4 - avgMv) / 3) * 40);
  const comboStart = exact.find((e) => e[0] === "comboStart")?.[2] ?? 0;
  const consistency = clamp(100 * (0.5 * (sim?.byTurn[3] ?? 0) + 0.3 * (sim?.keep7 ?? hyperBetween(N, sources, 7, 2, 5)) + 0.2 * comboStart));
  const interactionScore = clamp(((2 * free + 1.2 * cheap + 0.6 * (interaction.length - free - cheap)) / 22) * 100);
  const resilience = clamp((Math.min(count("protection"), 4) / 4) * 30 + (Math.min(lines.length, 3) / 3) * 40 + (Math.min(tutors, 10) / 10) * 30);
  const comboScore = top?.efficiency ?? 0;
  const scores = {
    overall: clamp(0.25 * speed + 0.25 * consistency + 0.2 * interactionScore + 0.15 * resilience + 0.15 * comboScore),
    speed,
    consistency,
    interaction: interactionScore,
    resilience,
    combo: comboScore,
  };
  return {
    size: N,
    counts: Object.fromEntries(Object.keys(ROLES).map((r) => [r, count(r)])),
    free,
    cheap,
    lands,
    avgMv: Math.round(avgMv * 100) / 100,
    exact: exact.map(([key, label, p]) => ({ key, label, p })),
    sim: sim && { ...sim, margin: margin(sim.byTurn[3], sim.trials) },
    lines,
    primary: top,
    earliest: top?.earliest ?? null,
    expected: sim && sim.median <= 10 ? sim.median : null,
    scores,
    cost: deckCost(deck, byName, commanders),
  };
}

/** How each score is worked out, shown under the dashboard so no number is a mystery. */
export const SCORE_NOTES = [
  ["Speed", "From the turn the simulated chance of a ready combo line reaches 50% (read between turns): turn 3 or sooner scores 100, turn 10 or later 0. Without a combo, from the average mana value."],
  ["Consistency", "50% the simulated chance a line is ready by turn 4, 30% the chance of keeping the first seven, 20% the exact chance of a piece or a tutor for it in the opening seven."],
  ["Interaction", "Free spells count 2, other spells costing 2 or less count 1.2, the rest 0.6; 22 points scores 100."],
  ["Resilience", "Protection (up to 4) 30%, separate combo lines (up to 3) 40%, tutors (up to 10) 30%."],
  ["Combo efficiency", "The best line's efficiency: fewer pieces, less mana, fewer conditions and wider play score higher."],
  ["Overall", "25% speed, 25% consistency, 20% interaction, 15% resilience, 15% combo efficiency."],
];
