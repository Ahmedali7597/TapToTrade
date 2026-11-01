import { buildPool, classify, commanderProblem, front, lookupNames, lowestUsd, manaAdded, poolCard, tutorTargets } from "./cedh.js";
import { commanderSuggestions } from "./edhrec.js";
import { usdToCad } from "./prices.js";
import { searchCards } from "./scryfall.js";
import { combosFor } from "./spellbook.js";

jest.mock("./edhrec.js", () => ({ commanderSuggestions: jest.fn() }));
jest.mock("./prices.js", () => ({ usdToCad: jest.fn() }));
jest.mock("./scryfall.js", () => ({ searchCards: jest.fn() }));
jest.mock("./spellbook.js", () => ({ combosFor: jest.fn() }));

// Raw Scryfall cards, trimmed to the fields the optimizer reads.
const card = (name, type, text = "", extra = {}) => ({
  id: `${name}-id`,
  name,
  set: "tst",
  collector_number: "1",
  type_line: type,
  oracle_text: text,
  cmc: 1,
  mana_cost: "{1}",
  color_identity: [],
  legalities: { commander: "legal" },
  prices: { usd: "1.00", usd_foil: null, usd_etched: null },
  ...extra,
});

test("reads mana, tutor targets and roles from rules text", () => {
  expect(manaAdded("{T}: Add {C}{C}.")).toBe(2);
  expect(manaAdded("Add three mana of any one color.")).toBe(3);
  expect(manaAdded("Draw a card.")).toBe(0);
  expect(tutorTargets("Search your library for a card, put that card into your hand")).toBe("any");
  expect(tutorTargets("Search your library for an instant or sorcery card")).toEqual(["instant", "sorcery"]);
  expect(tutorTargets("Search your library for a Goblin card")).toEqual(["goblin"]);
  expect(tutorTargets("Search your library for a basic land card")).toBeNull();
  expect(tutorTargets("Transmute {1}{U}{B}")).toBe("any");
  expect(tutorTargets("Draw two cards.")).toBeNull();

  expect(classify(card("A Rock", "Artifact", "{T}: Add {C}{C}.", { cmc: 1 }))).toMatchObject({ roles: ["fastMana"], net: 1 });
  expect(classify(card("A Ritual", "Instant", "Add {B}{B}{B}.", { cmc: 1 }))).toMatchObject({ roles: ["fastMana"], net: 2 });
  expect(classify(card("A Signet", "Artifact", "{1}, {T}: Add {U}{B}.", { cmc: 2 })).roles).toEqual(["ramp"]);
  expect(classify(card("A Wall", "Creature", "{T}: Add {G}.", { cmc: 3, produced_mana: ["G"] })).roles).toEqual(["ramp"]);
  expect(classify(card("Cultivator", "Sorcery", "Search your library for a basic land card, put it onto the battlefield tapped.", { cmc: 2 })).roles).toEqual(["ramp"]);
  expect(classify(card("A Counter", "Instant", "Counter target spell.", { cmc: 2 }))).toMatchObject({ roles: ["interaction"], cheap: true, free: false });
  expect(classify(card("A Free Counter", "Instant", "If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.", { cmc: 3 }))).toMatchObject({ roles: ["interaction"], free: true });
  expect(classify(card("A Misstep", "Instant", "Counter target spell with mana value 1.", { mana_cost: "{U/P}" })).free).toBe(true);
  expect(classify(card("A Silence", "Instant", "Your opponents can't cast spells this turn.")).roles).toEqual(["protection"]);
  expect(classify(card("A Cantrip", "Sorcery", "Look at the top three cards. Draw a card.")).roles).toEqual(["draw"]);
  expect(classify(card("A Wincon", "Creature", "If you have no cards in library, you win the game.", { cmc: 2 })).roles).toEqual(["wincon"]);
  expect(classify(card("A Bear", "Creature", "")).roles).toEqual(["other"]);
  expect(classify(card("A Land", "Land", "{T}: Add {R}.")).roles).toEqual(["land"]);
  // Well-known staples use the curated roles, whatever their text says.
  expect(classify(card("Demonic Tutor", "Sorcery", "Search your library for a card"))).toMatchObject({ roles: ["tutor"], finds: "any", staple: true });
  expect(classify(card("Mana Vault", "Artifact", "{T}: Add {C}{C}{C}."))).toMatchObject({ roles: ["fastMana"], net: 2, staple: true });
});

test("pool cards carry CAD prices, legality and colour identity", () => {
  const blue = card("Force of Will", "Instant", "Counter target spell.", { color_identity: ["U"], prices: { usd: null, usd_foil: "100.00", usd_etched: "80.00" }, image_uris: { normal: "img" }, game_changer: true, edhrec_rank: 40 });
  const c = poolCard(blue, ["U", "G"], 1.4, 0.92);
  expect(c).toMatchObject({ name: "Force of Will", legal: true, inIdentity: true, price: 112, priceUsd: 80, imageUrl: "img", gameChanger: true, rank: 40, cedh: 0.92, free: true, staple: true });
  expect(poolCard(blue, ["R"], 1.4).inIdentity).toBe(false);
  expect(poolCard(card("Mana Crypt", "Artifact", "", { legalities: { commander: "banned" } }), [], 1.4).legal).toBe(false);
  expect(lowestUsd(card("X", "Instant", "", { prices: {} }))).toBeNull();
  expect(poolCard(card("Taplands", "Land", "This land enters tapped."), [], 1).tapped).toBe(true);
  expect(poolCard(card("Checkland", "Land", "This land enters tapped unless you control a Swamp."), [], 1).tapped).toBe(false);
  expect(front("Sink into Stupor // Soporific Springs")).toBe("sink into stupor");
});

test("checks the commander", () => {
  const legend = (name, text = "", extra = {}) => card(name, "Legendary Creature — Human", text, extra);
  expect(commanderProblem([legend("Kinnan")])).toBeNull();
  expect(commanderProblem([])).toMatch(/Choose one commander/);
  expect(commanderProblem([card("Sol Ring", "Artifact")])).toMatch(/isn't a legendary creature/);
  expect(commanderProblem([card("Teferi", "Legendary Planeswalker", "Teferi can be your commander.")])).toBeNull();
  expect(commanderProblem([legend("Golos", "", { legalities: { commander: "banned" } })])).toMatch(/banned as a commander/);
  expect(commanderProblem([legend("Tymna", "Partner"), legend("Kraum", "Partner")])).toBeNull();
  expect(commanderProblem([legend("Wilson", "Choose a Background"), card("Raised by Giants", "Legendary Enchantment — Background")])).toBeNull();
  expect(commanderProblem([legend("Kinnan"), legend("Urza")])).toMatch(/can't be commanders together/);
});

test("looks names up on Scryfall in short batches, cheapest printing, and remembers them", async () => {
  searchCards.mockImplementation(async (q) => {
    const names = [...q.matchAll(/!"([^"]+)"/g)].map((m) => m[1]);
    return names.filter((n) => n !== "not a card").map((n) => card(n === "wheel of fortune" ? "Wheel of Fortune" : n, "Sorcery"));
  });
  const many = Array.from({ length: 80 }, (_, i) => `Card Number ${i}`);
  const found = await lookupNames([...many, "Wheel of Fortune", "not a card"]);
  expect(found.get("wheel of fortune").name).toBe("Wheel of Fortune");
  expect(found.has("not a card")).toBe(false);
  expect(searchCards.mock.calls.length).toBeGreaterThan(1);
  for (const [q] of searchCards.mock.calls) {
    expect(q.length).toBeLessThan(1000); // Scryfall cuts longer queries off
    expect(q).toMatch(/prefer:usd-low$/);
  }
  const calls = searchCards.mock.calls.length;
  await lookupNames(["Wheel of Fortune"]);
  expect(searchCards.mock.calls.length).toBe(calls);
});

test("builds the pool from EDHREC, Spellbook, the staples and the deck", async () => {
  usdToCad.mockResolvedValue({ usdCad: 2, date: "2026-10-30" });
  commanderSuggestions.mockImplementation(async (names, variant) =>
    variant === "cedh" ? { url: "https://edhrec.com/commanders/kinnan/cedh", lists: [{ cards: [{ name: "Basalt Monolith", inclusion: 0.95 }] }] } : { url: "https://edhrec.com/commanders/kinnan", lists: [{ cards: [{ name: "Arcane Signet", inclusion: 0.9 }] }] },
  );
  combosFor.mockResolvedValue([
    { id: "1", pieces: ["Kinnan, Bonder Prodigy", "Basalt Monolith"], battlefield: ["Kinnan, Bonder Prodigy", "Basalt Monolith"], popularity: 9, win: true },
    { id: "2", pieces: ["Basalt Monolith", "Unknown Piece"], battlefield: [], popularity: 5, win: true },
  ]);
  searchCards.mockImplementation(async (q) =>
    [...q.matchAll(/!"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((n) => n !== "unknown piece")
      .map((n) => card(n.replace(/\b\w/g, (x) => x.toUpperCase()), n === "kinnan, bonder prodigy" ? "Legendary Creature" : "Artifact", "", { color_identity: n === "force of will" ? ["U"] : n === "lightning bolt" ? ["R"] : [] })),
  );
  const kinnan = card("Kinnan, Bonder Prodigy", "Legendary Creature", "", { color_identity: ["G", "U"] });
  const data = await buildPool([kinnan], ["Lightning Bolt"]);
  expect(data.identity).toEqual(["G", "U"]);
  expect(data.rate).toEqual({ usdCad: 2, date: "2026-10-30" });
  const byName = new Map(data.pool.map((c) => [c.name, c]));
  expect(byName.get("Basalt Monolith")).toMatchObject({ cedh: 0.95, price: 2 });
  expect(byName.get("Lightning Bolt").inIdentity).toBe(false);
  expect(byName.has("Island") && byName.has("Forest")).toBe(true);
  // Only lines whose every piece Scryfall knows.
  expect(data.combos.map((l) => l.id)).toEqual(["1"]);
  expect(data.sources).toMatchObject({ cedh: "https://edhrec.com/commanders/kinnan/cedh", spellbook: "https://commanderspellbook.com" });
  // EDHREC being down isn't fatal: the staples and combos still make a pool. (A colourless commander gets Wastes.)
  commanderSuggestions.mockRejectedValue(new Error("down"));
  const colourless = await buildPool([card("Karn, Silver Golem", "Legendary Artifact Creature")], []);
  expect(colourless.pool.some((c) => c.name === "Wastes")).toBe(true);
  expect(colourless.sources.cedh).toBeNull();
});
