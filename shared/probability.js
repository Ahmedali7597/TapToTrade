// Exact draw odds (hypergeometric) and seeded Monte Carlo simulation for the deck optimizer. Shared by the
// optimizer page and its tests. A Commander library is the 99 cards; the commander starts in the command zone.

const LOG_FACT = [0];
for (let i = 1; i <= 400; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);

/** ln C(n, k), or -Infinity when k is outside 0…n. */
export function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return LOG_FACT[n] - LOG_FACT[k] - LOG_FACT[n - k];
}

/** P(X = k) drawing `draws` cards from `deck` cards of which `hits` are hits. */
export function hyperPmf(deck, hits, draws, k) {
  return Math.exp(logChoose(hits, k) + logChoose(deck - hits, draws - k) - logChoose(deck, draws));
}

/** P(X ≥ k). With k = 1 this is 1 − C(N−K, n) / C(N, n). */
export function hyperAtLeast(deck, hits, draws, k = 1) {
  let below = 0;
  for (let i = 0; i < k; i++) below += hyperPmf(deck, hits, draws, i);
  return Math.min(1, Math.max(0, 1 - below));
}

/** P(lo ≤ X ≤ hi). */
export function hyperBetween(deck, hits, draws, lo, hi) {
  let p = 0;
  for (let i = Math.max(0, lo); i <= Math.min(hi, draws, hits); i++) p += hyperPmf(deck, hits, draws, i);
  return Math.min(1, p);
}

/** Cards seen by the start of turn `turn`: 7 in the opening hand, then one draw a turn (no multiplayer player skips it). */
export const seenBy = (turn) => 7 + turn;

/** A small seeded random number generator (mulberry32), so the same deck always simulates the same way. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A string's 32-bit hash, for seeding. */
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Shuffles a copy of `items` (Fisher-Yates) with `random`. */
export function shuffle(items, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The 95% margin of error for a simulated proportion, e.g. 0.012 for ±1.2 points. */
export const margin = (p, trials) => 1.96 * Math.sqrt((p * (1 - p)) / trials);

/**
 * Goldfish simulation (no opponents, no interaction) of how soon a deck can assemble a combo line.
 * `library` is the 99 as [{ name, land, mana, draws, tutor: { finds(name) } | null, cost }]: `mana` is the extra mana
 * a non-land source adds from the turn it's drawn, `draws` the extra cards a draw spell sees, `cost` what a tutor
 * costs to cast. `lines` are [{ pieces: [names], mana }] with `mana` the total needed
 * to cast the pieces and run the combo; pieces in `free` (the commander) are always available.
 * Mulligans: the first is free in Commander (rule 103.5c), later ones put cards on the bottom (London).
 * Returns { trials, keep7, byTurn: [P(line ready by turn 1)…turn 10], median }.
 */
export function simulate({ library, lines, free = [], trials = 4000, seed = 1, maxTurn = 10 }) {
  const random = rng(seed);
  const freeSet = new Set(free);
  const keepable = (hand) => {
    const sources = hand.filter((c) => c.land || c.mana > 0).length;
    return sources >= 2 && sources <= 5;
  };
  const ready = new Array(maxTurn).fill(0);
  let keep7 = 0;
  const turns = [];
  for (let t = 0; t < trials; t++) {
    let deck = shuffle(library, random);
    let bottom = 0;
    if (keepable(deck.slice(0, 7))) keep7 += 1;
    // At most two mulligans: the free one, then one that puts a card on the bottom (the hand is just one card short).
    for (let mull = 0; mull < 2 && !keepable(deck.slice(0, 7)); mull++) {
      deck = shuffle(library, random);
      bottom = mull;
    }
    let found = maxTurn + 1;
    for (let turn = 1; turn <= maxTurn && found > maxTurn; turn++) {
      // Card draw already in hand sees that many extra cards (one pass: cards drawn this way don't draw again).
      const base = seenBy(turn) - bottom;
      const hand = deck.slice(0, base + deck.slice(0, base).reduce((n, c) => n + (c.draws ?? 0), 0));
      const lands = Math.min(turn, hand.filter((c) => c.land).length);
      const mana = lands + hand.reduce((n, c) => n + (c.land ? 0 : c.mana), 0);
      const names = new Set(hand.map((c) => c.name));
      for (const line of lines) {
        const missing = line.pieces.filter((p) => !freeSet.has(p) && !names.has(p));
        // Each tutor in hand finds one missing piece it can reach, paying its own cost.
        const tutors = hand.filter((c) => c.tutor);
        let extra = 0;
        let ok = true;
        for (const piece of missing) {
          const i = tutors.findIndex((c) => c.tutor.finds(piece));
          if (i < 0) {
            ok = false;
            break;
          }
          extra += tutors[i].cost;
          tutors.splice(i, 1);
        }
        if (ok && mana >= line.mana + extra) {
          found = turn;
          break;
        }
      }
    }
    turns.push(found);
    for (let turn = found; turn <= maxTurn; turn++) ready[turn - 1] += 1;
  }
  turns.sort((a, b) => a - b);
  return { trials, keep7: keep7 / trials, byTurn: ready.map((n) => n / trials), median: turns[Math.floor(trials / 2)] };
}
