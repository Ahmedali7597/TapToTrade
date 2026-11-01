import { combosFor, toLine } from "./spellbook.js";

const use = (name, zones = ["H"], mustBeCommander = false) => ({ card: { name }, zoneLocations: zones, mustBeCommander });
const variant = (id, uses, produces, extra = {}) => ({
  id,
  status: "OK",
  uses,
  produces: produces.map((name) => ({ feature: { name } })),
  requires: [],
  legalities: { commander: true },
  manaValueNeeded: 5,
  easyPrerequisites: "",
  notablePrerequisites: "You control a creature.",
  description: "Cast A.\nCast B.",
  popularity: 70000,
  ...extra,
});

test("reads a Spellbook variant into a combo line", () => {
  const line = toLine(variant("147-1235", [use("Dualcaster Mage"), use("Twinflame")], ["Infinite creature LTB", "Infinite creature tokens with haste"]), ["Rograkh, Son of Rohgahh"]);
  expect(line).toEqual({
    id: "147-1235",
    pieces: ["Dualcaster Mage", "Twinflame"],
    produces: ["Infinite creature tokens with haste", "Infinite creature LTB"], // the winning result first
    win: true,
    manaNeeded: 5,
    battlefield: [],
    prerequisites: "You control a creature.",
    steps: ["Cast A.", "Cast B."],
    popularity: 70000,
    url: "https://commanderspellbook.com/combo/147-1235/",
  });
});

test("infinite mana is a game plan only with the commander; unusable variants are dropped", () => {
  const kinnan = ["Kinnan, Bonder Prodigy"];
  const withCommander = toLine(variant("a", [use("Kinnan, Bonder Prodigy", ["B"], true), use("Basalt Monolith", ["B"])], ["Infinite colorless mana"], { manaValueNeeded: 0 }), kinnan);
  expect(withCommander).toMatchObject({ win: true, battlefield: ["Kinnan, Bonder Prodigy", "Basalt Monolith"] });
  expect(toLine(variant("b", [use("Basalt Monolith"), use("Rings of Brighthearth")], ["Infinite colorless mana"]), kinnan).win).toBe(false);
  // Needs a different commander, uses a placeholder piece, isn't legal, or Spellbook flagged it.
  expect(toLine(variant("c", [use("Urza, Lord High Artificer", ["C"], true), use("Winter Orb")], ["Win the game"]), kinnan)).toBeNull();
  expect(toLine(variant("d", [use("Ashnod's Altar")], ["Infinite mana"], { requires: [{ template: { name: "A creature" } }] }), kinnan)).toBeNull();
  expect(toLine(variant("e", [use("Flash")], ["Win the game"], { legalities: { commander: false } }), kinnan)).toBeNull();
  expect(toLine(variant("f", [use("X")], ["Win the game"], { status: "NW" }), kinnan)).toBeNull();
});

test("asks for the commander's combos and the colours' best ones once a day", async () => {
  const winning = variant("w", [use("Thassa's Oracle"), use("Demonic Consultation")], ["Win the game"]);
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [winning] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [winning] }) }) // a repeat is kept once
    .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [variant("x", [use("Y")], ["Win the game"], { status: "NW" })] }) });
  const lines = await combosFor(["Tymna the Weaver"], ["W", "B"]);
  expect(lines.map((l) => l.id)).toEqual(["w"]);
  expect(decodeURIComponent(global.fetch.mock.calls[0][0])).toContain('card:"Tymna the Weaver"');
  expect(decodeURIComponent(global.fetch.mock.calls[2][0])).toContain("ci<=wb");
  await combosFor(["Tymna the Weaver"], ["W", "B"]);
  expect(global.fetch).toHaveBeenCalledTimes(3); // cached
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  expect(await combosFor(["Colourless One"], [])).toEqual([]);
  expect(decodeURIComponent(global.fetch.mock.calls.at(-1)[0])).toContain("ci<=c");
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });
  await expect(combosFor(["Down"], ["R"])).rejects.toThrow("Commander Spellbook responded 500");
});
