import { applyChanges, BUDGET_TIERS, cardValue, compare, deckCost, explain, lineEfficiency, mainJob, manaBase, MODES, optimize, pairChanges, replaces, report, strictlyBetter, theoreticalTurn } from "./optimizer.js";
import { hyperAtLeast } from "./probability.js";

// A made-up mono-red pool: enough cards of every role to fill a deck at any budget, plus traps the optimizer must avoid.
const COMMANDER = "Rograkh, Son of Rohgahh";
const card = (name, roles, price, extra = {}) => ({
  name,
  roles,
  price,
  manaValue: roles[0] === "land" ? 0 : 1,
  manaCost: roles[0] === "land" ? "" : "{R}",
  typeLine: roles[0] === "land" ? "Land" : "Instant",
  legal: true,
  inIdentity: true,
  basic: false,
  cedh: null,
  ...extra,
});
const series = (prefix, n, roles, price, extra = {}) => Array.from({ length: n }, (_, i) => card(`${prefix} ${i + 1}`, roles, typeof price === "function" ? price(i) : price, extra));
const POOL = [
  card(COMMANDER, ["other"], 2.3, { typeLine: "Legendary Creature" }),
  card("Mountain", ["land"], 0.1, { basic: true, produces: ["R"] }),
  // Expensive staples that only a big budget buys, and cheap versions of every role.
  ...series("Pricey Mox", 6, ["fastMana"], 180, { cedh: 0.9, staple: true, manaValue: 0, net: 1 }),
  ...series("Cheap Rock", 12, ["fastMana"], 1, { cedh: 0.2, net: 1 }),
  ...series("Pricey Tutor", 5, ["tutor"], 60, { cedh: 0.8, finds: "any" }),
  ...series("Cheap Tutor", 10, ["tutor"], 0.5, { cedh: 0.1, finds: ["creature"] }),
  ...series("Free Counter", 5, ["interaction"], 70, { cedh: 0.85, free: true }),
  ...series("Shock", 20, ["interaction"], 0.3, { cheap: true }),
  ...series("Draw Engine", 6, ["draw"], 25, { cedh: 0.7 }),
  ...series("Cantrip", 15, ["draw"], 0.25),
  ...series("Shield", 6, ["protection"], 2, { cedh: 0.3 }),
  ...series("Bear", 40, ["other"], 0.2),
  ...series("Fetch", 8, ["land"], 30, { cedh: 0.7, produces: ["R"] }),
  ...series("Utility Land", 6, ["land"], 1.5, { produces: ["R"], cedh: 0.3 }),
  // Combo pieces: a cheap two-card line and a pricey, faster one.
  card("Dualcaster Mage", ["wincon"], 2, { manaValue: 3, typeLine: "Creature" }),
  card("Twinflame", ["wincon"], 2.5, { manaValue: 2, typeLine: "Sorcery" }),
  card("Underworld Breach", ["wincon"], 25, { manaValue: 2, typeLine: "Enchantment", cedh: 0.6 }),
  card("Lion's Eye Diamond", ["fastMana"], 900, { manaValue: 0, typeLine: "Artifact", net: 3, cedh: 0.5 }),
  // Traps: banned, outside the colour identity, no known price.
  card("Banned Crypt", ["fastMana"], 40, { legal: false, cedh: 1 }),
  card("Blue Force", ["interaction"], 80, { inIdentity: false, free: true, cedh: 1 }),
  card("Mystery Card", ["fastMana"], null, { cedh: 0.95 }),
];
const COMBOS = [
  { id: "cheap", pieces: ["Dualcaster Mage", "Twinflame"], produces: ["Infinite creature tokens with haste"], win: true, manaNeeded: 0, popularity: 70000 },
  { id: "pricey", pieces: ["Underworld Breach", "Lion's Eye Diamond"], produces: ["Win the game"], win: true, manaNeeded: 0, popularity: 90000 },
  { id: "engine", pieces: ["Cheap Rock 1", "Cheap Rock 2"], produces: ["Infinite colorless mana"], win: false, manaNeeded: 0, popularity: 10 },
];
const byName = new Map(POOL.map((c) => [c.name, c]));
const commanders = [COMMANDER];
// A slow starting deck with a banned card, an off-colour card and the cheap combo.
const ORIGINAL = [
  ...Array.from({ length: 30 }, (_, i) => `Bear ${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `Cantrip ${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `Shock ${i + 1}`),
  "Banned Crypt",
  "Blue Force",
  "Dualcaster Mage",
  "Twinflame",
  ...Array(35).fill("Mountain"),
];

const run = (budget, mode = "max", rejected = {}) => optimize({ pool: POOL, combos: COMBOS, commanders, original: ORIGINAL, budget, mode, rejected });

test("every mode and budget keeps the commander locked and the 99 legal", () => {
  for (const [mode] of MODES) {
    for (const budget of [150, 500, 2500, Infinity]) {
      const r = run(budget, mode);
      expect(r.deck).toHaveLength(99);
      expect(r.deck).not.toContain(COMMANDER);
      for (const n of r.deck) {
        const c = byName.get(n);
        expect(c.legal && c.inIdentity).toBe(true);
        if (!c.basic) expect(r.deck.filter((x) => x === n)).toHaveLength(1);
      }
      expect(r.changes.some((ch) => ch.remove === COMMANDER || ch.add === COMMANDER)).toBe(false);
      if (budget !== Infinity) expect(r.cost.total).toBeLessThanOrEqual(budget);
      // The illegal cards always go, with a reason that says why.
      expect(r.deck).not.toContain("Banned Crypt");
      expect(r.deck).not.toContain("Blue Force");
      expect(r.changes.find((ch) => ch.remove === "Banned Crypt").reason).toMatch(/banned/);
      expect(r.changes.find((ch) => ch.remove === "Blue Force").reason).toMatch(/colour identity/);
    }
  }
});

test("the budget changes the actual cards, not just the price", () => {
  const small = run(150);
  const big = run(2500);
  const unlimited = run(Infinity);
  expect(small.deck).not.toEqual(big.deck);
  expect(big.cost.total).toBeGreaterThan(small.cost.total);
  expect(big.deck.filter((n) => n.startsWith("Pricey")).length).toBeGreaterThan(small.deck.filter((n) => n.startsWith("Pricey")).length);
  // A cheap budget plays the cheap combo; no limit can afford the faster one.
  expect(small.primary.id).toBe("cheap");
  expect(unlimited.deck).toEqual(expect.arrayContaining(["Underworld Breach", "Lion's Eye Diamond"]));
  // Cards without a known price are only used when there's no budget to keep.
  expect(small.deck).not.toContain("Mystery Card");
  expect(unlimited.deck).toContain("Mystery Card");
  expect(report({ pool: POOL, combos: COMBOS, commanders, deck: big.deck }).scores.overall).toBeGreaterThan(report({ pool: POOL, combos: COMBOS, commanders, deck: small.deck }).scores.overall);
});

test("the budget holds at every amount, even when one colour's basics cost more", () => {
  // Two colours, the deck's spells use both, and Forests cost seven times what Mountains do.
  const gruul = [
    card("Cmd", ["other"], 2),
    card("Mountain", ["land"], 0.1, { basic: true }),
    card("Forest", ["land"], 0.7, { basic: true }),
    ...series("Rock", 20, ["fastMana"], 3, { cedh: 0.5, manaCost: "{R}{G}" }),
    ...series("Tutor", 15, ["tutor"], 4, { cedh: 0.5, manaCost: "{R}{G}" }),
    ...series("Shock", 30, ["interaction"], 0.2, { manaCost: "{R}{G}" }),
    ...series("Bear", 60, ["other"], 0.2, { manaCost: "{R}{G}" }),
    ...series("Dual", 10, ["land"], 5, { cedh: 0.4, produces: ["R", "G"] }),
  ];
  for (let budget = 40; budget <= 300; budget += 3) {
    const r = optimize({ pool: gruul, commanders: ["Cmd"], budget });
    expect(r.cost.total).toBeLessThanOrEqual(budget);
    expect(r.deck).toHaveLength(99);
  }
});

test("a bigger budget weighs the decks found below it and never scores worse beyond noise", () => {
  const found = [];
  let last = -Infinity;
  for (const budget of [60, 150, 400, 2500, Infinity]) {
    const r = run(budget, "max", {});
    const again = optimize({ pool: POOL, combos: COMBOS, commanders, original: ORIGINAL, budget, mode: "max", consider: found });
    const score = report({ pool: POOL, combos: COMBOS, commanders, deck: again.deck }).scores.overall;
    expect(score).toBeGreaterThanOrEqual(last - 1);
    expect(score).toBeGreaterThanOrEqual(report({ pool: POOL, combos: COMBOS, commanders, deck: r.deck }).scores.overall - 1);
    if (budget !== Infinity) expect(again.cost.total).toBeLessThanOrEqual(budget);
    found.push(again.deck);
    last = Math.max(last, score);
  }
  // A deck that breaks the rules or the budget is never taken from the list.
  const cheap = optimize({ pool: POOL, combos: COMBOS, commanders, budget: 60, consider: [run(Infinity).deck, ["Banned Crypt", ...ORIGINAL.slice(1)]] });
  expect(cheap.cost.total).toBeLessThanOrEqual(60);
  expect(cheap.deck).not.toContain("Banned Crypt");
});

test("rejected suggestions are respected the next time", () => {
  const first = run(2500);
  const add = first.changes.find((c) => c.add && !byName.get(c.add).basic);
  const again = run(2500, "max", { adds: [add.add], keeps: ["Bear 1"] });
  expect(again.deck).not.toContain(add.add);
  expect(again.deck).toContain("Bear 1");
  // A kept card can't be the commander or an illegal card.
  expect(run(500, "max", { keeps: [COMMANDER, "Banned Crypt"] }).deck).not.toEqual(expect.arrayContaining([COMMANDER]));
});

test("preserve keeps the deck's combo and most of its cards; value upgrades the cheapest wins first", () => {
  const preserve = run(500, "preserve");
  expect(preserve.deck).toEqual(expect.arrayContaining(["Dualcaster Mage", "Twinflame"]));
  const kept = preserve.deck.filter((n) => ORIGINAL.includes(n)).length;
  expect(kept).toBeGreaterThan(60);
  const value = run(60, "value");
  expect(value.cost.total).toBeLessThanOrEqual(60);
  expect(value.deck).toEqual(expect.arrayContaining(["Cheap Rock 1"]));
  // Over budget from the start: preserve trims it down.
  const tight = optimize({ pool: POOL, combos: COMBOS, commanders, original: [...ORIGINAL.slice(0, 60), ...Array.from({ length: 4 }, (_, i) => `Pricey Mox ${i + 1}`), ...Array(35).fill("Mountain")], budget: 200, mode: "preserve" });
  expect(tight.cost.total).toBeLessThanOrEqual(200);
});

test("the listed changes rebuild the optimized deck exactly", () => {
  for (const [mode] of MODES) {
    const r = run(500, mode);
    expect([...applyChanges(ORIGINAL, r.changes)].sort()).toEqual([...r.deck].sort());
    for (const ch of r.changes) expect(ch.reason.length).toBeGreaterThan(5);
  }
  // Applying only some changes keeps 99 cards, since every change is one card for one card.
  const r = run(500);
  expect(applyChanges(ORIGINAL, r.changes.slice(0, 5))).toHaveLength(99);
  expect(pairChanges(["A", "B"], ["A", "C", "D"], new Map())).toEqual([
    { remove: "B", add: "C" },
    { remove: null, add: "D" },
  ]);
});

test("an empty or short list is built from scratch, and an impossible budget says so", () => {
  const scratch = optimize({ pool: POOL, combos: COMBOS, commanders, budget: 300 });
  expect(scratch.deck).toHaveLength(99);
  expect(scratch.cost.total).toBeLessThanOrEqual(300);
  const broke = optimize({ pool: POOL, combos: COMBOS, commanders, budget: 1 });
  expect(broke.notes[0]).toMatch(/over the CA\$1.00 budget/);
  const short = optimize({ pool: POOL, combos: COMBOS, commanders, original: ORIGINAL.slice(0, 50), budget: 400, mode: "preserve" });
  expect(short.deck).toHaveLength(99);
  const long = optimize({ pool: POOL, combos: COMBOS, commanders, original: [...ORIGINAL, "Bear 31", "Bear 32"], budget: Infinity, mode: "preserve" });
  expect(long.deck).toHaveLength(99);
});

test("the report's odds are the exact hypergeometric ones", () => {
  const deck = run(2500).deck;
  const r = report({ pool: POOL, combos: COMBOS, commanders, deck, trials: 500 });
  const fast = deck.filter((n) => byName.get(n).roles[0] === "fastMana").length;
  expect(r.exact.find((e) => e.key === "fastMana").p).toBeCloseTo(hyperAtLeast(99, fast, 7), 12);
  expect(r.counts.fastMana).toBe(fast);
  for (const v of Object.values(r.scores)) expect(v).toBeGreaterThanOrEqual(0);
  for (const v of Object.values(r.scores)) expect(v).toBeLessThanOrEqual(100);
  expect(r.primary).not.toBeNull();
  expect(r.earliest).toBeGreaterThanOrEqual(1);
  expect(r.sim.trials).toBe(500);
  // A pile with no combo still gets scores, just no simulation.
  const pile = report({ pool: POOL, combos: [], commanders, deck: ORIGINAL });
  expect(pile.sim).toBeNull();
  expect(pile.expected).toBeNull();
  expect(pile.scores.combo).toBe(0);
});

test("combo efficiency, perfect-draw turns, values and costs", () => {
  expect(lineEfficiency(COMBOS[1], byName, commanders)).toBeGreaterThan(lineEfficiency(COMBOS[0], byName, commanders));
  expect(lineEfficiency(COMBOS[2], byName, commanders)).toBeLessThan(lineEfficiency(COMBOS[0], byName, commanders));
  // Dualcaster (3) + Twinflame (2) needs five mana: two fast mana and three lands by turn 3.
  const deck = [...Array(30).fill("Mountain"), "Cheap Rock 1", "Cheap Rock 2", "Dualcaster Mage", "Twinflame"];
  expect(theoreticalTurn(COMBOS[0], deck, byName, commanders)).toBe(3);
  expect(theoreticalTurn({ pieces: ["Twinflame"], manaNeeded: 50 }, deck, byName, commanders)).toBeNull();
  expect(cardValue(byName.get("Free Counter 1"))).toBeGreaterThan(cardValue(byName.get("Shock 1")));
  expect(cardValue(byName.get("Mountain"))).toBe(5);
  expect(deckCost(["Mountain", "Mystery Card"], byName, commanders)).toEqual({ total: 2.4, unpriced: ["Mystery Card"] });
  expect(BUDGET_TIERS.at(-1)).toBe(Infinity);
});

// Rakdos cards with the jobs Scryfall Tagger gives them and made-up EDHREC numbers for one commander.
const KARDUR = "Kardur, Doomscourge";
const rakdos = (name, roles, jobs, extra = {}) => ({ name, roles, jobs, manaValue: 2, typeLine: "Instant", instant: true, legal: true, inIdentity: true, basic: false, price: 1, edh: null, synergy: null, colorIdentity: ["B", "R"], ...extra });
const MURDER = rakdos("Murder", ["interaction"], ["creature-removal"], { manaValue: 3, price: 0.3 });
const GRASP = rakdos("Infernal Grasp", ["interaction"], ["creature-removal"], { price: 1.5, edh: 0.4, synergy: 0.1 });
const TRIUMPH = rakdos("Bitter Triumph", ["interaction"], ["creature-removal", "planeswalker-removal"], { manaValue: 1, edh: 0.2 });
const CHUPACABRA = rakdos("Ravenous Chupacabra", ["interaction"], ["creature-removal"], { manaValue: 4, typeLine: "Creature", instant: false, edh: 0.6 });
const DEMONIC = rakdos("Demonic Tutor", ["tutor"], ["tutor"], { typeLine: "Sorcery", instant: false, finds: "any", tutorTo: "hand", price: 30 });
const ENTOMB = rakdos("Entomb", ["tutor"], ["tutor"], { manaValue: 1, finds: "any", tutorTo: "graveyard", edh: 0.5 });
const CLAMP = rakdos("Skullclamp", ["draw"], ["draw"], { manaValue: 1, typeLine: "Artifact", instant: false, gameChanger: true });
const KEY = rakdos("Key to the City", ["draw"], ["draw"], { typeLine: "Artifact", instant: false, edh: 0.15 });
const BLOODGHAST = rakdos("Bloodghast", ["other"], ["reanimate", "recursion"], { typeLine: "Creature", instant: false });
const ANIMATE = rakdos("Animate Dead", ["other"], ["reanimate", "recursion"], { typeLine: "Enchantment", instant: false, edh: 0.5 });
const ACT = rakdos("Blasphemous Act", ["interaction"], ["board-wipe", "creature-removal", "burn"], { manaValue: 9, typeLine: "Sorcery", instant: false });
const KARDUR_POOL = [
  rakdos(KARDUR, ["other"], [], { manaValue: 4, typeLine: "Legendary Creature" }),
  rakdos("Swamp", ["land"], [], { basic: true, manaValue: 0, typeLine: "Basic Land — Swamp", produces: ["B"], price: 0.1 }),
  ...Array.from({ length: 45 }, (_, i) => rakdos(`Ogre ${i + 1}`, ["other"], [], { typeLine: "Creature", instant: false, price: 0.2 })),
  MURDER, GRASP, TRIUMPH, CHUPACABRA, DEMONIC, ENTOMB, CLAMP, KEY, BLOODGHAST, ANIMATE, ACT,
];

test("a replacement does the old card's job and is concretely better, never a downgrade in disguise", () => {
  expect(mainJob(ACT)).toBe("board-wipe");
  expect(mainJob(BLOODGHAST)).toBe("reanimate");
  expect(mainJob(KARDUR_POOL[2])).toBeNull(); // a plain creature has no job to replace
  expect(replaces(GRASP, MURDER)).toBe(true);
  expect(replaces(TRIUMPH, MURDER)).toBe(true); // hits creatures and more
  expect(replaces(MURDER, TRIUMPH)).toBe(false); // can't hit the planeswalkers Bitter Triumph could
  expect(replaces(CHUPACABRA, MURDER)).toBe(false); // a creature isn't a removal spell's like-for-like
  expect(replaces(ENTOMB, DEMONIC)).toBe(false); // to the graveyard, not to hand
  expect(replaces(ANIMATE, BLOODGHAST)).toBe(false); // a sacrifice deck needs a creature back
  expect(compare(TRIUMPH, MURDER, { commander: KARDUR }).gains).toEqual(["it costs 2 less mana (1 instead of 3)", "it also hits planeswalkers", `20% of ${KARDUR} decks on EDHREC play it, against 0% for Murder`]);
  // Trading away a Game Changer costs more than a few decks' worth of popularity gains back.
  const key = compare(KEY, CLAMP, { commander: KARDUR });
  expect(key.losses).toContain("Skullclamp is on Wizards' Game Changers list of the strongest Commander cards, and it isn't");
  expect(key.score).toBeLessThan(0);
});

// Players on Strictly Better voted Hero's Downfall strictly better than Murder, and Infernal Grasp not (it costs life).
const DOWNFALL = rakdos("Hero's Downfall", ["interaction"], ["creature-removal", "planeswalker-removal"], { manaValue: 3, price: 0.5 });
const VOTED_MURDER = { ...MURDER, superiors: [["Hero's Downfall", 307, 0], ["Infernal Grasp", 18, 82]] };
const LIFE_GRASP = { ...GRASP, drawbacks: ["life"] };

test("a strictly better card is one players voted so and our own check finds nothing worse in", () => {
  expect(strictlyBetter(DOWNFALL, VOTED_MURDER)).toEqual({ up: 307, down: 0 });
  // More players voted no; and without a vote even a cheaper card that does the job isn't "strictly" better.
  expect(strictlyBetter(GRASP, VOTED_MURDER)).toBeNull();
  expect(strictlyBetter(TRIUMPH, VOTED_MURDER)).toBeNull();
  // A vote isn't enough if our check finds something worse: a drawback the old card didn't have.
  expect(strictlyBetter(LIFE_GRASP, { ...MURDER, superiors: [["Infernal Grasp", 90, 3]] })).toBeNull();
  expect(compare(LIFE_GRASP, MURDER).losses).toContain("it costs you life");
  expect(compare(MURDER, LIFE_GRASP).gains).toContain("it doesn't cost you life, where Infernal Grasp costs you life");
});

test("preserve swaps in only strictly better cards, each with the vote, what's better and what it costs", () => {
  const original = ["Murder", "Demonic Tutor", "Skullclamp", "Bloodghast", ...Array.from({ length: 45 }, (_, i) => `Ogre ${i + 1}`), ...Array(50).fill("Swamp")];
  const pool = [...KARDUR_POOL.filter((c) => c !== MURDER && c !== GRASP), VOTED_MURDER, LIFE_GRASP, DOWNFALL];
  const r = optimize({ pool, commanders: [KARDUR], original, mode: "preserve" });
  expect(r.changes.map((c) => [c.remove, c.add, c.kind])).toEqual([["Murder", "Hero's Downfall", "strict"]]);
  expect(r.changes[0].why).toEqual({
    cut: `Murder is a 3-mana instant: creature removal. EDHREC doesn't list it among the cards ${KARDUR} decks play.`,
    add: `Hero's Downfall is a 3-mana instant: creature and planeswalker removal. EDHREC doesn't list it among the cards ${KARDUR} decks play.`,
    effect: "Strictly better: players on Strictly Better voted 307 to 0 that Hero's Downfall does everything Murder does and more, and TapToTrade's own check finds nothing worse. Better because it also hits planeswalkers.",
  });
  // Over budget: the dear tutor makes way for a cheap one that also puts the card in hand, and the reason says why.
  const DIABOLIC = rakdos("Diabolic Tutor", ["tutor"], ["tutor"], { manaValue: 4, typeLine: "Sorcery", instant: false, finds: "any", tutorTo: "hand", price: 0.3, edh: 0.1 });
  const tight = optimize({ pool: [...KARDUR_POOL, DIABOLIC], commanders: [KARDUR], original, budget: 25, mode: "preserve" });
  expect(tight.cost.total).toBeLessThanOrEqual(25);
  const swap = tight.changes.find((c) => c.remove === "Demonic Tutor");
  expect(swap.add).toBe("Diabolic Tutor");
  expect(swap.why.effect).toBe(`Swapped to fit your CA$25.00 budget: it saves CA$29.70. Same job: tutor. Better because 10% of ${KARDUR} decks on EDHREC play it, against 0% for Demonic Tutor. Trade-off: it costs 2 more mana (4 instead of 2).`);
});

// A Venom, Lethal Protector deck: the cards a player said were swapped wrongly, with the jobs and features Scryfall
// Tagger gives them. Venom draws cards equal to a sacrificed creature's mana value, so big creatures are the point.
const VENOM = "Eddie Brock // Venom, Lethal Protector";
const VENOM_PLAN = {
  name: "Venom",
  fuel: "mana value",
  plans: [
    { text: "attacks", tags: ["gives-trample", "gives-haste", "gives-flying", "gives-menace", "extra-combat"] },
    { text: "sacrifices creatures", tags: ["death-trigger", "sacrifice-outlet"] },
  ],
  themes: ["Reanimator", "Sacrifice"],
};
const jund = (name, roles, jobs, features, extra = {}) => rakdos(name, roles, jobs, { features, colorIdentity: ["G"], ...extra });
const UPRISING = jund("Garruk's Uprising", ["draw"], ["cantrip", "draw"], ["repeatable-draw", "gives-trample", "power-matters"], { manaValue: 3, typeLine: "Enchantment", instant: false, edh: 0.31, synergy: 0.13 });
const GRAVESTONE = jund("Eerie Gravestone", ["draw"], ["cantrip"], ["self-mill"], { typeLine: "Artifact", instant: false, edh: 0.4 });
const RETURN = jund("Return to Nature", ["interaction"], ["artifact-removal", "enchantment-removal", "graveyard-hate"], []);
const HERITAGE = jund("Heritage Reclamation", ["interaction", "draw"], ["artifact-removal", "enchantment-removal", "graveyard-hate", "cantrip", "draw"], []);
const TEAR = jund("Tear Asunder", ["interaction"], ["creature-removal", "artifact-removal", "enchantment-removal", "planeswalker-removal"], [], { edh: 0.13 });
const TYRANT = jund("Vaultborn Tyrant", ["draw"], ["draw"], ["repeatable-draw", "power-matters", "death-trigger"], { manaValue: 7, typeLine: "Creature — Dinosaur", instant: false, price: 50, edh: 0.25 });
const CRAWLER = jund("Psychosis Crawler", ["draw"], ["draw"], ["repeatable-draw", "power-matters", "death-trigger"], { manaValue: 5, typeLine: "Artifact Creature — Horror", instant: false, price: 3, edh: 0.23 });
const STONE = jund("Mind Stone", ["ramp", "draw"], ["mana-rock", "draw"], [], { typeLine: "Artifact", instant: false });
const HEIRLOOM = jund("Herd Heirloom", ["ramp", "draw"], ["mana-rock", "draw"], ["repeatable-draw", "gives-trample"], { typeLine: "Artifact", instant: false, manaRestricted: true });
const ROLLICK = rakdos("Deadly Rollick", ["interaction"], ["creature-removal"], { manaValue: 4, free: true, edh: 0.26 });

test("a direct replacement does everything the old card did for the commander's plan, and more", () => {
  // Eerie Gravestone draws once; Garruk's Uprising keeps drawing and gives trample. It isn't even the same main job:
  // Uprising is card draw first, though it also draws a card when it enters.
  expect(mainJob(UPRISING)).toBe("draw");
  expect(replaces(GRAVESTONE, UPRISING)).toBe(false);
  expect(replaces(GRAVESTONE, UPRISING, [], { exact: false })).toBe(false);
  expect(compare(GRAVESTONE, UPRISING).losses).toContain("it gives up that Garruk's Uprising keeps drawing cards, gives your creatures trample and rewards creatures with high power");
  // Heritage Reclamation is Return to Nature that also draws; Tear Asunder can't exile a card from a graveyard.
  expect(replaces(HERITAGE, RETURN)).toBe(true);
  expect(replaces(TEAR, RETURN)).toBe(false);
  expect(compare(HERITAGE, RETURN)).toMatchObject({ gains: ["it also draws a card"], losses: [] });
  // Venom draws 7 off Vaultborn Tyrant and 5 off Psychosis Crawler: cheaper to cast is worse here.
  expect(replaces(CRAWLER, TYRANT)).toBe(true);
  expect(replaces(CRAWLER, TYRANT, [], { strategy: VENOM_PLAN })).toBe(false);
  const crawler = compare(CRAWLER, TYRANT, { commander: "Venom", strategy: VENOM_PLAN });
  expect(crawler.gains).not.toContainEqual(expect.stringContaining("less mana"));
  expect(crawler.losses).toContain("its mana value is 5 instead of 7, and Venom gets more from a creature with higher mana value");
  // Mana that only casts creatures isn't Mind Stone's; a free spell isn't 4 mana.
  expect(replaces(HEIRLOOM, STONE)).toBe(false);
  expect(compare(GRASP, ROLLICK).losses).toContain("it costs 2 mana, where Deadly Rollick can be cast for free");
});

test("a budget swap keeps what the card does for the commander's plan, and a wipe kills as much", () => {
  // Skullclamp draws off deaths too, but Venom needs a creature to sacrifice, not an equipment.
  const clamp = jund("Skullclamp", ["draw"], ["draw"], ["repeatable-draw", "death-trigger"], { manaValue: 1, typeLine: "Artifact — Equipment", instant: false });
  expect(replaces(clamp, TYRANT, [], { exact: false })).toBe(true);
  expect(replaces(clamp, TYRANT, [], { strategy: VENOM_PLAN, exact: false })).toBe(false);
  // A draw creature without the death trigger gives up Vaultborn Tyrant's part in Venom's sacrifices.
  const elf = jund("Elvish Visionary", ["draw"], ["draw"], [], { typeLine: "Creature — Elf", instant: false });
  expect(replaces(elf, TYRANT, [], { strategy: VENOM_PLAN, exact: false })).toBe(false);
  expect(replaces(CRAWLER, TYRANT, [], { strategy: VENOM_PLAN, exact: false })).toBe(true);
  // End the Festivities' 1 damage doesn't wipe what Blasphemous Act's 13 does; Toxic Deluge shrinks everything.
  const act = { ...ACT, damage: 13 };
  const festivities = rakdos("End the Festivities", ["interaction"], ["board-wipe", "creature-removal", "burn"], { manaValue: 1, typeLine: "Sorcery", instant: false, damage: 1 });
  const deluge = rakdos("Toxic Deluge", ["interaction"], ["board-wipe", "creature-removal"], { manaValue: 3, typeLine: "Sorcery", instant: false });
  expect(replaces(festivities, act, [], { exact: false })).toBe(false);
  expect(replaces(deluge, act, [], { exact: false })).toBe(true);
  // Black Sun's Zenith's mana value is 2, but it costs X more to kill what Crux of Fate destroys.
  const crux = rakdos("Crux of Fate", ["interaction"], ["board-wipe", "creature-removal"], { manaValue: 5, typeLine: "Sorcery", instant: false });
  const zenith = rakdos("Black Sun's Zenith", ["interaction"], ["board-wipe", "creature-removal"], { manaValue: 2, manaCost: "{X}{B}{B}", typeLine: "Sorcery", instant: false, damage: 0 });
  expect(replaces(zenith, crux, [], { exact: false })).toBe(false);
  expect(compare(zenith, crux)).toMatchObject({ gains: [], losses: ["it costs {X}{B}{B}, so it takes more mana to do more"] });
  // Lightning Bolt's 3 damage doesn't kill what Murder destroys.
  const bolt = rakdos("Lightning Bolt", ["interaction"], ["creature-removal", "planeswalker-removal", "burn"], { manaValue: 1, price: 0.2, damage: 3 });
  expect(replaces(bolt, MURDER, [], { exact: false })).toBe(false);
  // Over budget, Avacyn (no job, but a death trigger Venom's sacrifices use) makes way for a cheap creature with one,
  // not a cheaper vanilla creature.
  const avacyn = jund("Avacyn, Angel of Horror", ["other"], [], ["death-trigger"], { manaValue: 8, typeLine: "Creature — Angel", instant: false, price: 30 });
  const shadow = jund("Shadow of Mortality", ["other"], [], [], { manaValue: 15, typeLine: "Creature — Avatar", instant: false, price: 1 });
  const butcher = jund("Butcher of Malakir", ["other"], [], ["death-trigger"], { manaValue: 7, typeLine: "Creature — Vampire", instant: false, price: 2 });
  const pool = [jund(VENOM, ["other"], [], [], { manaValue: 6, typeLine: "Legendary Creature" }), ...KARDUR_POOL.slice(1), avacyn, shadow, butcher];
  const original = ["Avacyn, Angel of Horror", ...Array.from({ length: 45 }, (_, i) => `Ogre ${i + 1}`), ...Array(53).fill("Swamp")];
  const r = optimize({ pool, commanders: [VENOM], original, budget: 25, mode: "preserve", strategy: VENOM_PLAN });
  expect(r.changes.map((c) => [c.remove, c.add])).toEqual([["Avacyn, Angel of Horror", "Butcher of Malakir"]]);
});

test("a strictly better card always goes in; otherwise EDHREC's suggestions pick a card for one EDHREC rates weak", () => {
  const venom = jund(VENOM, ["other"], [], [], { manaValue: 6, typeLine: "Legendary Creature" });
  // Ogres are in most Venom decks here, so only Return to Nature can be weak.
  const ogres = KARDUR_POOL.slice(1).map((c) => (c.name.startsWith("Ogre") ? { ...c, edh: 0.6 } : c));
  const original = ["Return to Nature", ...Array.from({ length: 45 }, (_, i) => `Ogre ${i + 1}`), ...Array(53).fill("Swamp")];
  const run = (back, forth = { recAdd: 0.4, edh: 0.6 }) => optimize({ pool: [venom, ...ogres, { ...RETURN, ...back }, { ...HERITAGE, ...forth }], commanders: [VENOM], original, mode: "preserve", strategy: VENOM_PLAN });
  // Players voted Heritage Reclamation strictly better: it goes in, even where EDHREC's decks would keep Return to Nature.
  const [strict] = run({ recCut: 0.3, edh: 0.6, superiors: [["Heritage Reclamation", 30, 0]] }).changes;
  expect([strict.remove, strict.add, strict.kind]).toEqual(["Return to Nature", "Heritage Reclamation", "strict"]);
  // No vote: EDHREC's decks keep it (a low cut score, most decks play it), so it stays.
  expect(run({ recCut: 0.3, edh: 0.6 }).changes).toEqual([]);
  // EDHREC's suggestions say cut it: the card they suggest adding comes in, a card with the same job first.
  const [swap] = run({ recCut: 0.87, edh: 0.6 }).changes;
  expect([swap.remove, swap.add, swap.kind]).toEqual(["Return to Nature", "Heritage Reclamation", "edhrec"]);
  expect(swap.why.cut).toContain("EDHREC's suggestions for your exact list rate it 87/100 to cut.");
  expect(swap.why.add).toContain("EDHREC's suggestions for your exact list rate it 40/100 to add.");
  expect(swap.why.effect).toBe("EDHREC's pick: nothing strictly better than Return to Nature fits, and EDHREC's suggestions for your list say to cut it, so this is a card EDHREC's suggestions for your list say to add. Same job: artifact removal. Better because it also draws a card.");
  // Few Venom decks play it: weak too. But a card EDHREC barely suggests doesn't come in.
  expect(run({ recCut: 0, edh: 0.1 }).changes[0].why.effect).toContain("only 10% of Venom decks on EDHREC still play it");
  expect(run({ recCut: 0.87 }, { recAdd: 0.1 }).changes).toEqual([]);
});

test("the land base: Karsten's land count for the curve, and sources for each colour's most demanding card", () => {
  const golgari = (name, cost, manaValue, extra = {}) => jund(name, ["other"], [], [], { manaCost: cost, manaValue, typeLine: "Creature", instant: false, colorIdentity: ["B", "G"], ...extra });
  const land = (name, produces, extra = {}) => jund(name, ["land"], [], [], { manaValue: 0, typeLine: "Land", instant: false, produces, colorIdentity: [], ...extra });
  const pool = [
    golgari("Golgari Boss", "{2}{B}{G}", 4, { typeLine: "Legendary Creature" }),
    ...Array.from({ length: 60 }, (_, i) => golgari(`Elf ${i + 1}`, "{1}{G}", 2, { edh: 0.5 })),
    golgari("Gray Merchant", "{3}{B}{B}", 5, { edh: 0.5 }),
    ...Array.from({ length: 10 }, (_, i) => golgari(`Spare ${i + 1}`, "{1}{G}", 2, { edh: 0.5, recCut: i / 10 })),
    land("Forest", ["G"], { basic: true, price: 0.1 }),
    land("Swamp", ["B"], { basic: true, price: 0.1 }),
    land("Woodland Cemetery", ["B", "G"], { price: 4, edh: 0.5 }),
    land("Golgari Guildgate", ["B", "G"], { price: 0.2, tapped: true }),
    land("Llanowar Wastes", ["B", "G"], { price: 1, edh: 0.3 }),
    land("Bojuka Bog", ["B"], { price: 0.5, tapped: true, jobs: ["graveyard-hate"] }),
    land("Rogue's Passage", [], { price: 0.4, utility: true }),
    land("Lotus Field", ["B", "G"], { price: 3, tapped: true, drawbacks: ["extra-cost"] }),
  ];
  const byName = new Map(pool.map((c) => [c.name, c]));
  const deck = [...Array.from({ length: 60 }, (_, i) => `Elf ${i + 1}`), "Gray Merchant", ...Array(29).fill("Forest"), "Rogue's Passage", "Swamp", ...Array.from({ length: 7 }, (_, i) => `Spare ${i + 1}`)];
  const base = manaBase(deck, byName, ["B", "G"], ["Golgari Boss"]);
  // 68 spells averaging 2.04 mana, none cheap ramp or draw: 31.42 + 3.13 × 2.04 = 37.8, so 38 lands.
  expect(base).toMatchObject({ lands: 31, wanted: 38 });
  // Gray Merchant ({3}{B}{B}) wants 23 black sources with 41 lands: 18 with 31. The deck has one. An Elf ({1}{G}) wants 19: 15.
  expect(base.colours).toEqual([
    { colour: "B", sources: 1, need: 18, card: "Gray Merchant" },
    { colour: "G", sources: 29, need: 15, card: "Elf 1" },
  ]);
  expect(base.short).toEqual(["B"]);
  // An X spell is counted as cast with X = 3: {X}{G}{G}{G} wants 28 sources (3CCC), not 36 (CCC).
  const zenith = golgari("Green Zenith", "{X}{G}{G}{G}", 3);
  expect(manaBase(["Green Zenith", ...Array(41).fill("Forest")], new Map([...byName, ["Green Zenith", zenith]]), ["G"]).colours[0].need).toBe(28);
  const r = optimize({ pool, commanders: ["Golgari Boss"], original: deck, mode: "preserve" });
  const lands = r.changes.filter((c) => c.kind === "land");
  // Short of lands first: the spells EDHREC most wants cut make way for the best duals (untapped first), then basics.
  const added = lands.filter((c) => c.remove.startsWith("Spare"));
  expect(added.map((c) => [c.remove, c.add])).toEqual(expect.arrayContaining([["Spare 7", "Woodland Cemetery"], ["Spare 6", "Llanowar Wastes"]]));
  expect(added).toHaveLength(4);
  expect(added[0].why.effect).toMatch(/^Land base: the deck has 3\d lands, and Frank Karsten's formula for a Commander deck with this curve says 38 \(give or take 3\)\. It saves CA\$0\.90\.$/);
  // Then black: Forests make way for Swamps (no dual left but a tapped one) for as long as green keeps its 17. With
  // Rogue's Passage staying, 35 lands make 36 coloured sources, one short of black's 20 and green's 17.
  const after = manaBase(r.deck, byName, ["B", "G"], ["Golgari Boss"]);
  expect(after.lands).toBe(35);
  expect(after.colours).toEqual([
    { colour: "B", sources: 19, need: 20, card: "Gray Merchant" },
    { colour: "G", sources: 17, need: 17, card: "Elf 1" },
  ]);
  expect(r.deck).not.toContain("Golgari Guildgate"); // a tapped dual doesn't replace an untapped basic
  expect(r.deck).toContain("Rogue's Passage"); // a utility land isn't traded for a basic
  expect(r.deck).not.toContain("Lotus Field"); // nor a land in for one that costs two lands
  expect(lands.find((c) => c.remove === "Forest").why.effect).toMatch(/^Land base: Black has \d+ sources, and Gray Merchant needs 20 to be cast on curve with 35 lands, by Frank Karsten's numbers\. Swamp makes black mana\./);
});

test("the optimizer learns: swaps players take rank higher, ones they keep turning down stop, and the reason says so", () => {
  const original = ["Murder", ...Array.from({ length: 45 }, (_, i) => `Ogre ${i + 1}`), ...Array(53).fill("Swamp")];
  const BREATHE = rakdos("Breathe Your Last", ["interaction"], ["creature-removal", "planeswalker-removal"], { manaValue: 3, price: 0.5 });
  const pool = [...KARDUR_POOL.filter((c) => c !== MURDER), { ...MURDER, superiors: [["Hero's Downfall", 307, 0], ["Breathe Your Last", 94, 1]] }, DOWNFALL, BREATHE];
  const run = (learned) => optimize({ pool, commanders: [KARDUR], original, mode: "preserve", learned }).changes.map((c) => c.add);
  expect(run({})).toEqual(["Hero's Downfall"]);
  // Players took Breathe Your Last for Murder twice: it ranks first now, and the reason says so.
  const took = optimize({ pool, commanders: [KARDUR], original, mode: "preserve", learned: { pairs: [["Murder", "Breathe Your Last", 2, 0]] } }).changes[0];
  expect(took.add).toBe("Breathe Your Last");
  expect(took.why.effect).toContain("Players shown this swap before took it 2 times and turned it down 0 times.");
  // Turned down three times out of three: not suggested again, so the other one is.
  expect(run({ pairs: [["Murder", "Hero's Downfall", 0, 3]] })).toEqual(["Breathe Your Last"]);
  // Players of this commander keep turning a card down, whatever it replaces: it stops coming in (5 or more no's,
  // under 25% taken: 1 of 6 is 2/8 smoothed, just enough to stay).
  expect(run({ adds: [["Hero's Downfall", 0, 5], ["Breathe Your Last", 1, 5]] })).toEqual(["Breathe Your Last"]);
  expect(run({ adds: [["Hero's Downfall", 0, 5], ["Breathe Your Last", 1, 6]] })).toEqual([]);
});

test("preserve upgrades the Venom deck only where a card is strictly better, and says what each card does for Venom", () => {
  // Even if players voted for Eerie Gravestone and Psychosis Crawler, one gives up Uprising's trample and repeat draw
  // and the other is a smaller creature for Venom to sacrifice: not strictly better here.
  const voted = (c, name) => ({ ...c, superiors: [[name, 30, 0]] });
  const pool = [jund(VENOM, ["other"], [], [], { manaValue: 6, typeLine: "Legendary Creature" }), ...KARDUR_POOL.slice(1), voted(UPRISING, "Eerie Gravestone"), GRAVESTONE, voted(RETURN, "Heritage Reclamation"), HERITAGE, TEAR, voted(TYRANT, "Psychosis Crawler"), CRAWLER];
  const original = ["Garruk's Uprising", "Return to Nature", "Vaultborn Tyrant", ...Array.from({ length: 45 }, (_, i) => `Ogre ${i + 1}`), ...Array(51).fill("Swamp")];
  const r = optimize({ pool, commanders: [VENOM], original, mode: "preserve", strategy: VENOM_PLAN });
  expect(r.changes.map((c) => [c.remove, c.add])).toEqual([["Return to Nature", "Heritage Reclamation"]]);
  expect(r.changes[0].why.effect).toBe("Strictly better: players on Strictly Better voted 30 to 0 that Heritage Reclamation does everything Return to Nature does and more, and TapToTrade's own check finds nothing worse. Better because it also draws a card.");
  const context = { byName: new Map(pool.map((c) => [c.name, c])), commanders: [VENOM], identity: ["G"], lines: [], oldLines: [], counts: {}, strategy: VENOM_PLAN };
  expect(explain({ remove: "Garruk's Uprising" }, context).cut).toBe(
    "Garruk's Uprising is a 3-mana enchantment: card draw. It keeps drawing cards, gives your creatures trample and rewards creatures with high power. That suits Venom, which attacks. It's in 31% of Venom decks on EDHREC (synergy +13%: played more with Venom than in other decks of its colours).",
  );
  expect(explain({ remove: "Vaultborn Tyrant" }, context).cut).toContain("That suits Venom, which sacrifices creatures. Venom gets more from a creature with higher mana value, and this one's is 7.");
  // Nothing to name: EDHREC's numbers decide.
  expect(explain({ remove: "Ogre 1" }, context).cut).toBe("Ogre 1 is a 2-mana creature with no specific job TapToTrade can name, so EDHREC's numbers speak for it: EDHREC doesn't list it among the cards Venom decks play.");
});

test("each swap says why the card goes, why the new one comes in and what changes", () => {
  const context = { byName, commanders, identity: ["R"], lines: [], oldLines: [], counts: { interaction: 15, draw: 15, land: 35, other: 30 }, mode: "max" };
  // A basic land is just a basic: no EDHREC share for it.
  const land = explain({ remove: "Mountain", add: "Cantrip 1" }, context);
  expect(land.cut).toBe("Mountain is a basic land that makes red mana.");
  // Not like-for-like (the max goal rebuilds the deck): says what the deck gains and gives up.
  expect(land.effect).toBe("A different job: the deck gains a 1-mana instant and gives up a land. That makes 16 card-draw cards (cEDH decks run about 9) and 34 lands.");
  // A cut that breaks a combo says so, and what the deck wins with instead.
  const combo = explain({ remove: "Twinflame", add: "Underworld Breach" }, { ...context, oldLines: [COMBOS[0]], lines: [COMBOS[1]] });
  expect(combo.cut).toContain("This breaks Dualcaster Mage + Twinflame (Infinite creature tokens with haste); the new deck wins with Underworld Breach + Lion's Eye Diamond instead.");
  expect(combo.add).toContain("It's part of Underworld Breach + Lion's Eye Diamond (Win the game)");
  // Every swap in a real run gets all three, and says whether it's the same job (or why the budget needed it).
  for (const ch of run(500).changes.filter((c) => c.remove && c.add)) {
    expect(ch.why.cut && ch.why.add && ch.why.effect).toBeTruthy();
    expect(ch.why.effect).toMatch(/^(Direct upgrade: |Same job: |Same main job: |A different job: |Both are |Swapped to fit )/);
  }
});

test("swaps pair cards of the same role first", () => {
  const pairs = pairChanges(["Bear 1", "Shock 1"], ["Free Counter 1", "Bear 2"], byName);
  expect(pairs).toEqual([
    { remove: "Bear 1", add: "Bear 2" },
    { remove: "Shock 1", add: "Free Counter 1" },
  ]);
});
