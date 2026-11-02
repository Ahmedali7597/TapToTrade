import { buildPool, classify, commanderProblem, front, lookupNames, lowestUsd, manaAdded, poolCard, strategyOf, textDrawbacks, textFeatures, textJobs, tutorTargets } from "./cedh.js";
import { commanderSuggestions, deckRecs } from "./edhrec.js";
import { usdToCad } from "./prices.js";
import { searchCards } from "./scryfall.js";
import { combosFor } from "./spellbook.js";

jest.mock("./edhrec.js", () => ({ commanderSuggestions: jest.fn(), deckRecs: jest.fn() }));
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
  // Graveyard recursion isn't removal: a copy of a creature card (Abyssal Harvester) or one back to hand (Grave Scrabbler).
  expect(classify(card("Abyssal Harvester", "Creature", "{T}: Exile target creature card from a graveyard that was put there this turn. Create a token that's a copy of it. Then exile all other Nightmare tokens you control.", { cmc: 3 })).roles).toEqual(["other"]);
  expect(classify(card("Grave Scrabbler", "Creature", "Madness {1}{B}\nWhen this creature enters, if its madness cost was paid, you may return target creature card from a graveyard to its owner's hand.", { cmc: 4 }))).toMatchObject({ roles: ["other"], madness: 2 });
  expect(classify(card("Dark Withering", "Instant", "Destroy target nonblack creature.\nMadness {B}", { cmc: 6 }))).toMatchObject({ roles: ["interaction"], madness: 1 });
  expect(classify(card("Polluted Delta", "Land", "Search your library for an Island or Swamp card, put it onto the battlefield, then shuffle."))).toMatchObject({ roles: ["land"], fetch: true });
  expect(classify(card("A Land", "Land", "{T}: Add {R}.")).fetch).toBe(false);
  // Jobs come from Scryfall Tagger's tags (server/data/function-tags.json) and the rules text.
  expect(classify(card("Blasphemous Act", "Sorcery", "Blasphemous Act deals 13 damage to each creature.", { cmc: 9 }))).toMatchObject({ roles: ["interaction"], jobs: expect.arrayContaining(["board-wipe"]), instant: false, damage: 13 });
  expect(classify(card("A Toxic Wipe", "Sorcery", "As an additional cost, pay X life.\nAll creatures get -X/-X until end of turn.")).damage).toBeNull();
  expect(classify(card("A Bolt", "Instant", "A Bolt deals 3 damage to any target.")).damage).toBe(3);
  expect(classify(card("A Doom Blade", "Instant", "Destroy target nonblack creature.")).damage).toBeNull();
  expect(classify(card("A Chain Reaction", "Sorcery", "A Chain Reaction deals X damage to each creature, where X is the number of creatures on the battlefield.")).damage).toBe(0);
  expect(classify(card("A Zenith", "Sorcery", "Put X -1/-1 counters on each creature. Shuffle A Zenith into its owner's library.")).damage).toBe(0);
  // Tear Asunder (tagged as removal for its kicked mode) only hits artifacts and enchantments unkicked.
  expect(classify(card("Tear Asunder", "Instant", "Kicker {1}{B}\nExile target artifact or enchantment. If this spell was kicked, exile target nonland permanent instead.")).jobs).not.toContain("creature-removal");
  expect(classify(card("Hellrider", "Creature — Devil", "Whenever a creature you control attacks, Hellrider deals 1 damage to the player or planeswalker it's attacking.", { cmc: 4 })).roles).toEqual(["other"]);
  expect(classify(card("A Fresh Kill", "Instant", "Destroy target creature or planeswalker."))).toMatchObject({ roles: ["interaction"], jobs: ["creature-removal", "planeswalker-removal"], instant: true });
  expect(classify(card("A Flash Bear", "Creature", "Flash\nWhen this creature enters, draw a card.")).instant).toBe(true);
  expect(classify(card("Red Elemental Blast", "Instant", "Choose one —\n• Counter target blue spell.\n• Destroy target blue permanent.")).jobs).toEqual([]);
  expect(classify(card("A Sphere", "Artifact", "{T}: Add one mana of any color.\nSacrifice this artifact: Draw a card.", { cmc: 3 })).roles).toEqual(["ramp", "draw"]);
  expect(classify(card("Entomb", "Instant", "Search your library for a card, put that card into your graveyard, then shuffle.")).tutorTo).toBe("graveyard");
  expect(classify(card("Vampiric Tutor", "Instant", "Search your library for a card, then shuffle and put that card on top.")).tutorTo).toBe("top");
  // Well-known staples use the curated roles, whatever their text says.
  expect(classify(card("Demonic Tutor", "Sorcery", "Search your library for a card"))).toMatchObject({ roles: ["tutor"], finds: "any", staple: true });
  expect(classify(card("Mana Vault", "Artifact", "{T}: Add {C}{C}{C}."))).toMatchObject({ roles: ["fastMana"], net: 2, staple: true });
});

// Real rules text: the Venom deck these rules were checked on.
const UPRISING = "When this enchantment enters, if you control a creature with power 4 or greater, draw a card.\nCreatures you control have trample.\nWhenever a creature you control with power 4 or greater enters, draw a card.";
const RETURN_TO_NATURE = "Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Exile target card from a graveyard.";
const HERITAGE = "Choose one —\n• Destroy target artifact.\n• Destroy target enchantment.\n• Exile up to one target card from a graveyard. Draw a card.";
const VENOM = [
  { name: "Eddie Brock", oracle_text: "When Eddie Brock enters, return target creature card with mana value 1 or less from your graveyard to the battlefield.\n{3}{B}{R}{G}: Transform Eddie Brock. Activate only as a sorcery." },
  { name: "Venom, Lethal Protector", oracle_text: "Menace, trample, haste\nWhenever Venom attacks, you may sacrifice another creature. If you do, draw X cards, then you may put a permanent card with mana value X or less from your hand onto the battlefield, where X is the sacrificed creature's mana value." },
];

test("reads what else a card does for the plan, the way Scryfall Tagger tags it", () => {
  expect(textFeatures(UPRISING)).toEqual(["repeatable-draw", "gives-trample", "power-matters"]);
  expect(textFeatures("Whenever you draw a card, each opponent loses 1 life.")).toEqual([]); // a payoff, not a draw engine
  expect(textFeatures("{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.")).toEqual([]); // Mind Stone draws once
  expect(textFeatures("Equipped creature has shroud and haste.")).toEqual(["gives-haste"]);
  expect(textFeatures(VENOM[1].oracle_text)).toEqual(["cheat-into-play"]);
  expect(textFeatures("Return target creature card from your graveyard to the battlefield.")).toEqual([]); // that's reanimation
  expect(textJobs(RETURN_TO_NATURE, "Instant")).toEqual(["artifact-removal", "enchantment-removal", "graveyard-hate"]);
  expect(classify(card("Herd Heirloom", "Artifact", "{T}: Add one mana of any color. Spend this mana only to cast a creature spell.")).manaRestricted).toBe(true);
  expect(classify(card("Null Elemental Blast", "Instant", "Choose one —\n• Counter target multicolored spell.\n• Destroy target multicolored permanent.")).jobs).toEqual([]);
});

test("reads a card's downsides, which a strictly better card may not add", () => {
  expect(textDrawbacks("Destroy target creature. You lose 2 life.")).toEqual(["life"]); // Infernal Grasp
  expect(textDrawbacks("As an additional cost to cast this spell, pay X life.\nAll creatures get -X/-X until end of turn.")).toEqual(["life"]);
  expect(textDrawbacks("{T}: Add {C}.\n{T}: Add {B} or {G}. Llanowar Wastes deals 1 damage to you.")).toEqual(["life"]);
  expect(textDrawbacks("Destroy target permanent. Its controller creates a 3/3 green Beast creature token.")).toEqual(["helps-opponent"]);
  expect(textDrawbacks("Exile target creature. Its controller gains life equal to its power.")).toEqual(["helps-opponent"]);
  expect(textDrawbacks("At the beginning of each player's draw step, if this artifact is untapped, that player draws an additional card.")).toEqual(["symmetric"]);
  expect(textDrawbacks("Each player discards their hand, then draws seven cards.")).toEqual(["symmetric"]);
  expect(textDrawbacks("As an additional cost to cast this spell, sacrifice a creature.\nDestroy target creature.")).toEqual(["extra-cost"]);
  expect(textDrawbacks("Cumulative upkeep {1}")).toEqual(["upkeep"]);
  expect(textDrawbacks("Hexproof\nLotus Field enters tapped.\nWhen Lotus Field enters, sacrifice two untapped lands.\n{T}: Add three mana of any one color.")).toEqual(["extra-cost"]);
  expect(textDrawbacks("Destroy target creature or planeswalker.")).toEqual([]); // Hero's Downfall
  expect(textDrawbacks("Whenever you lose life, draw a card.")).toEqual([]); // a payoff, not a cost
  expect(classify(card("Murder", "Instant", "Destroy target creature.")).drawbacks).toEqual([]);
});

test("tells a utility land from a plain one, and which colours a fetch land finds", () => {
  const land = (name, text, type = "Land") => classify(card(name, type, text));
  for (const [name, text] of [
    ["Rogue's Passage", "{T}: Add {C}.\n{4}, {T}: Target creature can't be blocked this turn."],
    ["Reliquary Tower", "You have no maximum hand size.\n{T}: Add {C}."],
    ["Halimar Depths", "Halimar Depths enters tapped.\nWhen Halimar Depths enters, look at the top three cards of your library, then put them back in any order.\n{T}: Add {U}."],
  ]) {
    expect(land(name, text).utility).toBe(true);
  }
  expect(land("Ancient Den", "{T}: Add {W}.", "Artifact Land").utility).toBe(true);
  for (const [name, text] of [
    ["Island", "({T}: Add {U}.)"],
    ["Godless Shrine", "({T}: Add {W} or {B}.)\nAs Godless Shrine enters, you may pay 2 life. If you don't, it enters tapped."],
    ["Temple of Triumph", "Temple of Triumph enters tapped.\nWhen Temple of Triumph enters, scry 1.\n{T}: Add {R} or {W}."],
    ["Thriving Bluff", "Thriving Bluff enters tapped. As it enters, choose a color other than red.\n{T}: Add {R} or one mana of the chosen color."],
    ["City of Brass", "Whenever City of Brass becomes tapped, it deals 1 damage to you.\n{T}: Add one mana of any color."],
    ["Mystic Gate", "{T}: Add {C}.\n{W/U}, {T}: Add {W}{W}, {W}{U}, or {U}{U}."],
    ["Dimir Aqueduct", "Dimir Aqueduct enters tapped.\nWhen Dimir Aqueduct enters, return a land you control to its owner's hand.\n{T}: Add {U}{B}."],
    ["Zagoth Triome", "({T}: Add {B}, {R}, or {G}.)\nThis land enters tapped.\nCycling {3}"],
    ["Flooded Strand", "{T}, Pay 1 life, Sacrifice Flooded Strand: Search your library for a Plains or Island card, put it onto the battlefield, then shuffle."],
  ]) {
    expect([name, land(name, text).utility]).toEqual([name, false]);
  }
  expect(land("Scalding Tarn", "{T}, Pay 1 life, Sacrifice Scalding Tarn: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.").fetches).toEqual(["U", "R"]);
  expect(land("Fabled Passage", "{T}, Sacrifice Fabled Passage: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle. Then if you control four or more lands, untap that land.").fetches).toBeUndefined();
  // Evolving Wilds' land comes in tapped; Fabled Passage's untaps once you have four lands.
  const wilds = card("Evolving Wilds", "Land", "{T}, Sacrifice Evolving Wilds: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.");
  expect(poolCard(wilds, ["W", "U"], 1).tapped).toBe(true);
  expect(poolCard(card("Cultivator", "Sorcery", "Search your library for a basic land card, put it onto the battlefield tapped."), [], 1).tapped).toBe(false);
});

test("reads what the commander rewards: Venom turns a sacrificed creature's mana value into cards", () => {
  const venom = card("Eddie Brock // Venom, Lethal Protector", "Legendary Creature — Human Hero Villain // Legendary Creature — Symbiote Hero Villain", undefined, { card_faces: VENOM });
  expect(strategyOf([venom], ["Reanimator"])).toEqual({
    name: "Venom",
    fuel: "mana value",
    plans: [
      { text: "attacks", tags: ["gives-trample", "gives-haste", "gives-flying", "gives-menace", "extra-combat"] },
      { text: "sacrifices creatures", tags: ["death-trigger", "sacrifice-outlet"] },
      { text: "uses the graveyard", tags: ["reanimate", "recursion", "self-mill"] },
      { text: "puts permanents onto the battlefield from your hand", tags: ["cheat-into-play"] },
    ],
    themes: ["Reanimator"],
  });
  expect(strategyOf([card("Kardur, Doomscourge", "Legendary Creature", "When Kardur enters, until your next turn, creatures your opponents control attack each combat if able.")])).toMatchObject({ name: "Kardur", fuel: null });
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

test("searches Scryfall for cards that do everything a deck card does, and keeps only real replacements", async () => {
  usdToCad.mockResolvedValue({ usdCad: 1.4, date: "2026-11-01" });
  commanderSuggestions.mockImplementation(async (names, variant) => (variant ? null : { url: "https://edhrec.com/commanders/titania", themes: ["Lands", "Elementals", "Ramp", "Tokens"], lists: [] }));
  combosFor.mockResolvedValue([]);
  const green = { color_identity: ["G"], cmc: 2, mana_cost: "{1}{G}" };
  const titania = card("Titania, Protector of Argoth", "Legendary Creature — Elemental", "Whenever a land you control is put into a graveyard from the battlefield, create a 5/3 green Elemental creature token.", { color_identity: ["G"] });
  searchCards.mockImplementation(async (q) =>
    q.includes("otag:")
      ? [card("Heritage Reclamation", "Instant", HERITAGE, green), card("Naturalize", "Instant", "Destroy target artifact or enchantment.", green)]
      : [...q.matchAll(/!"([^"]+)"/g)].map((m) => m[1]).filter((n) => n === "return to nature").map(() => card("Return to Nature", "Instant", RETURN_TO_NATURE, green)),
  );
  searchCards.mockClear();
  deckRecs.mockResolvedValue({ adds: new Map([["Heritage Reclamation", 0.4]]), cuts: new Map([["Return to Nature", 0.87]]) });
  const data = await buildPool([titania], ["Return to Nature"]);
  // EDHREC's suggestions for the list ride along on each card.
  expect(deckRecs).toHaveBeenCalledWith(["Titania, Protector of Argoth"], ["Return to Nature"]);
  expect(data.pool.find((c) => c.name === "Return to Nature")).toMatchObject({ recCut: 0.87, recAdd: null });
  expect(data.pool.find((c) => c.name === "Heritage Reclamation")).toMatchObject({ recAdd: 0.4, recCut: null });
  const alike = searchCards.mock.calls.map(([q]) => q).filter((q) => q.includes("otag:"));
  expect(alike).toEqual(["((otag:artifact-removal otag:enchantment-removal otag:graveyard-hate)) id<=g f:commander game:paper -t:land prefer:usd-low order:edhrec"]);
  // Naturalize can't exile a card from a graveyard, so it isn't a direct replacement for Return to Nature.
  const names = data.pool.map((c) => c.name);
  expect(names).toContain("Heritage Reclamation");
  expect(names).not.toContain("Naturalize");
  // Players on Strictly Better voted Heritage Reclamation strictly better than Return to Nature (server/data/strictly-better.json).
  expect(data.pool.find((c) => c.name === "Return to Nature").superiors).toEqual([["Heritage Reclamation", expect.any(Number), expect.any(Number)]]);
  expect(searchCards.mock.calls.some(([q]) => q.includes('!"heritage reclamation"'))).toBe(true);
  expect(data.strategy).toMatchObject({ name: "Titania", themes: ["Lands", "Elementals", "Ramp"] });
});
