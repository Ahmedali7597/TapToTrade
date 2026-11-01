// Combo lines from Commander Spellbook (commanderspellbook.com), the community's open combo database, read through
// its public API and kept for a day. Only lines legal in Commander, inside the colour identity, made of named cards
// (no "any sacrifice outlet" placeholders we can't check) and not needing a different commander are kept.
const API = "https://backend.commanderspellbook.com";
const HEADERS = { "User-Agent": "TapToTrade/1.0 (student capstone)", Accept: "application/json" };
const DAY = 86_400_000;
const cache = new Map();

// Results that end the game by themselves.
const WINS = /win the game|infinite (damage|life ?loss|lifeloss)|lose the game|tokens with haste|infinite (opponent )?mill(?! for you)|infinite combat/i;
// Infinite mana or cards: a game plan when the commander is a piece (it usually is the outlet), not a win alone.
const ENGINES = /infinite .*mana|infinite (card )?draw|near-infinite storm/i;

/** One Spellbook variant as the optimizer's combo line, or null if it can't be used around `commanders`. */
export function toLine(v, commanders) {
  if (v.status !== "OK" || v.legalities?.commander === false || v.requires?.length) return null;
  const uses = v.uses ?? [];
  if (uses.some((u) => u.mustBeCommander && !commanders.includes(u.card.name))) return null;
  const pieces = uses.map((u) => u.card.name);
  // Results that win the game first, so the page leads with them.
  const produces = (v.produces ?? []).map((p) => p.feature.name).sort((a, b) => WINS.test(b) - WINS.test(a));
  const withCommander = pieces.some((p) => commanders.includes(p));
  return {
    id: v.id,
    pieces,
    produces,
    win: produces.some((p) => WINS.test(p)) || (withCommander && produces.some((p) => ENGINES.test(p))),
    // Spellbook's mana value counts casting the pieces that start in hand; pieces that must already be on the
    // battlefield are cast beforehand, so the optimizer adds their mana value on top.
    manaNeeded: Number(v.manaValueNeeded) || 0,
    battlefield: uses.filter((u) => u.zoneLocations?.includes("B") && !u.zoneLocations.includes("H")).map((u) => u.card.name),
    prerequisites: [v.easyPrerequisites, v.notablePrerequisites].filter(Boolean).join("\n"),
    steps: (v.description ?? "").split("\n").filter(Boolean),
    popularity: v.popularity ?? 0,
    url: `https://commanderspellbook.com/combo/${v.id}/`,
  };
}

async function variants(q) {
  const res = await fetch(`${API}/variants/?q=${encodeURIComponent(q)}&limit=100&ordering=-popularity`, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Commander Spellbook responded ${res.status}`);
  return (await res.json()).results ?? [];
}

/**
 * Up to a few hundred combo lines for `commanders` (names) with colour identity `identity` (e.g. ["U", "G"]): the
 * commanders' own combos, the most played game-winning combos in those colours, and the most played combos overall.
 */
export async function combosFor(commanders, identity) {
  const ci = identity.length ? identity.join("").toLowerCase() : "c";
  const key = `${[...commanders].sort().join("|")}:${ci}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  const queries = [
    ...commanders.map((c) => `card:"${c.replace(/"/g, "")}" legal:commander`),
    `ci<=${ci} legal:commander result:"Win the game"`,
    `ci<=${ci} legal:commander`,
  ];
  const seen = new Map();
  for (const q of queries) for (const v of await variants(q)) if (!seen.has(v.id)) seen.set(v.id, toLine(v, commanders));
  const value = [...seen.values()].filter(Boolean);
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}
