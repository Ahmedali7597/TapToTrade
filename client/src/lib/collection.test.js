import { binderPages, colourGroup, filterItems, groupItems, mainType, sortItems, summarize } from "./collection";

let next = 1;
const item = (name, { typeLine = "Instant", colors = ["R"], rarity = "common", quantity = 1, available = true, setName = "Magic 2010", addedAt, finish = "nonfoil", id = next++ } = {}) => ({
  id,
  quantity,
  available,
  finish,
  addedAt,
  printing: { id: `p-${name}`, name, setCode: "m10", setName, collectorNumber: String(id), typeLine, colors, rarity },
});

test("puts each card under its main type, the way deck sites do", () => {
  expect(mainType("Artifact Creature — Golem")).toBe("Creature");
  expect(mainType("Artifact Land")).toBe("Land");
  expect(mainType("Legendary Planeswalker — Jace")).toBe("Planeswalker");
  expect(mainType("Sorcery // Instant")).toBe("Sorcery"); // front face only
  expect(mainType(null)).toBe("Other");
  expect(colourGroup({ typeLine: "Basic Land — Forest", colors: [] })).toBe("Lands");
  expect(colourGroup({ typeLine: "Artifact", colors: [] })).toBe("Colourless");
  expect(colourGroup({ typeLine: "Creature", colors: ["W", "U"] })).toBe("Multicolour");
  expect(colourGroup({ typeLine: "Creature", colors: ["G"] })).toBe("Green");
});

test("groups in deck order, with unknown groups last", () => {
  const cards = [item("Forest", { typeLine: "Basic Land" }), item("Bolt"), item("Goblin", { typeLine: "Creature — Goblin" }), item("Mystery", { typeLine: null })];
  expect(groupItems(cards, "type").map((g) => [g.label, g.items.map((i) => i.printing.name)])).toEqual([
    ["Creatures", ["Goblin"]],
    ["Instants", ["Bolt"]],
    ["Lands", ["Forest"]],
    ["Other", ["Mystery"]],
  ]);
  expect(groupItems(cards, "none")).toEqual([{ label: "All cards", items: cards }]);
  expect(groupItems([item("A", { rarity: "common" }), item("B", { rarity: "mythic" })], "rarity").map((g) => g.label)).toEqual(["Mythic rare", "Common"]);
});

test("sorts by price with unpriced cards last, and by newest", () => {
  const a = item("Alpha", { addedAt: "2026-10-01T00:00:00Z" });
  const b = item("Beta", { addedAt: "2026-10-03T00:00:00Z" });
  const c = item("Gamma", { addedAt: "2026-10-02T00:00:00Z" });
  const prices = { prices: { "p-Alpha:nonfoil": { cad: 2 }, "p-Beta:nonfoil": { cad: 9 } } };
  expect(sortItems([a, b, c], "price", prices).map((i) => i.printing.name)).toEqual(["Beta", "Alpha", "Gamma"]);
  expect(sortItems([a, b, c], "newest").map((i) => i.printing.name)).toEqual(["Beta", "Gamma", "Alpha"]);
  expect(sortItems([c, a, b], "name").map((i) => i.printing.name)).toEqual(["Alpha", "Beta", "Gamma"]);
});

test("filters by text and visibility, and totals the collection", () => {
  const cards = [item("Lightning Bolt", { quantity: 4, rarity: "uncommon" }), item("Sol Ring", { typeLine: "Artifact", available: false, quantity: 2, rarity: "rare" })];
  expect(filterItems(cards, { q: "artifact" }).map((i) => i.printing.name)).toEqual(["Sol Ring"]);
  expect(filterItems(cards, { show: "shared" }).map((i) => i.printing.name)).toEqual(["Lightning Bolt"]);
  expect(summarize(cards, { prices: { "p-Lightning Bolt:nonfoil": { cad: 1.25 } } })).toMatchObject({
    cards: 6,
    listings: 2,
    shared: 1,
    value: 5,
    unpriced: 1,
    rarity: { uncommon: 4, rare: 2 },
  });
});

test("starts each group on a fresh binder page", () => {
  const groups = [{ label: "Creatures", items: Array.from({ length: 10 }, (_, i) => item(`C${i}`)) }, { label: "Lands", items: [item("Forest")] }];
  expect(binderPages(groups).map((p) => [p.label, p.items.length])).toEqual([
    ["Creatures", 9],
    ["Creatures", 1],
    ["Lands", 1],
  ]);
});
