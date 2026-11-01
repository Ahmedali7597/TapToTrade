import { applyChanges, BUDGET_TIERS, cardValue, deckCost, explain, lineEfficiency, MODES, optimize, pairChanges, report, theoreticalTurn } from "./optimizer.js";
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

test("each swap says why the card goes, why the new one comes in and what changes", () => {
  const context = { byName, commanders, identity: ["R"], lines: [], oldLines: [], counts: { interaction: 15, draw: 15, land: 35, other: 30 } };
  // Same role: compares cost and how often cEDH decks play each card.
  const same = explain({ remove: "Shock 1", add: "Free Counter 1" }, context);
  expect(same.cut).toBe(`Shock 1 is 1-mana interaction (removal, a counterspell or graveyard hate), and none of the cEDH ${COMMANDER} decks on EDHREC play it. The deck already has 15 interaction, more than the 12 a cEDH deck usually runs.`);
  expect(same.add).toBe(`Free Counter 1 is free interaction (removal, a counterspell or graveyard hate), played in 85% of cEDH ${COMMANDER} decks on EDHREC.`);
  expect(same.effect).toBe(`Same job (interaction) and can be cast for free. 85% of cEDH ${COMMANDER} decks play Free Counter 1, against 0% for Shock 1.`);
  // A basic land is just a basic: no cEDH share for it.
  const land = explain({ remove: "Mountain", add: "Cantrip 1" }, context);
  expect(land.cut).toBe("Mountain is a basic land that makes red mana.");
  expect(land.effect).toBe("One more card-draw card (15 to 16; cEDH decks run about 9) and one land fewer (35 to 34).");
  // A cut that breaks a combo says so, and what the deck wins with instead.
  const combo = explain({ remove: "Twinflame", add: "Underworld Breach" }, { ...context, oldLines: [COMBOS[0]], lines: [COMBOS[1]] });
  expect(combo.cut).toContain("This breaks Dualcaster Mage + Twinflame (Infinite creature tokens with haste); the new deck wins with Underworld Breach + Lion's Eye Diamond instead.");
  expect(combo.add).toContain("It's part of Underworld Breach + Lion's Eye Diamond (Win the game)");
  // Every swap in a real run gets all three.
  for (const ch of run(500).changes.filter((c) => c.remove && c.add)) expect(ch.why.cut && ch.why.add && ch.why.effect).toBeTruthy();
});

test("swaps pair cards of the same role first", () => {
  const pairs = pairChanges(["Bear 1", "Shock 1"], ["Free Counter 1", "Bear 2"], byName);
  expect(pairs).toEqual([
    { remove: "Bear 1", add: "Bear 2" },
    { remove: "Shock 1", add: "Free Counter 1" },
  ]);
});
