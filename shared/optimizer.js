// The Commander deck optimizer: builds the strongest 99 it can around a locked commander within a budget in CAD,
// then reports the deck's odds and scores. Pure functions, so the page can re-run it on every budget change without
// asking the server, and the tests can check every rule. The server sends the candidate `pool` (cards it has
// verified on Scryfall: legal, inside the colour identity, with a real price) and the `combos` (Commander Spellbook
// lines whose pieces are all in the pool).
//
// Pool card: { name, roles: [primary, ...], price (CAD or null), manaValue, typeLine, legal, inIdentity, basic, cedh
//   (share of cEDH decks for this commander running it, from EDHREC), staple, free, cheap, net (mana a fast-mana card
//   adds), finds (what a tutor can find: "any" or type words), produces (land colours), tapped, rank (EDHREC rank),
//   jobs and features (Scryfall Tagger tags, see JOBS and FEATURES), drawbacks (see DRAWBACKS), power, toughness,
//   recAdd and recCut (EDHREC's suggestions for the player's exact list, 0-1: how strongly to add or cut the card; null
//   when it didn't rate it), superiors ([[name, upvotes, downvotes]]: pool cards players on Strictly Better voted
//   strictly better than this one) }
// Learned: what players did with earlier suggestions, { pairs: [[cut, add, took, turned down]], adds: [[add, took,
//   turned down]] } (the adds for this commander only), from server/routes/optimizer.js.
// Strategy: what the commander rewards, from its rules text and EDHREC's themes (server/lib/cedh.js strategyOf):
//   { fuel ("mana value", "power" or "toughness": the creature stat it turns into value, or null),
//     plans: [{ text, tags }] ("attacks", with the jobs and features that help it), themes: [names] }
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
/**
 * What a card does, finer than its role: Scryfall Tagger's function tags (searched with otag:), most specific first.
 * A swap only counts as a replacement when the new card does the old card's main job (its first one here).
 */
export const JOBS = {
  "board-wipe": "board wipe",
  counterspell: "counterspell",
  "creature-removal": "creature removal",
  "artifact-removal": "artifact removal",
  "enchantment-removal": "enchantment removal",
  "planeswalker-removal": "planeswalker removal",
  "graveyard-hate": "graveyard hate",
  ritual: "ritual",
  "mana-rock": "mana rock",
  "mana-dork": "mana creature",
  "land-ramp": "land ramp",
  tutor: "tutor",
  wheel: "wheel",
  cantrip: "cantrip",
  draw: "card draw",
  reanimate: "reanimation",
  recursion: "recursion",
  "discard-outlet": "discard outlet",
  "sacrifice-outlet": "sacrifice outlet",
  burn: "burn",
};
/** Removal jobs: a replacement has to hit at least everything the old card hit. */
export const REMOVAL = ["creature-removal", "artifact-removal", "enchantment-removal", "planeswalker-removal"];
/**
 * What else a card does for the deck's plan, also Scryfall Tagger tags. A direct replacement keeps every one of
 * these: Eerie Gravestone draws a card once, so it can't replace Garruk's Uprising, which keeps drawing and gives trample.
 */
export const FEATURES = {
  "repeatable-draw": "keeps drawing cards",
  "gives-trample": "gives your creatures trample",
  "gives-haste": "gives creatures haste",
  "gives-flying": "gives creatures flying",
  "gives-menace": "gives creatures menace",
  "gives-hexproof": "gives creatures hexproof",
  "gives-indestructible": "makes creatures indestructible",
  "power-matters": "rewards creatures with high power",
  "death-trigger": "does something when a creature dies",
  "cheat-into-play": "puts cards onto the battlefield without casting them",
  "extra-combat": "gives extra combats",
  "cost-reducer": "reduces mana costs",
  "counters-matter": "uses counters",
  "self-mill": "fills your graveyard",
  landfall: "rewards lands entering",
};
const featuresOf = (c) => c.features ?? [];
/**
 * Downsides in a card's rules text (server/lib/cedh.js textDrawbacks), each as [what it does, what a card without it
 * does]. A strictly better card never adds one: Infernal Grasp costs life, so it isn't strictly better than Murder.
 */
export const DRAWBACKS = {
  life: ["costs you life", "doesn't cost you life"],
  "helps-opponent": ["gives an opponent something back", "gives opponents nothing back"],
  symmetric: ["helps every player, not just you", "only helps you"],
  "extra-cost": ["needs a creature, card or permanent of yours to cast", "needs nothing extra to cast"],
  upkeep: ["costs you something every turn", "costs nothing every turn"],
};
const drawbacksOf = (c) => c.drawbacks ?? [];

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

/**
 * How good a card is for a regular (not cEDH) deck with this commander: how many of its decks on EDHREC play it and
 * how much more than other decks of its colours (synergy). Used to top up a short list in the preserve and value goals.
 */
export function deckValue(c) {
  if (c.basic) return 5;
  const v = 8 + (c.edh ?? 0) * 60 + Math.max(0, c.synergy ?? 0) * 30;
  if (isLand(c)) return v + Math.max(0, (c.produces?.length ?? 1) - 1) * 4 - (c.tapped ? 6 : 0);
  return v + (mainJob(c) ? 4 : 0) - Math.max(0, castFor(c) - 3) * 2;
}

/** A card's worth in a deck that already has `counts` of each role: full value up to the role's target, half after. */
const marginal = (c, counts, worth = cardValue) => {
  const role = primary(c);
  const over = role !== "land" && (counts[role] ?? 0) >= (TARGETS[role] ?? 0);
  return worth(c) * (over ? 0.5 : 1);
};

// Which jobs count as a card's main job for each role. A card with none (a plain creature, a combo piece) has no
// main job, so nothing is offered as a like-for-like replacement for it.
const ROLE_JOBS = {
  interaction: ["board-wipe", "counterspell", ...REMOVAL, "graveyard-hate", "burn"],
  fastMana: ["ritual", "mana-rock", "mana-dork", "land-ramp"],
  ramp: ["ritual", "mana-rock", "mana-dork", "land-ramp"],
  tutor: ["tutor"],
  draw: ["wheel", "cantrip", "draw"],
};
const SYNERGY_JOBS = ["reanimate", "recursion", "discard-outlet", "sacrifice-outlet"];

/**
 * The one job a replacement must also do: the most specific of the card's jobs that fits its role, or null. A card
 * that keeps drawing (Garruk's Uprising) is card draw first, even if it also draws a card when it enters.
 */
export function mainJob(c) {
  const allowed = ROLE_JOBS[primary(c)] ?? SYNERGY_JOBS;
  return Object.keys(JOBS).find((j) => allowed.includes(j) && c.jobs?.includes(j) && !(j === "cantrip" && featuresOf(c).includes("repeatable-draw") && c.jobs.includes("draw"))) ?? null;
}

/** Which of the deck's colours a land can make (a fetch land finds a land of the basic types it names, or of any of them). */
const coloursOf = (c, identity) => identity.filter((x) => (c.fetch ? (c.fetches ?? identity) : (c.produces ?? [])).includes(x));

/** A creature's mana value, power or toughness: the stat a commander like Venom turns into cards (strategy.fuel). */
const fuelOf = (c, fuel) => (fuel === "mana value" ? (c.manaValue ?? 0) : fuel === "power" ? c.power : c.toughness) ?? 0;
const fuels = (c, strategy) => Boolean(strategy?.fuel) && typeOf(c) === "creature";

/**
 * What even a budget swap keeps: the jobs and features that tie `y` to the commander's plan (Vaultborn Tyrant's death
 * trigger for Venom), a creature when the commander feeds on creatures, and at least one of `y`'s features.
 */
function keepsRole(x, y, strategy) {
  const has = new Set([...(x.jobs ?? []), ...featuresOf(x)]);
  const plan = new Set(strategy?.plans?.flatMap((p) => p.tags) ?? []);
  if (![...(y.jobs ?? []), ...featuresOf(y)].every((t) => !plan.has(t) || has.has(t))) return false;
  if (fuels(y, strategy) && typeOf(x) !== "creature") return false;
  return !featuresOf(y).length || featuresOf(y).some((f) => has.has(f));
}

/**
 * Can `x` take `y`'s slot as a direct replacement? It has to do `y`'s main job (and removal has to hit at least
 * everything `y` hits). `exact` (the default) also asks for everything else `y` does for the deck: its other jobs and
 * features (Garruk's Uprising's trample, Return to Nature's graveyard exile), and the stat the commander feeds on
 * (a creature `strategy.fuel` turns into cards is never swapped for a smaller one). Fitting a budget may give some of
 * those up (exact: false) and says so, but never what ties `y` to the commander's plan (keepsRole). A land is replaced by a land that makes at least as many of the deck's colours
 * and doesn't enter tapped when `y` didn't.
 */
export function replaces(x, y, identity = [], { strategy = null, exact = true } = {}) {
  if (isLand(y) || isLand(x)) {
    return isLand(y) && isLand(x) && coloursOf(x, identity).length >= coloursOf(y, identity).length && !(x.tapped && !y.tapped);
  }
  const job = mainJob(y);
  if (!job || !x.jobs?.includes(job) || primary(x) !== primary(y)) return false;
  // A synergy piece (reanimation, a sacrifice outlet...) is only replaced by a card of the same type: a deck that
  // sacrifices creatures needs a creature back, not an enchantment.
  if (SYNERGY_JOBS.includes(job) && typeOf(x) !== typeOf(y)) return false;
  // A spell is replaced by a spell and a permanent by a permanent: a draw spell isn't a creature that draws.
  const spell = (c) => ["instant", "sorcery"].includes(typeOf(c));
  if (spell(x) !== spell(y)) return false;
  // A tutor has to put the card where the old one did (a hand tutor may replace one that puts it on top).
  if (job === "tutor" && (x.tutorTo ?? "hand") !== (y.tutorTo ?? "hand") && !(x.tutorTo === "hand" && y.tutorTo === "top")) return false;
  if (REMOVAL.includes(job) && !y.jobs.filter((j) => REMOVAL.includes(j)).every((j) => x.jobs.includes(j))) return false;
  // Damage-only removal has to kill what the old card did: Lightning Bolt's 3 isn't Doom Blade's destroy, and End the
  // Festivities' 1 isn't Blasphemous Act's 13.
  if ((job === "board-wipe" || REMOVAL.includes(job)) && x.damage != null && x.damage < (y.damage ?? Infinity)) return false;
  if (!exact) return keepsRole(x, y, strategy);
  // A creature stays a creature (it can be sacrificed, reanimated, attack), and does everything `y` did.
  if ((typeOf(x) === "creature") !== (typeOf(y) === "creature")) return false;
  if (!shownJobs(y).every((j) => x.jobs.includes(j)) || !featuresOf(y).every((f) => featuresOf(x).includes(f))) return false;
  if (x.manaRestricted && !y.manaRestricted) return false;
  return !(fuels(y, strategy) && fuelOf(x, strategy.fuel) < fuelOf(y, strategy.fuel));
}

/** Share of the commander's decks on EDHREC playing a card: cEDH decks when building for maximum power, all decks otherwise. */
const playRate = (c, mode) => (mode === "max" ? c.cedh : c.edh) ?? 0;

/**
 * What `x` does better and worse than `y`, as short clauses about `x` ("it costs 1 less mana (2 instead of 3)"), and a
 * score for how much better it is: { gains: [...], losses: [...], score, worse }. `worse` counts the losses about what
 * the cards themselves do (not how many decks play them): a strictly better card has none. Only things we know about
 * both cards count.
 */
export function compare(x, y, { mode = "preserve", identity = [], commander = "your commander", strategy = null } = {}) {
  const gains = [];
  const losses = [];
  let score = 0;
  const added = drawbacksOf(x).filter((d) => !drawbacksOf(y).includes(d));
  if (added.length) (losses.push(`it ${list(added.map((d) => DRAWBACKS[d][0]), "and")}`), (score -= 6 * added.length));
  const dropped = drawbacksOf(y).filter((d) => !drawbacksOf(x).includes(d));
  if (dropped.length) (gains.push(`it ${list(dropped.map((d) => DRAWBACKS[d][1]), "and")}, where ${y.name} ${list(dropped.map((d) => DRAWBACKS[d][0]), "and")}`), (score += 4 * dropped.length));
  // Jobs the old card did that the new one doesn't (Commander's Sphere also draws a card; Bojuka Bog exiles a graveyard).
  const lost = (isLand(y) ? (y.jobs ?? []) : shownJobs(y)).filter((j) => !x.jobs?.includes(j) && !(REMOVAL.includes(j) && x.jobs?.includes("board-wipe")));
  if (lost.length) (losses.push(`it gives up ${y.name}'s ${list(lost.map((j) => JOBS[j]), "and")}`), (score -= 5 * lost.length));
  const lostFeatures = featuresOf(y).filter((f) => !featuresOf(x).includes(f));
  if (lostFeatures.length) (losses.push(`it gives up that ${y.name} ${list(lostFeatures.map((f) => FEATURES[f]), "and")}`), (score -= 5 * lostFeatures.length));
  if (isLand(x) && isLand(y)) {
    const more = coloursOf(x, identity).length - coloursOf(y, identity).length;
    const colours = `it makes ${coloursOf(x, identity).length} of your colours instead of ${coloursOf(y, identity).length}`;
    if (more > 0) gains.push(colours);
    if (more < 0) losses.push(colours);
    score += 8 * more;
    if (y.tapped && !x.tapped) (gains.push("it enters untapped, so it doesn't cost you a turn's mana"), (score += 6));
    if (x.tapped && !y.tapped) (losses.push("it enters tapped"), (score -= 6));
  } else {
    // What it does on top of everything the old card did (Heritage Reclamation is Return to Nature that also draws).
    const extra = [
      ...shownJobs(x).filter((j) => !REMOVAL.includes(j) && !y.jobs?.includes(j) && !(j === "draw" && x.jobs.includes("cantrip"))).map((j) => (j === "cantrip" ? "it also draws a card" : j === "draw" ? "it also draws cards" : `it's also ${aJob(j)}`)),
      ...featuresOf(x).filter((f) => !featuresOf(y).includes(f)).map((f) => `it also ${FEATURES[f]}`),
    ];
    gains.push(...extra);
    // An extra job or a feature the commander's plan uses is worth about a mana; others (Dragon's Hoard's counters in a
    // deck without counters) barely count.
    const wanted = new Set(["repeatable-draw", ...(strategy?.plans ?? []).flatMap((p) => p.tags)]);
    const extraJobs = extra.length - featuresOf(x).filter((f) => !featuresOf(y).includes(f)).length;
    const extraWanted = featuresOf(x).filter((f) => !featuresOf(y).includes(f) && wanted.has(f)).length;
    score += 6 * Math.min(2, extraJobs + extraWanted) + 2 * (extra.length - extraJobs - extraWanted);
    // A creature the commander turns into value (Venom draws cards equal to the sacrificed creature's mana value): a
    // bigger one is better and a smaller one worse, whatever it costs to cast.
    const fuel = fuels(y, strategy) && fuels(x, strategy) ? strategy.fuel : null;
    if (fuel) {
      const more = fuelOf(x, fuel) - fuelOf(y, fuel);
      const clause = `its ${fuel} is ${fuelOf(x, fuel)} instead of ${fuelOf(y, fuel)}, and ${commander} gets more from a creature with higher ${fuel}`;
      if (more > 0) gains.push(clause);
      if (more < 0) losses.push(clause);
      score += more * 4;
    }
    // For such a creature a higher cost is the point, so it's only mentioned, not counted.
    // An X spell costs what X is: its mana value says nothing about that.
    const mana = xCost(x) || xCost(y) ? 0 : castFor(y) - castFor(x);
    if (xCost(x) && !xCost(y)) (losses.push(`it costs ${x.manaCost}, so it takes more mana to do more`), (score -= 4));
    // A free spell's alternative cost is its own clause below.
    if (mana > 0 && fuel !== "mana value" && !x.free) gains.push(`it costs ${mana} less mana (${castFor(x)} instead of ${castFor(y)})`);
    if (mana < 0 && !y.free) losses.push(`it costs ${-mana} more mana (${castFor(x)} instead of ${castFor(y)})`);
    if (fuel !== "mana value") score += mana * 6;
    if (x.manaRestricted && !y.manaRestricted) (losses.push(`its mana can only pay for some spells, where ${y.name}'s pays for any`), (score -= 8));
    if (y.free && !x.free) losses.push(`it costs ${castFor(x)} mana, where ${y.name} can be cast for free`);
    if (x.free && !y.free) (gains.push(`it can be cast for free with its alternative cost, where ${y.name} costs ${castFor(y)} mana`), (score += 8));
    if (x.instant && !y.instant) (gains.push("it can be cast at instant speed, on an opponent's turn"), (score += 4));
    if (y.instant && !x.instant) (losses.push(`it's cast at sorcery speed, where ${y.name} was instant speed`), (score -= 4));
    const hits = REMOVAL.filter((j) => x.jobs?.includes(j) && !y.jobs?.includes(j)).map((j) => JOBS[j].replace(" removal", "s"));
    if (hits.length && y.jobs?.some((j) => REMOVAL.includes(j))) (gains.push(`it also hits ${list(hits, "and")}`), (score += 3 * hits.length));
    if (x.finds === "any" && Array.isArray(y.finds)) (gains.push(`it finds any card, not just ${list(y.finds)} cards`), (score += 5));
    if ((x.net ?? 0) > (y.net ?? 0) && primary(y) === "fastMana") (gains.push(`it makes ${x.net - y.net} more mana`), (score += 5 * (x.net - y.net)));
  }
  // Wizards' Game Changers list names the strongest Commander cards; trading one away for a card that isn't costs power.
  if (y.gameChanger && !x.gameChanger) (losses.push(`${y.name} is on Wizards' Game Changers list of the strongest Commander cards, and it isn't`), (score -= 15));
  const worse = losses.length;
  // Every deck plays basics: EDHREC's share says nothing about one.
  if (x.basic || y.basic) return { gains, losses, score, worse };
  const rate = playRate(x, mode) - playRate(y, mode);
  score += rate * 100;
  const decks = `${mode === "max" ? "cEDH " : ""}${commander} decks on EDHREC`;
  const plays = `${pct(playRate(x, mode))} of ${decks} play it, against ${pct(playRate(y, mode))} for ${y.name}`;
  if (rate >= 0.05) gains.push(plays);
  if (rate <= -0.05) losses.push(plays);
  const synergy = (x.synergy ?? 0) - (y.synergy ?? 0);
  if (mode !== "max") score += synergy * 40;
  // EDHREC's suggestions for this exact list: a card it says to add. (Its cut score decides which cards may go at all.)
  if (mode !== "max") score += (x.recAdd ?? 0) * 30;
  // EDHREC synergy: how much more often a card is played with this commander than in other decks of its colours.
  if (mode !== "max" && synergy >= 0.1) gains.push(`it's ${signed(x.synergy ?? 0)} synergy with ${commander} on EDHREC, against ${signed(y.synergy ?? 0)} for ${y.name}`);
  return { gains, losses, score, worse };
}

/**
 * Is `x` strictly better than `y`: everything `y` does, nothing worse? Players have to have voted so on Strictly Better
 * (y.superiors), and our own check has to agree: nothing worse (no extra cost, drawback or lost job), and nothing the
 * commander's plan loses (Venom wants the bigger creature). Our check alone isn't enough: Scryfall's function tags say
 * what a card does, not everything it does, so Crucible of Worlds and Whip of Erebos both read as "recursion".
 * Returns the votes { up, down }, or null.
 */
export function strictlyBetter(x, y, identity = [], strategy = null) {
  const vote = y.superiors?.find((s) => s[0] === x.name);
  if (!vote || vote[1] <= vote[2] || y.basic) return null;
  const plan = !fuels(y, strategy) || (typeOf(x) === "creature" && fuelOf(x, strategy.fuel) >= fuelOf(y, strategy.fuel));
  return plan && !compare(x, y, { identity, strategy }).worse ? { up: vote[1], down: vote[2] } : null;
}

/**
 * Frank Karsten's coloured sources a 99-card deck with 41 lands needs to cast a card on curve ("How Many Sources Do
 * You Need to Consistently Cast Your Spells? A 2022 Update"), by coloured pips (1-4) and then generic mana (0-5+).
 */
const KARSTEN = { 1: [19, 19, 18, 16, 15, 14], 2: [30, 28, 26, 23, 22, 20], 3: [36, 33, 30, 28, 26], 4: [39, 36] };
const COLOUR_PIP = (x) => new RegExp(`\\{${x}\\}`, "g");
const isCheap = (c) => (c.manaValue ?? 0) <= 2 && ["fastMana", "ramp", "draw"].some((r) => c.roles?.includes(r));

/**
 * The deck's mana: { lands, wanted, colours: [{ colour, sources, need, card }], short: [colours] }. `wanted` is Karsten's
 * land count for a Commander deck's curve (31.42 + 3.13 × average mana value − 0.28 × cheap ramp and draw spells).
 * Each colour needs the sources Karsten's table gives its most demanding card (the commander's too), scaled to the
 * deck's land count; lands count fully, mana rocks ¾ and mana creatures ½ (his partial credit). The more colours, the
 * more of the lands have to make two of them: that's where `short` comes from.
 */
export function manaBase(names, byName, identity = [], commanders = []) {
  const cards = names.map((n) => byName.get(n)).filter(Boolean);
  const lands = cards.filter(isLand);
  const spells = cards.filter((c) => !isLand(c));
  const avg = spells.reduce((n, c) => n + (c.manaValue ?? 0), 0) / Math.max(1, spells.length);
  const wanted = Math.ceil(31.42 + 3.13 * avg - 0.28 * spells.filter(isCheap).length);
  const colours = identity.map((colour) => {
    let sources = lands.filter((c) => coloursOf(c, identity).includes(colour)).length;
    for (const c of spells) if (c.produces?.includes(colour)) sources += c.jobs?.includes("mana-rock") ? 0.75 : c.jobs?.includes("mana-dork") ? 0.5 : 0;
    let need = 0;
    let card = null;
    for (const c of [...commanders.map((n) => byName.get(n)).filter(Boolean), ...spells]) {
      const pips = (c.manaCost ?? "").match(COLOUR_PIP(colour))?.length ?? 0;
      if (!pips || c.free) continue;
      const row = KARSTEN[Math.min(4, pips)];
      // An X spell is cast later, with more lands (Karsten: count the mana you expect to spend): X as 3.
      const generic = Math.round(c.manaValue ?? 0) - pips + 3 * ((c.manaCost ?? "").match(/\{X\}/g)?.length ?? 0);
      const n = Math.ceil((row[Math.min(row.length - 1, Math.max(0, generic))] * lands.length) / 41);
      if (n > need) [need, card] = [n, c.name];
    }
    return { colour, sources: Math.round(sources * 10) / 10, need, card };
  });
  return { lands: lands.length, wanted, colours, short: colours.filter((c) => c.sources < c.need).map((c) => c.colour) };
}

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
function build({ pool, byName, commanders, locked, budget, lambda, banned, lands = LANDS, linesOf = new Map(), worth = cardValue }) {
  const deck = [...locked];
  const counts = {};
  for (const n of deck) {
    const r = primary(byName.get(n));
    counts[r] = (counts[r] ?? 0) + 1;
  }
  let spent = deckCost(deck, byName, commanders).total;
  let value = deck.reduce((n, name) => n + worth(byName.get(name)), 0);
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
      const m = marginal(c, counts, worth) + comboBonus(c);
      if (m < floor) continue;
      const score = m - lambda * (c.price ?? 0);
      if (score > bestScore) [best, bestScore] = [c, score];
    }
    return best;
  };
  while (spellSlots > 0) {
    const c = pick(spells, spellSlots, basicPrice, landSlots, -Infinity);
    if (!c) break; // nothing affordable left: the slot becomes a basic land
    value += marginal(c, counts, worth) + comboBonus(c);
    deck.push(c.name);
    taken.add(c.name);
    counts[primary(c)] = (counts[primary(c)] ?? 0) + 1;
    spent += c.price ?? 0;
    spellSlots -= 1;
  }
  landSlots = 99 - deck.length;
  while (landSlots > 0) {
    const c = pick(landCards, landSlots, basicPrice, 0, worth({ basic: true }) + 1);
    if (!c) break;
    deck.push(c.name);
    taken.add(c.name);
    spent += c.price ?? 0;
    value += worth(c);
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
  for (const b of fill) value += worth(byName.get(b));
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

/**
 * One-for-one swaps that turn `before` into `after` (both multisets of names), each cut paired with the most similar
 * add: one that does its job, then the same role, then the same card type, then the nearest mana value.
 */
export function pairChanges(before, after, byName, identity = [], made = [], strategy = null) {
  const count = (list) => list.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map());
  const a = count(before);
  const b = count(after);
  const removed = [];
  const added = [];
  for (const [n, k] of a) for (let i = 0; i < k - (b.get(n) ?? 0); i++) removed.push(n);
  for (const [n, k] of b) for (let i = 0; i < k - (a.get(n) ?? 0); i++) added.push(n);
  const similarity = (r, a) => {
    const x = byName.get(a);
    const y = byName.get(r);
    if (!x || !y) return 0;
    let s = replaces(x, y, identity, { strategy }) ? 100 : replaces(x, y, identity, { exact: false }) ? 60 : 0;
    if (primary(x) === primary(y)) s += primary(y) === "other" ? 10 : 40;
    if (typeOf(x) === typeOf(y)) s += 10;
    return s - Math.min(9, Math.abs(castFor(x) - castFor(y)));
  };
  // Best pairs first, so a cut isn't handed a poor match that a later cut needed more.
  const options = removed.flatMap((r, i) => added.map((a, j) => ({ i, j, s: similarity(r, a) }))).sort((p, q) => q.s - p.s || p.i - q.i || p.j - q.j);
  const match = new Map();
  const used = new Set();
  // Swaps the optimizer actually made come first, exactly as made.
  for (const m of made) {
    const i = removed.findIndex((r, k) => r === m.remove && !match.has(k));
    const j = added.findIndex((a, k) => a === m.add && !used.has(k));
    if (i >= 0 && j >= 0) (match.set(i, j), used.add(j));
  }
  for (const o of options) if (!match.has(o.i) && !used.has(o.j)) (match.set(o.i, o.j), used.add(o.j));
  const pairs = removed.map((r, i) => ({ remove: r, add: match.has(i) ? added[match.get(i)] : null }));
  for (const [j, n] of added.entries()) if (!used.has(j)) pairs.push({ remove: null, add: n });
  return pairs;
}

const pct = (x) => `${Math.round(x * 100)}%`;
const signed = (x) => `${x >= 0 ? "+" : "−"}${Math.round(Math.abs(x) * 100)}%`;
const money = (n) => `CA$${Math.abs(n).toFixed(2)}`;
const COLOUR_NAMES = { W: "white", U: "blue", B: "black", R: "red", G: "green" };
const ROLE_ONE = { fastMana: "fast mana card", ramp: "ramp card", tutor: "tutor", draw: "card-draw card", interaction: "interaction card", protection: "protection card", wincon: "win condition", land: "land", other: "card with no other job" };
const capital = (s) => s[0].toUpperCase() + s.slice(1);
const an = (word) => (/^(?:[aeiou]|8|1[18]-|X-)/i.test(word) ? "an" : "a"); // "an 8-mana", "an 11-mana", "an X-cost"
const list = (xs, and = "or") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}`);

/** The card's main type, e.g. "creature", from the front face's type line. */
function typeOf(c) {
  const t = (c.typeLine ?? "").split(" // ")[0];
  return ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"].find((x) => t.includes(x))?.toLowerCase() ?? "card";
}

/** What the deck really pays for a card: nothing for a free spell (Deadly Rollick), its madness cost when it has one (Anje-style decks discard them). */
const castFor = (c) => (c.free ? 0 : (c.madness ?? c.manaValue ?? 0));
// Black Sun's Zenith's {X}{B}{B}: its mana value of 2 isn't what it costs to do its job.
const xCost = (c) => /\{X\}/.test(c.manaCost ?? "");
const manaText = (c) => (xCost(c) ? "X-cost" : `${castFor(c)}-mana`);

/** The jobs worth naming for a card: ones that fit its roles, so Hellrider's damage to planeswalkers isn't called removal. */
function shownJobs(c) {
  const allowed = new Set([...SYNERGY_JOBS, ...(c.roles ?? []).flatMap((r) => ROLE_JOBS[r] ?? [])]);
  return (c.jobs ?? []).filter((j) => allowed.has(j));
}

/** "a board wipe", but "recursion": a job as it reads after "it's". */
const COUNTABLE = new Set(["board-wipe", "counterspell", "ritual", "mana-rock", "mana-dork", "tutor", "wheel", "cantrip", "discard-outlet", "sacrifice-outlet"]);
const aJob = (j) => (COUNTABLE.has(j) ? `${an(JOBS[j])} ${JOBS[j]}` : JOBS[j]);

/** "creature, artifact and planeswalker removal, recursion and burn": a card's jobs in a few words. */
function jobsText(c) {
  const jobs = shownJobs(c);
  const removal = REMOVAL.filter((j) => jobs.includes(j)).map((j) => JOBS[j].replace(" removal", ""));
  // A board wipe already says what it removes.
  // A card that draws more than once is card draw, not also a cantrip.
  const parts = [...(removal.length && !jobs.includes("board-wipe") ? [`${list(removal, "and")} removal`] : []), ...jobs.filter((j) => !REMOVAL.includes(j) && !(j === "cantrip" && jobs.includes("draw"))).map(aJob)];
  return list(parts.slice(0, 3), "and");
}

/** What a card does in the deck, in a few words: "a 3-mana instant: creature removal". */
function jobOf(c, identity) {
  const job = baseJob(c, identity);
  return c.madness != null ? `${job}, cast for its madness cost` : job;
}
function baseJob(c, identity) {
  const role = primary(c);
  if (role === "land") {
    const colours = coloursOf(c, identity).map((x) => COLOUR_NAMES[x]);
    const kind = c.basic ? "a basic land" : c.fetch ? "a fetch land" : "a land";
    const makes = c.fetch ? `that finds a land for ${list(colours)} mana` : colours.length ? `that makes ${list(colours)} mana` : "that makes only colourless mana";
    return `${kind} ${makes}${c.tapped ? " and enters tapped" : ""}`;
  }
  const type = c.instant && typeOf(c) !== "instant" ? `${typeOf(c)} with flash` : typeOf(c);
  const what = c.free ? `${an(type)} ${type} you can cast for free` : `${an(manaText(c))} ${manaText(c)} ${type}`;
  if (role === "fastMana") return `${what}: fast mana that gives back ${c.net || 1} more mana than it costs`;
  if (role === "tutor") return `${what}: a tutor that finds ${c.finds === "any" || !c.finds?.length ? "any card" : `${list(c.finds)} cards`}`;
  if (role === "protection") return `${what}: protection for your key turn`;
  if (role === "wincon" && !shownJobs(c).length) return `${what}: a win condition`;
  const jobs = jobsText(c);
  return jobs ? `${what}: ${jobs}` : what;
}

/** "it's in 41% of Anje Falkenrath decks on EDHREC (synergy +32%)", or that EDHREC doesn't list it. */
function statOf(c, commander, mode) {
  if (mode === "max") return c.cedh ? `it's in ${pct(c.cedh)} of cEDH ${commander} decks on EDHREC` : `none of the cEDH ${commander} decks on EDHREC play it`;
  if (c.edh == null) return `EDHREC doesn't list it among the cards ${commander} decks play`;
  const synergy = c.synergy != null && Math.abs(c.synergy) >= 0.05 ? ` (synergy ${signed(c.synergy)}: ${c.synergy > 0 ? "played more" : "played less"} with ${commander} than in other decks of its colours)` : "";
  return `it's in ${pct(c.edh)} of ${commander} decks on EDHREC${synergy}`;
}

/**
 * Why a card is in this deck: what it does, what else it does for the plan, how that fits what the commander rewards
 * (`strategy`), then EDHREC's numbers. A card with none of that we can name is left to EDHREC's numbers, and says so.
 */
function purpose(c, { identity, commander, mode, strategy }) {
  const features = featuresOf(c).map((f) => FEATURES[f]);
  const has = new Set([...(c.jobs ?? []), ...featuresOf(c)]);
  const plans = (strategy?.plans ?? []).filter((p) => p.tags.some((t) => has.has(t))).map((p) => p.text);
  const stat = statOf(c, commander, mode);
  // Worth saying only for a big one: Venom draws 7 off a 7-drop.
  const big = fuels(c, strategy) && fuelOf(c, strategy.fuel) >= 5;
  if (primary(c) === "other" && !shownJobs(c).length && !features.length && !plans.length && !big) {
    return `${c.name} is ${jobOf(c, identity)} with no specific job TapToTrade can name, so EDHREC's numbers speak for it: ${stat}.`;
  }
  let s = `${c.name} is ${jobOf(c, identity)}.`;
  if (features.length) s += ` It ${list(features, "and")}.`;
  if (plans.length) s += ` That suits ${commander}, which ${list(plans.slice(0, 2), "and")}.`;
  if (big) s += ` ${commander} gets more from a creature with higher ${strategy.fuel}, and this one's is ${fuelOf(c, strategy.fuel)}.`;
  return `${s} ${capital(stat)}.`;
}

/**
 * Why one swap is made, built only from what we know about the two cards and the deck: { cut, add, effect } sentences
 * (any may be ""). `effect` names the job both cards do and exactly what's better, with any trade-off.
 * `counts` are the original deck's role counts; `mode` picks cEDH or all of the commander's decks for the numbers.
 * `swap` is how the preserve or value goal made it ({ kind, vote, note }, see upgrade); `learned` adds what players did
 * with the same swap before.
 */
export function explain({ remove, add }, { byName, commanders, identity, lines, oldLines, counts, mode = "preserve", budget = null, strategy = null, swap = null, learned = null }) {
  const out = byName.get(remove);
  const inn = byName.get(add);
  const commander = strategy?.name ?? commanders[0];
  const ctx = { identity, commander, mode, strategy };
  let cut = "";
  if (out) {
    if (!out.legal) cut = `${remove} is banned or not legal in Commander, so it has to go.`;
    else if (!out.inIdentity) cut = `${remove} is outside ${commanders.join(" and ")}'s colour identity, so it isn't allowed in this deck.`;
    else if (out.basic) cut = `${remove} is ${jobOf(out, identity)}.`;
    else cut = purpose(out, ctx);
    const lost = oldLines.find((l) => l.pieces.includes(remove) && !lines.some((x) => x.id === l.id));
    if (lost) cut += ` This breaks ${lost.pieces.join(" + ")} (${lost.produces[0] ?? "a combo"}); ${lines.length ? `the new deck wins with ${lines[0].pieces.join(" + ")} instead.` : "the new deck has no combo in its place."}`;
    if (out.recCut != null && !out.basic) cut += ` EDHREC's suggestions for your exact list rate it ${Math.round(out.recCut * 100)}/100 to cut.`;
  }
  let addText = "";
  if (inn) {
    const line = lines.find((l) => l.pieces.includes(add));
    addText = inn.basic ? `${add} is ${jobOf(inn, identity)}.` : purpose(inn, ctx);
    if (line) addText += ` It's part of ${line.pieces.join(" + ")} (${line.produces[0] ?? "a combo"}), a combo the new deck can assemble.`;
    if (inn.recAdd != null) addText += ` EDHREC's suggestions for your exact list rate it ${Math.round(inn.recAdd * 100)}/100 to add.`;
  }
  let effect = "";
  if (inn && out) {
    const { gains, losses } = compare(inn, out, { mode, identity, commander, strategy });
    const job = isLand(out) ? "a land" : JOBS[mainJob(out)];
    const exact = replaces(inn, out, identity, { strategy });
    // "it's card draw and it keeps drawing cards": everything the old card did, which the new one does too.
    const features = featuresOf(out).map((f) => FEATURES[f]);
    const did = `it's ${jobsText(out)}${features.length ? ` and it ${list(features, "and")}` : ""}`;
    const better = gains.length ? ` Better because ${gains.join("; ")}.` : "";
    const tradeOff = losses.length ? ` Trade-off: ${losses.join("; ")}.` : "";
    if (swap?.kind === "strict") {
      // What's left of the losses is how many decks play it, already in the add text: not a trade-off in the card.
      effect = `Strictly better: players on Strictly Better voted ${swap.vote.up} to ${swap.vote.down} that ${add} does everything ${remove} does and more, and TapToTrade's own check finds nothing worse.${better}`;
    } else if (swap?.kind === "land") {
      // A land for a spell: nothing to compare.
      effect = `Land base: ${swap.note}${isLand(out) ? better + tradeOff : ""}`;
    } else if (exact || replaces(inn, out, identity, { strategy, exact: false }) || (isLand(inn) && isLand(out))) {
      // A land for a land is always the same job; the trade-offs say if it makes fewer colours or enters tapped.
      const why = swap?.kind === "edhrec"
        ? ""
        : inn.staple && !out.staple
          ? ` ${add} is one of the proven cEDH staples the rebuild draws on.`
          : (inn.price ?? 0) < (out.price ?? 0)
            ? " Picked because it costs less, leaving money for stronger cards elsewhere."
            : " The rebuild rated it higher overall (play rate, mana value and role).";
      // A swap made to fit the budget, or EDHREC's pick, is never called an upgrade.
      effect = isLand(out)
        ? "Same job: a land."
        : exact && budget == null && !swap
          ? `Direct upgrade: like ${remove}, ${did}.`
          : exact
            ? `Same job: ${job}.`
            : `Same main job: ${job}, but it doesn't do everything ${remove} did.`;
      effect += (better || why) + tradeOff;
    } else if (!isLand(out) && !isLand(inn) && !shownJobs(out).length && !shownJobs(inn).length && typeOf(inn) === typeOf(out)) {
      effect = `Both are ${typeOf(out)}s without a specific job like removal, ramp or card draw.${gains.length ? ` ${capital(gains.join("; "))}.` : ""}`;
      if (losses.length) effect += ` Trade-off: ${losses.join("; ")}.`;
    } else {
      // Not like-for-like (the deck is rebuilt for maximum power, or the old card had to go): say what's gained and lost.
      // "a 1-mana sorcery: creature removal", or just "a 4-mana creature" for a card with no listed job.
      // "a 2-mana artifact that gives creatures haste" for Lightning Greaves.
      const described = (c) => (isLand(c) ? "a land" : `${baseJob(c, identity)}${featuresOf(c).length ? ` that ${list(featuresOf(c).map((f) => FEATURES[f]), "and")}` : ""}`);
      effect = `A different job: the deck gains ${described(inn)} and gives up ${described(out)}.`;
      const a = primary(inn);
      const r = primary(out);
      if (a !== r && a !== "other" && r !== "other") {
        const now = (role) => counts[role] ?? 0;
        effect += ` That makes ${now(a) + 1} ${ROLE_ONE[a]}s${TARGETS[a] && mode === "max" ? ` (cEDH decks run about ${TARGETS[a]})` : ""} and ${now(r) - 1} ${ROLE_ONE[r]}s.`;
      }
      if (gains.length) effect += ` ${capital(gains.join("; "))}.`;
    }
    if (swap?.kind === "edhrec") {
      const weak = (out.recCut ?? 0) >= KEEP_BELOW ? "EDHREC's suggestions for your list say to cut it" : out.edh == null ? `EDHREC doesn't list it among the cards ${commander} decks play` : `only ${pct(out.edh)} of ${commander} decks on EDHREC still play it`;
      effect = `EDHREC's pick: nothing strictly better than ${remove} fits, and ${weak}, so this is a card EDHREC's suggestions for your list say to add. ${effect}`;
    }
    const [took, turned] = learned?.pairs.get(`${remove}|${add}`) ?? [0, 0];
    if (took + turned) effect += ` Players shown this swap before took it ${took} time${took === 1 ? "" : "s"} and turned it down ${turned} time${turned === 1 ? "" : "s"}.`;
    const diff = (inn.price ?? 0) - (out.price ?? 0);
    if (budget != null && diff < 0) effect = `Swapped to fit your ${money(budget)} budget: it saves ${money(diff)}. ${effect}`;
    else if (Math.abs(diff) >= 0.5) effect += diff > 0 ? ` It costs ${money(diff)} more.` : ` It saves ${money(diff)}.`;
  } else if (inn) effect = "Fills an empty slot (your list had fewer than 99 cards).";
  else if (out) effect = "Cut to bring the deck down to 99 cards.";
  return { cut, add: addText, effect };
}

/** From this cut score in EDHREC's suggestions for the player's list, a card may make way for one EDHREC suggests adding. */
const KEEP_BELOW = 0.5;
/**
 * Or when fewer than this share of the commander's decks on EDHREC still play it: EDHREC's suggestions rarely want a
 * precon's own cards cut (most of its decks start from the precon), but players cut these ones.
 */
const RARE_BELOW = 0.3;
/** EDHREC's add score a card needs to come in that way (its top suggestions for a list score about 0.3-0.6). */
const ADD_ABOVE = 0.3;
/** At most this many of EDHREC's picks: the swaps are meant to be upgrades, not a different deck. */
const EDHREC_SWAPS = 10;
/** Karsten's land count is good to about ±3 lands, so lands are only added to a deck further short than that. */
const LAND_SLACK = 3;

/** Share of players who took a swap, smoothed (Laplace's rule of succession): ½ with no votes, nearer 1 or 0 as they come in. */
const tookRate = ([took, turned]) => (took + 1) / (took + turned + 2);
const NO_VOTES = [0, 0];

/**
 * What players did with a swap before, as score points: up to ±10 for this exact swap and ±5 for the card coming in
 * with this commander. null once players keep turning it down (3 or more no's for the swap, under 30% taken, or 5 for
 * the card): it isn't suggested again.
 */
function taste(x, y, learned) {
  const pair = learned.pairs.get(`${y.name}|${x.name}`) ?? NO_VOTES;
  const add = learned.adds.get(x.name) ?? NO_VOTES;
  if ((pair[1] >= 3 && tookRate(pair) < 0.3) || (add[1] >= 5 && tookRate(add) < 0.25)) return null;
  return 20 * (tookRate(pair) - 0.5) + 10 * (tookRate(add) - 0.5);
}

/**
 * Upgrades to `deck` within the budget, in three passes. Each slot changes at most once, so every suggestion is
 * measured against the player's own card:
 *  1. strict: a strictly better card (strictlyBetter), whatever EDHREC says about the old one, at most `maxSwaps`;
 *  2. edhrec: for a card EDHREC rates weak (its suggestions for the list say to cut it, or few of the commander's
 *     decks play it), with nothing strictly better on offer, a card EDHREC's suggestions say to add (one that does the
 *     same job first), at most EDHREC_SWAPS of them;
 *  3. land: last, so it fixes the mana for the cards that end up in the deck (manaBase): a land in place of the
 *     weakest spell while the deck is short of lands, then a land making a colour that's short of sources in place of
 *     a basic or a plain land whose colours can spare one. Utility lands (Rogue's Passage) stay.
 * What players did with earlier suggestions (`learned`, see taste) moves every score. Strictly better cards, and every
 * pass in the "value" goal, are ranked by gain per dollar. Locked cards and `fixed` slots (already swapped to fit the
 * budget) stay.
 * Returns { deck, made: Map(slot -> { kind, vote, note }) }.
 */
function upgrade({ deck, pool, byName, commanders, budget, banned, keep, fixed, perDollar, maxSwaps, identity, strategy, learned }) {
  const out = [...deck];
  const inDeck = new Set(out);
  let spent = deckCost(out, byName, commanders).total;
  const candidates = pool.filter((c) => playable(c, commanders) && !c.basic && !inDeck.has(c.name) && !banned.has(c.name) && c.price != null);
  const basicLands = pool.filter((c) => c.basic && playable(c, commanders) && c.price != null);
  const made = new Map();
  // The best affordable swap of any open slot `y` for one of `options(y)` ({ x, gain, why }), or null.
  const best = (options, byDollar = perDollar) => {
    let top = null;
    for (let i = 0; i < out.length; i++) {
      if (keep.has(out[i]) || fixed.has(i) || made.has(i)) continue;
      const y = byName.get(out[i]);
      for (const o of options(y)) {
        const cost = (o.x.price ?? 0) - (y.price ?? 0);
        if (o.gain <= 0 || (!o.x.basic && inDeck.has(o.x.name)) || spent + cost > budget) continue;
        const score = byDollar ? o.gain / Math.max(0.5, cost) : o.gain;
        if (!top || score > top.score) top = { ...o, i, y, cost, score };
      }
    }
    return top;
  };
  const swap = (top) => {
    if (!top) return false;
    out[top.i] = top.x.name;
    made.set(top.i, top.why);
    inDeck.add(top.x.name);
    spent += top.cost;
    return true;
  };
  // Each card's options, worked out once per pass (copies of a basic share them).
  const once = (options) => {
    const memo = new Map();
    return (y) => (memo.has(y.name) ? memo.get(y.name) : memo.set(y.name, options(y)).get(y.name));
  };

  // 1. Strictly better cards. Every one is an upgrade, so the budget buys as many as it can: a CA$700 Bayou only once
  // the cheap ones are in.
  const strict = once((y) =>
    candidates.flatMap((x) => {
      const vote = strictlyBetter(x, y, identity, strategy);
      const liked = vote ? taste(x, y, learned) : null;
      return liked == null ? [] : [{ x, gain: Math.max(1, compare(x, y, { identity, strategy }).score) + liked, why: { kind: "strict", vote } }];
    }),
  );
  for (let n = 0; n < maxSwaps && swap(best(strict, true)); n++);

  // 2. EDHREC's suggestions for the list, in place of the cards EDHREC rates weakest (0-1: its cut score, or how few of
  // the commander's decks play the card).
  const weakness = (y) => Math.max(y.recCut ?? 0, (RARE_BELOW - (y.edh ?? 0)) / RARE_BELOW);
  const picks = once((y) =>
    isLand(y) || ((y.recCut ?? 0) < KEEP_BELOW && (y.edh ?? 0) >= RARE_BELOW)
      ? []
      : candidates.flatMap((x) => {
          const liked = isLand(x) || (x.recAdd ?? 0) < ADD_ABOVE ? null : taste(x, y, learned);
          if (liked == null) return [];
          const alike = replaces(x, y, identity, { strategy }) ? 30 : replaces(x, y, identity, { strategy, exact: false }) ? 20 : primary(x) === primary(y) ? 10 : 0;
          return [{ x, gain: x.recAdd * 60 + weakness(y) * 20 + alike + liked, why: { kind: "edhrec" } }];
        }),
  );
  for (let n = 0; n < EDHREC_SWAPS && swap(best(picks)); n++);

  // 3. Lands, worked out again after every swap, since each one changes the deck's mana.
  const lands = [...candidates.filter(isLand), ...basicLands];
  const landSwap = () => {
    const base = manaBase(out, byName, identity, commanders);
    const gap = new Map(base.colours.map((c) => [c.colour, c.need - c.sources]));
    const names = (cs) => list(cs.map((c) => COLOUR_NAMES[c]), "and");
    // How much a land helps: colours that are short first, then the deck's other colours, untapped, played with this
    // commander. A cheap dual fixes a colour as well as a CA$50 fetch, so price counts against it (up to 15 points).
    const help = (x, y) => coloursOf(x, identity).reduce((n, c) => n + (gap.get(c) > 0 ? 20 : 3), 0) - (x.tapped ? 8 : 0) + (x.edh ?? 0) * 10 - Math.min(15, Math.max(0, (x.price ?? 0) - (y.price ?? 0)) / 3);
    if (base.lands < base.wanted - LAND_SLACK) {
      const note = `the deck has ${base.lands} lands, and Frank Karsten's formula for a Commander deck with this curve says ${base.wanted} (give or take ${LAND_SLACK}).`;
      // The spell EDHREC's suggestions most want cut, or else the one EDHREC's numbers rate lowest, becomes a land.
      return best((y) =>
        isLand(y)
          ? []
          : lands.flatMap((x) => {
              const liked = taste(x, y, learned);
              return liked == null || (x.tapped && coloursOf(x, identity).length < 3) ? [] : [{ x, gain: help(x, y) + (y.recCut ?? 0) * 40 + Math.max(0, 40 - deckValue(y)) + liked, why: { kind: "land", note } }];
            }),
      );
    }
    if (!base.short.length) return null;
    return best((y) => {
      // Only a basic or a plain land makes way (a basic first), and only for a land that still makes each of its colours
      // that can't spare a source: a Plains for a white-blue dual even when white is short too.
      const had = isLand(y) ? coloursOf(y, identity) : [];
      if (!isLand(y) || y.utility || y.jobs?.length) return [];
      return lands.flatMap((x) => {
        const makes = coloursOf(x, identity);
        // Path of Ancestry for a Plains fixes nothing: white had that source already.
        const fixes = base.short.filter((c) => makes.includes(c) && !had.includes(c));
        const liked = taste(x, y, learned);
        // A shock or pain land's life is the usual price of fixing; Lotus Field's two lands aren't.
        const worse = drawbacksOf(x).some((d) => d !== "life" && !drawbacksOf(y).includes(d));
        if (!fixes.length || worse || liked == null || (x.tapped && !y.tapped && makes.length < 3) || had.some((c) => gap.get(c) + 1 > 0 && !makes.includes(c))) return [];
        const short = base.colours.find((c) => c.colour === fixes[0]);
        const kept = had.filter((c) => makes.includes(c));
        const note = `${capital(COLOUR_NAMES[short.colour])} has ${short.sources} sources, and ${short.card} needs ${short.need} to be cast on curve with ${base.lands} lands, by Frank Karsten's numbers. ${x.name} makes ${names(makes)} mana${kept.length ? `, so ${names(kept)} keeps its source` : ""}.`;
        return [{ x, gain: help(x, y) + (y.tapped ? 6 : 0) + (y.basic ? 4 : 0) + liked, why: { kind: "land", note } }];
      });
    });
  };
  while (swap(landSwap()));
  return { deck: out, made };
}

/**
 * Cheaper replacements until `deck` fits the budget, losing as little as possible per dollar saved: a card that does
 * the same job, a basic for a land, and for a card with no job a cheaper card of the same type that has none either.
 * Every swap keeps the old card's part in the commander's plan (keepsRole).
 */
function downgrade({ deck, pool, byName, commanders, budget, banned, keep, mode, identity, strategy }) {
  const out = [...deck];
  let spent = deckCost(out, byName, commanders).total;
  const basicsFor = basics(pool, out, 30, byName);
  while (spent > budget) {
    const inDeck = new Set(out);
    let best = null;
    for (let i = 0; i < out.length; i++) {
      const y = byName.get(out[i]);
      if (keep.has(out[i]) || !(y.price > 0.5)) continue;
      const cheaper = (c) => playable(c, commanders) && !c.basic && !inDeck.has(c.name) && !banned.has(c.name) && c.price != null && c.price < y.price;
      const options = isLand(y)
        ? basicsFor.slice(0, 1).map((n) => byName.get(n))
        : mainJob(y)
          ? pool.filter((c) => cheaper(c) && replaces(c, y, identity, { strategy, exact: false }))
          : pool.filter((c) => cheaper(c) && !isLand(c) && !mainJob(c) && typeOf(c) === typeOf(y) && keepsRole(c, y, strategy));
      for (const x of options) {
        const saved = y.price - x.price;
        // A card EDHREC's suggestions for the list say to cut costs less to give up.
        const loss = (Math.max(0, -compare(x, y, { mode, identity, strategy }).score) + Math.max(0, cardValue(y) - cardValue(x)) / 4) * (1 - (y.recCut ?? 0) / 2);
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
 * `strategy` (see the top of this file) makes swaps keep what the commander feeds on and explains each card by it.
 * `learned` (see the top of this file) is what players did with earlier suggestions: the preserve and value goals
 * favour swaps players took and stop suggesting ones they keep turning down.
 * Returns { deck, cost, lines, primary, changes (each with `kind`: "strict", "land", "edhrec", "budget" or null), notes }.
 */
export function optimize({ pool, combos = [], commanders, original = [], budget = Infinity, mode = "max", rejected = {}, consider = [], strategy = null, learned = {} }) {
  const byName = new Map(pool.map((c) => [c.name, c]));
  const taught = { pairs: new Map((learned.pairs ?? []).map(([cut, add, took, turned]) => [`${cut}|${add}`, [took, turned]])), adds: new Map((learned.adds ?? []).map(([add, took, turned]) => [add, [took, turned]])) };
  const banned = new Set(rejected.adds ?? []);
  const isOk = (n) => byName.has(n) && playable(byName.get(n), commanders);
  // Cards the player kept on purpose stay, if they're allowed in the deck at all.
  const keep = new Set((rejected.keeps ?? []).filter(isOk));
  // The player's cards that may stay: legal, in the colour identity, one copy of each non-basic.
  const seen = new Set();
  const legalOriginal = original.filter((n) => isOk(n) && (byName.get(n).basic || (!seen.has(n) && seen.add(n))));
  const notes = [];
  const identity = [..."WUBRG"].filter((x) => commanders.some((n) => byName.get(n)?.colorIdentity?.includes(x)));
  const usable = combos.filter((l) => l.win && l.pieces.every((p) => commanders.includes(p) || (isOk(p) && !banned.has(p) && (budget === Infinity || byName.get(p).price != null))));
  const linesOf = new Map();
  for (const l of usable) for (const p of l.pieces) linesOf.set(p, [...(linesOf.get(p) ?? []), l]);
  let deck;
  let made = []; // the preserve and value goals' swaps, as made ({ remove, add, budget: made only to fit the budget })
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
      start = bestBuild({ pool, byName, commanders, locked: start, budget: Infinity, banned, lands: Math.max(LANDS, start.filter((n) => isLand(byName.get(n))).length), worth: deckValue }).deck;
    } else if (missing < 0) {
      start = [...start].sort((x, y) => (lock.has(y) - lock.has(x)) || cardValue(byName.get(y)) - cardValue(byName.get(x))).slice(0, 99);
    }
    // Both passes swap cards slot by slot, so each slot that changed is one real swap: the list pairs them as made.
    const cheaper = budget === Infinity ? start : downgrade({ deck: start, pool, byName, commanders, budget, banned, keep: lock, mode, identity, strategy });
    const fixed = new Set(start.flatMap((n, i) => (cheaper[i] !== n ? [i] : [])));
    const up = upgrade({ deck: cheaper, pool, byName, commanders, budget, banned, keep: lock, fixed, perDollar: mode === "value", maxSwaps: mode === "value" ? 30 : 20, identity, strategy, learned: taught });
    deck = up.deck;
    made = start.map((n, i) => ({ remove: n, add: deck[i], ...(fixed.has(i) ? { kind: "budget" } : up.made.get(i)) })).filter((p) => p.remove !== p.add);
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
  const counts = {};
  for (const n of original) counts[primary(byName.get(n) ?? {})] = (counts[primary(byName.get(n) ?? {})] ?? 0) + 1;
  const context = { byName, commanders, identity, lines, oldLines: linesIn(original, combos, commanders), counts, mode, strategy, learned: taught };
  const madeBy = new Map(made.map((m) => [`${m.remove}|${m.add}`, m]));
  const changes = pairChanges(original, deck, byName, identity, made, strategy).map((p) => {
    // A card made a basic (for the budget or the land count) and that basic a dual for a colour reads as card for dual:
    // the first swap explains it.
    const swap = madeBy.get(`${p.remove}|${p.add}`) ?? made.find((m) => m.remove === p.remove && ["land", "budget"].includes(m.kind)) ?? null;
    const why = explain(p, { ...context, budget: swap?.kind === "budget" ? budget : null, swap });
    return {
      ...p,
      kind: swap?.kind ?? null,
      costDiff: Math.round(((byName.get(p.add)?.price ?? 0) - (byName.get(p.remove)?.price ?? 0)) * 100) / 100,
      why,
      reason: [why.cut, why.add, why.effect].filter(Boolean).join(" "),
    };
  });
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
