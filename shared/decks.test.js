import { colourPips, copyLimit, deckProblems, deckText, manaCurve } from "./decks.js";
import { parseDeckList } from "../server/lib/deckList.js";

const card = (name, board = "main", quantity = 1, p = {}) => ({
  board,
  quantity,
  printing: { name, setCode: "m10", collectorNumber: "1", typeLine: "Instant", manaValue: 1, manaCost: "{R}", colorIdentity: ["R"], legalities: { commander: "legal", modern: "legal" }, ...p },
});

test("copy limits: basics and any-number cards are free, commander is singleton, restricted is one", () => {
  expect(copyLimit({ name: "Forest", typeLine: "Basic Land — Forest" }, "commander")).toBe(Infinity);
  expect(copyLimit({ name: "Relentless Rats", typeLine: "Creature" }, "modern")).toBe(Infinity);
  expect(copyLimit({ name: "Sol Ring", typeLine: "Artifact" }, "commander")).toBe(1);
  expect(copyLimit({ name: "Bolt", typeLine: "Instant", legalities: { vintage: "restricted" } }, "vintage")).toBe(1);
  expect(copyLimit({ name: "Bolt", typeLine: "Instant" }, "modern")).toBe(4);
});

test("commander checks: size, commander, colour identity, singleton and bans", () => {
  const cmd = card("Krenko, Mob Boss", "commander", 1, { typeLine: "Legendary Creature — Goblin Warrior" });
  const deck = [cmd, card("Lightning Bolt", "main", 2), card("Counterspell", "main", 1, { colorIdentity: ["U"] }), card("Mana Crypt", "main", 1, { legalities: { commander: "banned" } })];
  const problems = deckProblems("commander", deck);
  expect(problems).toEqual(
    expect.arrayContaining([
      "A Commander deck has exactly 100 cards, counting the commander. This one has 5.",
      "Counterspell is outside your commander's colour identity.",
      "Lightning Bolt: only one copy is allowed, and the deck has 2.",
      "Mana Crypt is banned in Commander.",
    ]),
  );
  expect(deckProblems("commander", [card("Bolt")])).toContain("Choose a commander: add a legendary creature to the Commander board.");
});

test("constructed checks: 60 cards, 15-card sideboard, four copies across main and side", () => {
  const deck = [card("Lightning Bolt", "main", 4), card("Lightning Bolt", "side", 1), card("Forest", "main", 56, { typeLine: "Basic Land — Forest", legalities: { modern: "legal" } }), card("Shock", "side", 15)];
  expect(deckProblems("modern", deck)).toEqual([
    "A sideboard can have at most 15 cards. This one has 16.",
    "Lightning Bolt: at most 4 copies are allowed, and the deck has 5.",
    "Shock: at most 4 copies are allowed, and the deck has 15.",
  ]);
  expect(deckProblems("casual", [card("Lightning Bolt", "main", 9)])).toEqual([]);
});

test("mana curve skips lands and the maybeboard; pips count hybrid for both colours", () => {
  const deck = [card("Bolt", "main", 4), card("Big", "main", 1, { manaValue: 9 }), card("Forest", "main", 10, { typeLine: "Basic Land — Forest", manaValue: 0 }), card("Maybe", "maybe", 3)];
  expect(manaCurve(deck).map((b) => b.count)).toEqual([0, 4, 0, 0, 0, 0, 0, 1]);
  expect(colourPips([card("Kitchen", "main", 2, { manaCost: "{1}{R/G}{R}" })])).toMatchObject({ R: 4, G: 2 });
});

test("decklists round-trip through text, with sections and Archidekt tags", () => {
  const text = deckText([card("Sol Ring", "commander"), card("Lightning Bolt", "main", 4), card("Shock", "side", 2)]);
  expect(text).toBe("Commander\n1 Sol Ring (M10) 1\n\nDeck\n4 Lightning Bolt (M10) 1\n\nSideboard\n2 Shock (M10) 1\n");
  expect(parseDeckList(text).rows.map((r) => [r.name, r.board, r.quantity, r.setCode])).toEqual([
    ["Sol Ring", "commander", 1, "m10"],
    ["Lightning Bolt", "main", 4, "m10"],
    ["Shock", "side", 2, "m10"],
  ]);
  const archidekt = parseDeckList("1x Krenko, Mob Boss (DDT) 52 [Commander{top}]\n1x Goblin Bombardment [Maybeboard]\nSIDEBOARD:\n2 Pyroblast\nbad line here");
  expect(archidekt.rows.map((r) => [r.name, r.board])).toEqual([
    ["Krenko, Mob Boss", "commander"],
    ["Goblin Bombardment", "maybe"],
    ["Pyroblast", "side"],
  ]);
  expect(archidekt.skipped).toEqual([{ line: 5, name: "bad line here", reason: "Couldn't read this line." }]);
});
