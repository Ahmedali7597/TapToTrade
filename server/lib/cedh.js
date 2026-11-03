import { commanderSuggestions } from "./edhrec.js";
import { usdToCad } from "./prices.js";
import { searchCards } from "./scryfall.js";
import { combosFor } from "./spellbook.js";

// The deck optimizer's candidate pool: every card it may suggest for one commander, checked on Scryfall (Commander
// legality, which follows Wizards' banned list, colour identity and price) and tagged with its role. Candidates come
// from EDHREC's cEDH and regular pages for the commander, Commander Spellbook's combos, a list of well-known cEDH
// staples, and the player's own deck. Prices are the cheapest paper printing's TCGplayer market price (via Scryfall)
// converted to CAD: estimates, not TapToTrade listings. All of these sources are free.

// Well-known cEDH staples and their roles. `net` is the extra mana a fast-mana card makes; `finds` what a tutor can
// find ("any" card, or card types). Scryfall decides whether each is legal (Mana Crypt, for one, is banned).
const fast = (net = 1) => ({ roles: ["fastMana"], net });
const tutor = (finds = "any", ...more) => ({ roles: ["tutor", ...more], finds });
const free = (...roles) => ({ roles: roles.length ? roles : ["interaction"], free: true });
const role = (...roles) => ({ roles });
export const STAPLES = {
  "Mana Vault": fast(2), "Sol Ring": fast(1), "Grim Monolith": fast(1), "Basalt Monolith": fast(1), "Chrome Mox": fast(1),
  "Mox Diamond": fast(1), "Mox Opal": fast(1), "Mox Amber": fast(1), "Lotus Petal": fast(1), "Lion's Eye Diamond": fast(3),
  "Mana Crypt": fast(2), "Jeweled Lotus": fast(3), "Dark Ritual": fast(2), "Cabal Ritual": fast(1), "Culling the Weak": fast(2),
  "Rite of Flame": fast(1), "Pyretic Ritual": fast(1), "Desperate Ritual": fast(1), "Seething Song": fast(2), "Jeska's Will": fast(3),
  "Simian Spirit Guide": fast(1), "Elvish Spirit Guide": fast(1), "Springleaf Drum": fast(1), "Carpet of Flowers": fast(1),
  "Elvish Mystic": fast(1), "Llanowar Elves": fast(1), "Fyndhorn Elves": fast(1), "Birds of Paradise": fast(1), "Noble Hierarch": fast(1),
  "Delighted Halfling": fast(1), "Avacyn's Pilgrim": fast(1), "Utopia Sprawl": fast(1), "Wild Growth": fast(1), "Paradise Mantle": fast(1),
  "Arcane Signet": role("ramp"), "Fellwar Stone": role("ramp"), "Talisman of Dominance": role("ramp"), "Talisman of Creativity": role("ramp"),
  "Demonic Tutor": tutor(), "Vampiric Tutor": tutor(), "Imperial Seal": tutor(), "Grim Tutor": tutor(), "Diabolic Intent": tutor(),
  "Demonic Consultation": tutor("any", "wincon"), "Tainted Pact": tutor("any", "wincon"), "Mystical Tutor": tutor(["instant", "sorcery"]),
  "Personal Tutor": tutor(["sorcery"]), "Merchant Scroll": tutor(["instant"]), "Enlightened Tutor": tutor(["artifact", "enchantment"]),
  "Worldly Tutor": tutor(["creature"]), "Sylvan Tutor": tutor(["creature"]), "Gamble": tutor(), "Intuition": tutor(), "Gifts Ungiven": tutor(),
  "Muddle the Mixture": tutor(), "Dimir Machinations": tutor(), "Final Parting": tutor(), "Beseech the Mirror": tutor(), "Lim-Dûl's Vault": tutor(),
  "Scheming Symmetry": tutor(), "Profane Tutor": tutor(), "Finale of Devastation": tutor(["creature"]), "Green Sun's Zenith": tutor(["creature"]),
  "Chord of Calling": tutor(["creature"]), "Eldritch Evolution": tutor(["creature"]), "Neoform": tutor(["creature"]),
  "Survival of the Fittest": tutor(["creature"]), "Fabricate": tutor(["artifact"]), "Whir of Invention": tutor(["artifact"]),
  "Reshape": tutor(["artifact"]), "Transmute Artifact": tutor(["artifact"]), "Tinker": tutor(["artifact"]), "Recruiter of the Guard": tutor(["creature"]),
  "Ranger-Captain of Eos": tutor(["creature"], "protection"), "Spellseeker": tutor(["instant", "sorcery"]), "Solve the Equation": tutor(["instant", "sorcery"]),
  "Idyllic Tutor": tutor(["enchantment"]), "Moonsilver Key": tutor(["artifact"]), "Wishclamp": role("draw"),
  "Force of Will": free(), "Force of Negation": free(), "Fierce Guardianship": free(), "Pact of Negation": free(), "Mental Misstep": free(),
  "Mindbreak Trap": free(), "Daze": free(), "Misdirection": free(), "Commandeer": free(), "Deadly Rollick": free(), "Snuff Out": free(),
  "Subtlety": free(), "Solitude": free(), "Fury": free(), "Grief": free(), "Foil": free(), "Gush": free("draw"),
  "Deflecting Swat": free("protection"), "Flawless Maneuver": free("protection"), "Swan Song": role("interaction"), "Spell Pierce": role("interaction"),
  "Flusterstorm": role("interaction"), "Mana Drain": role("interaction"), "Counterspell": role("interaction"), "Arcane Denial": role("interaction"),
  "An Offer You Can't Refuse": role("interaction"), "Stern Scolding": role("interaction"), "Red Elemental Blast": role("interaction"),
  "Pyroblast": role("interaction"), "Abrupt Decay": role("interaction"), "Assassin's Trophy": role("interaction"), "Nature's Claim": role("interaction"),
  "Chain of Vapor": role("interaction"), "Snap": role("interaction"), "Swords to Plowshares": role("interaction"), "Path to Exile": role("interaction"),
  "Fatal Push": role("interaction"), "Lightning Bolt": role("interaction"), "Abrade": role("interaction"), "Tormod's Crypt": role("interaction"),
  "Soul-Guide Lantern": role("interaction"), "Endurance": role("interaction"), "Dispel": role("interaction"), "Tibalt's Trickery": role("interaction"),
  "Drannith Magistrate": role("interaction"), "Collector Ouphe": role("interaction"), "Null Rod": role("interaction"), "Cursed Totem": role("interaction"),
  "Silence": role("protection"), "Orim's Chant": role("protection"), "Grand Abolisher": role("protection"), "Veil of Summer": role("protection", "draw"),
  "Autumn's Veil": role("protection"), "Heroic Intervention": role("protection"), "Teferi's Protection": role("protection"), "Defense Grid": role("protection"),
  "Dosan the Falling Leaf": role("protection"), "City of Solitude": role("protection"), "Boros Charm": role("protection"), "Tyvar's Stand": role("protection"),
  "Mother of Runes": role("protection"), "Giver of Runes": role("protection"),
  "Rhystic Study": role("draw"), "Mystic Remora": role("draw"), "Esper Sentinel": role("draw"), "Necropotence": role("draw"), "Ad Nauseam": role("draw", "wincon"),
  "Wheel of Fortune": role("draw"), "Windfall": role("draw"), "Timetwister": role("draw"), "Brainstorm": role("draw"), "Ponder": role("draw"),
  "Preordain": role("draw"), "Gitaxian Probe": role("draw"), "Night's Whisper": role("draw"), "Sign in Blood": role("draw"), "Sylvan Library": role("draw"),
  "Dark Confidant": role("draw"), "Bolas's Citadel": role("draw"), "Faithless Looting": role("draw"), "Skullclamp": role("draw"), "The One Ring": role("draw"),
  "Consecrated Sphinx": role("draw"), "Frantic Search": role("draw"), "Mishra's Bauble": role("draw"), "Urza's Bauble": role("draw"), "Lórien Revealed": role("draw"),
  "Trouble in Pairs": role("draw"), "Archivist of Oghma": role("draw"), "Valakut Awakening": role("draw"), "Peer into the Abyss": role("draw"),
  "Praetor's Grasp": tutor(), "Thassa's Oracle": role("wincon"), "Laboratory Maniac": role("wincon"), "Jace, Wielder of Mysteries": role("wincon"),
  "Underworld Breach": role("wincon", "draw"), "Grapeshot": role("wincon"), "Brain Freeze": role("wincon"), "Tendrils of Agony": role("wincon"),
  "Aetherflux Reservoir": role("wincon"), "Walking Ballista": role("wincon"), "Dualcaster Mage": role("wincon"), "Kiki-Jiki, Mirror Breaker": role("wincon"),
  "Isochron Scepter": role("wincon"), "Dramatic Reversal": role("wincon"), "Doomsday": role("wincon"), "Hermit Druid": role("wincon"),
};

const BASICS = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
const ORDER = ["land", "fastMana", "tutor", "interaction", "protection", "draw", "ramp", "wincon", "other"];
const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const TYPES = ["artifact", "creature", "enchantment", "instant", "sorcery", "planeswalker", "equipment", "aura"];

/** Lower-case front-face name, how cards are matched across EDHREC, Spellbook, decklists and Scryfall. */
export const front = (name) => String(name).split(" // ")[0].trim().toLowerCase();

const textOf = (c) => [c.oracle_text, ...(c.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join("\n");
const typeOf = (c) => c.card_faces?.[0]?.type_line ?? c.type_line ?? "";
const costOf = (c) => c.card_faces?.[0]?.mana_cost ?? c.mana_cost ?? "";

/** The most mana one "Add …" on the card makes: {R}{R}{R} is 3, "three mana" is 3. */
export function manaAdded(text) {
  let most = 0;
  for (const m of text.matchAll(/\badd ((?:\{[^}]+\})+)/gi)) most = Math.max(most, m[1].match(/\{/g).length);
  for (const m of text.matchAll(/\badd (one|two|three|four|five) mana/gi)) most = Math.max(most, NUMBERS[m[1].toLowerCase()]);
  return most;
}

/** What a tutor can find from its text: "any", a list of card types, or null if it isn't a tutor (land searches aren't). */
export function tutorTargets(text) {
  if (/\btransmute \{/i.test(text)) return "any";
  const m = /search your library for (?:a|an|up to one|one|any one)\s+([^.]*?)\s*card\b/i.exec(text);
  if (!m || /land|basic/i.test(m[1])) return null;
  const types = TYPES.filter((t) => m[1].toLowerCase().includes(t));
  if (types.length) return types;
  // "a Goblin card", "a red card": only cards whose type line names it (colours never match, which is the safe side).
  const words = m[1].toLowerCase().split(/\s+/).filter((w) => w && !["or", "and", "nonland", "other"].includes(w));
  return words.length ? words : "any";
}

/** Roles and play details for a raw Scryfall card, from its text (overridden by STAPLES for the well-known ones). */
export function classify(c) {
  const text = textOf(c);
  const type = typeOf(c);
  const mv = c.cmc ?? 0;
  const cost = costOf(c);
  const out = { roles: [], free: false, cheap: mv <= 2, net: 0, finds: null };
  if (/\bLand\b/.test(type)) {
    out.roles.push("land");
  } else {
    const added = manaAdded(text);
    const makesMana = added > 0 || (c.produced_mana?.length ?? 0) > 0;
    if (makesMana) {
      const spell = /\b(Instant|Sorcery)\b/.test(type);
      if ((spell && added - mv >= 1) || (!spell && (mv <= 1 || (/Artifact/.test(type) && added - mv >= 1)))) {
        out.roles.push("fastMana");
        out.net = Math.max(1, added - mv);
      } else if (!spell && mv <= 3) out.roles.push("ramp");
    }
    out.finds = tutorTargets(text);
    if (out.finds) out.roles.push("tutor");
    else if (/search your library for [^.]*land card[^.]*onto the battlefield/i.test(text)) out.roles.push("ramp");
    if (
      /counter target|destroy target|exile target (?!card you own)|return target (?:nonland )?(?:permanent|creature|artifact|enchantment|spell)[^.]*owner's hand|deals? \d+ damage to (?:any target|target creature)|target player sacrifices|each opponent sacrifices|destroy all|exile all|exile (?:each|target player's) graveyard/i.test(
        text,
      )
    ) {
      out.roles.push("interaction");
    }
    if (/your opponents can't cast spells|can't cast spells this turn|(?:you|permanents you control|creatures you control) (?:gain|have) (?:hexproof|indestructible|shroud|protection)|change the target|choose new targets|phase out/i.test(text)) {
      out.roles.push("protection");
    }
    if (/\bdraws? (?:a|an|one|two|three|four|five|six|seven|x|that many) cards?|\bdraw cards equal|put (?:it|that card|one of them|them|those cards) into your hand/i.test(text)) out.roles.push("draw");
    if (/you win the game|each opponent loses \d+ life/i.test(text)) out.roles.push("wincon");
    // Free: an alternative cost that needs no mana, a mana value of 0, or a cost of Phyrexian mana only (paid with life).
    const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((s) => s[1]);
    out.free = /cast this spell without paying its mana cost|rather than pay this spell's mana cost/i.test(text) || (mv === 0 && cost !== "" && !/Artifact|Creature/.test(type)) || (symbols.length > 0 && symbols.every((s) => s.endsWith("/P")));
  }
  const staple = STAPLES[c.name] ?? STAPLES[c.card_faces?.[0]?.name];
  if (staple) Object.assign(out, staple, { roles: staple.roles, staple: true });
  out.roles = [...new Set(out.roles)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  if (!out.roles.length) out.roles.push("other");
  return out;
}

// ---- Card lookups by name, cheapest printing first, kept for a day ----

const DAY = 86_400_000;
const cards = new Map(); // front name -> { at, card | null }

/** Raw Scryfall cards for `names` (cheapest paper printing of each), as Map(front name -> card). Unknown names are left out. */
export async function lookupNames(names) {
  const wanted = [...new Set(names.map(front))].filter(Boolean);
  const missing = wanted.filter((n) => !(cards.get(n) && Date.now() - cards.get(n).at < DAY));
  // Exact-name searches, as many names per request as fit: Scryfall cuts queries off at about 1,000 characters.
  const clause = (n) => `!"${n.replace(/"/g, "")}"`;
  const batches = [];
  let batch = [];
  let length = 0;
  for (const n of missing) {
    if (batch.length && length + clause(n).length + 4 > 850) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(n);
    length += clause(n).length + 4;
  }
  if (batch.length) batches.push(batch);
  for (const b of batches) {
    const q = `(${b.map(clause).join(" or ")}) game:paper prefer:usd-low`;
    const found = await searchCards(q, { pages: 2 });
    for (const n of b) cards.set(n, { at: Date.now(), card: null });
    for (const c of found) {
      for (const key of [front(c.name), c.name.toLowerCase()]) if (b.includes(key)) cards.set(key, { at: Date.now(), card: c });
    }
  }
  if (cards.size > 30000) cards.clear(); // ponytail: crude cap, an LRU if it ever matters
  return new Map(wanted.filter((n) => cards.get(n)?.card).map((n) => [n, cards.get(n).card]));
}

/** The lowest of a card's USD market prices (non-foil, foil, etched), or null when Scryfall has none. */
export function lowestUsd(c) {
  const all = [c.prices?.usd, c.prices?.usd_foil, c.prices?.usd_etched].filter((p) => p != null).map(Number);
  return all.length ? Math.min(...all) : null;
}

/** One pool card for the optimizer (see shared/optimizer.js) from a raw Scryfall card. */
export function poolCard(c, identity, usdCad, cedh = null) {
  const usd = lowestUsd(c);
  const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  const type = typeOf(c);
  return {
    name: c.name,
    printingId: c.id,
    setCode: c.set,
    collectorNumber: c.collector_number,
    imageUrl: images?.normal ?? null,
    typeLine: type,
    manaValue: c.cmc ?? 0,
    manaCost: costOf(c),
    colorIdentity: c.color_identity ?? [],
    legal: c.legalities?.commander === "legal",
    inIdentity: (c.color_identity ?? []).every((x) => identity.includes(x)),
    basic: /\bBasic\b/.test(type),
    price: usd == null ? null : Math.round(usd * usdCad * 100) / 100,
    priceUsd: usd,
    produces: c.produced_mana ?? [],
    tapped: /enters (?:the battlefield )?tapped/i.test(textOf(c)) && !/unless|you may pay/i.test(textOf(c)),
    gameChanger: Boolean(c.game_changer),
    rank: c.edhrec_rank ?? null,
    cedh,
    ...classify(c),
  };
}

/** Can these cards be commanders together? One legendary creature (or "can be your commander"), or a legal pair. */
export function commanderProblem(list) {
  if (!list.length || list.length > 2) return "Choose one commander, or two that can be partners.";
  for (const c of list) {
    const type = typeOf(c);
    if (!(/Legendary/.test(type) && /Creature/.test(type)) && !/can be your commander/i.test(textOf(c)) && !/Background/.test(type)) return `${c.name} can't be a commander: it isn't a legendary creature.`;
    if (c.legalities?.commander !== "legal") return `${c.name} is banned as a commander.`;
  }
  if (list.length === 2) {
    const [a, b] = list.map(textOf);
    const pair = (x, y, t) => (/\bPartner\b|Friends forever/i.test(x) && /\bPartner\b|Friends forever/i.test(y)) || (/Choose a Background/i.test(x) && /Background/.test(t));
    if (!pair(a, b, typeOf(list[1])) && !pair(b, a, typeOf(list[0])) && !/Doctor's companion/i.test(a + b)) return "Those two can't be commanders together: they need Partner, Friends forever, or a Background.";
  }
  return null;
}

const pools = new Map(); // commander key -> { at, value }

/**
 * Everything the optimizer needs for `commanders` (raw Scryfall cards) and the player's `deckNames`:
 * { pool, combos, identity, rate, sources }. The commander part is cached for six hours; the deck's own cards join it.
 */
export async function buildPool(commanders, deckNames = []) {
  const names = commanders.map((c) => c.name);
  const identity = [...new Set(commanders.flatMap((c) => c.color_identity ?? []))].sort();
  const key = names.slice().sort().join("|");
  let base = pools.get(key);
  if (!base || Date.now() - base.at > 6 * 3_600_000) {
    const [cedhPage, page, lines] = await Promise.all([
      commanderSuggestions(names, "cedh").catch(() => null),
      commanderSuggestions(names).catch(() => null),
      combosFor(names, identity),
    ]);
    const cedh = new Map();
    for (const l of cedhPage?.lists ?? []) for (const c of l.cards) cedh.set(front(c.name), Math.max(cedh.get(front(c.name)) ?? 0, c.inclusion ?? 0));
    // The most played lines with at most four pieces, so the pool stays a few hundred cards.
    const combos = lines.filter((l) => l.pieces.length <= 4).sort((a, b) => b.popularity - a.popularity).slice(0, 150);
    const candidates = [
      ...cedh.keys(),
      ...(page?.lists ?? []).flatMap((l) => l.cards.map((c) => c.name)),
      ...combos.flatMap((l) => l.pieces),
      ...Object.keys(STAPLES),
      ...(identity.length ? identity.map((x) => BASICS[x]) : ["Wastes"]),
    ];
    base = { at: Date.now(), value: { candidates, cedh, combos, sources: { cedh: cedhPage?.url ?? null, edhrec: page?.url ?? null } } };
    pools.set(key, base);
    if (pools.size > 100) pools.delete(pools.keys().next().value);
  }
  const { candidates, cedh, combos, sources } = base.value;
  const [{ usdCad, date }, found] = await Promise.all([usdToCad(), lookupNames([...candidates, ...deckNames, ...names])]);
  const pool = [...found.values()].map((c) => poolCard(c, identity, usdCad, cedh.get(front(c.name)) ?? null));
  // The same card can be found under two keys (front face and full name).
  const unique = [...new Map(pool.map((c) => [c.name, c])).values()];
  const inPool = new Set(unique.map((c) => c.name));
  // Spellbook names double-faced cards by their full name too; keep lines whose every piece we could check.
  const nameOf = new Map(unique.map((c) => [front(c.name), c.name]));
  const usable = combos
    .map((l) => ({ ...l, pieces: l.pieces.map((p) => nameOf.get(front(p)) ?? p), battlefield: l.battlefield.map((p) => nameOf.get(front(p)) ?? p) }))
    .filter((l) => l.pieces.every((p) => inPool.has(p)));
  return { pool: unique, combos: usable, identity, rate: { usdCad, date }, sources: { ...sources, spellbook: "https://commanderspellbook.com" } };
}
