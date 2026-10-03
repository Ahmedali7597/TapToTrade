import { cardDetails, rankByName, sample, searchPrintings, showcasePool, toDetails, toPrinting } from "./scryfall.js";

const card = {
  id: "435589bb-27c6-4a6d-9d63-394d5092b9d8",
  name: "Lightning Bolt",
  set: "m10",
  set_name: "Magic 2010",
  collector_number: "146",
  image_uris: { normal: "https://cards.scryfall.io/normal/bolt.jpg" },
};

describe("toPrinting", () => {
  test("maps a Scryfall card to a printing", () => {
    expect(toPrinting(card)).toEqual({
      id: card.id,
      name: "Lightning Bolt",
      setCode: "m10",
      setName: "Magic 2010",
      collectorNumber: "146",
      imageUrl: "https://cards.scryfall.io/normal/bolt.jpg",
      finishes: ["nonfoil"],
    });
  });

  test("keeps the finishes we support and drops the rest", () => {
    expect(toPrinting({ ...card, finishes: ["nonfoil", "foil", "glossy"] }).finishes).toEqual(["nonfoil", "foil"]);
    expect(toPrinting({ ...card, finishes: ["etched"] }).finishes).toEqual(["etched"]);
  });

  test("uses the front face image for double-faced cards", () => {
    const dfc = { ...card, image_uris: undefined, card_faces: [{ image_uris: { normal: "front.jpg" } }, {}] };
    expect(toPrinting(dfc).imageUrl).toBe("front.jpg");
    expect(toPrinting({ ...card, image_uris: undefined }).imageUrl).toBeNull();
  });
});

test("rankByName puts exact and prefix matches before loose full-text matches", () => {
  const names = ["Solemn Offering", "Sol Ring", "Sol Ring Token", "Pristine Sol Ring", "Solemn Offering"].map((name) => ({ name }));
  expect(rankByName(names, "sol ring").map((p) => p.name)).toEqual(["Sol Ring", "Sol Ring Token", "Pristine Sol Ring", "Solemn Offering", "Solemn Offering"]);
});

describe("searchPrintings", () => {
  afterEach(() => jest.restoreAllMocks());

  test("sends Scryfall's required headers and caches results", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [card] }) });
    await expect(searchPrintings("Lightning Bolt")).resolves.toHaveLength(1);
    await searchPrintings("lightning bolt"); // cached, case-insensitive
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("q=Lightning%20Bolt");
    expect(init.headers).toMatchObject({ "User-Agent": expect.stringContaining("TapToTrade"), Accept: "application/json" });
  });

  test("treats Scryfall's 404 as no matches and throws on other errors", async () => {
    jest.spyOn(global, "fetch").mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(searchPrintings("zzzz no card")).resolves.toEqual([]);
    jest.spyOn(global, "fetch").mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(searchPrintings("service down")).rejects.toThrow("503");
  });
});

describe("card details", () => {
  afterEach(() => jest.restoreAllMocks());

  test("toDetails keeps rules text, stats, legalities, prices and rulings", () => {
    const d = toDetails(
      { ...card, mana_cost: "{R}", type_line: "Instant", oracle_text: "Lightning Bolt deals 3 damage to any target.", rarity: "common", artist: "Christopher Moeller", legalities: { modern: "legal" }, prices: { usd: "1.97", usd_foil: null, eur: "1.34" }, scryfall_uri: "https://scryfall.com/card/m10/146", image_uris: { large: "large.jpg", normal: "normal.jpg" } },
      [{ published_at: "2024-11-08", comment: "It can target a planeswalker." }],
    );
    expect(d).toMatchObject({ name: "Lightning Bolt", imageUrl: "large.jpg", rarity: "common", artist: "Christopher Moeller", legalities: { modern: "legal" }, prices: { usd: "1.97", usdFoil: null, eur: "1.34" } });
    expect(d.faces).toEqual([expect.objectContaining({ manaCost: "{R}", typeLine: "Instant", stats: null })]);
    expect(d.rulings).toEqual([{ date: "2024-11-08", text: "It can target a planeswalker." }]);
  });

  test("double-faced cards keep each face with its own text, stats and image", () => {
    const d = toDetails({
      ...card,
      image_uris: undefined,
      card_faces: [
        { name: "Front", mana_cost: "{1}{G}", type_line: "Creature", oracle_text: "Transform it.", power: "2", toughness: "3", image_uris: { large: "front.jpg" } },
        { name: "Back", type_line: "Planeswalker", oracle_text: "+1: Draw.", loyalty: "4", image_uris: { large: "back.jpg" } },
      ],
    });
    expect(d.imageUrl).toBe("front.jpg");
    expect(d.faces.map((f) => [f.name, f.stats, f.imageUrl])).toEqual([["Front", "2 / 3", "front.jpg"], ["Back", "Loyalty 4", "back.jpg"]]);
  });

  test("cardDetails fetches the card and its rulings once, and is null for an unknown id", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ...card, id: "11111111-1111-1111-1111-111111111111" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ published_at: "2020-01-01", comment: "A ruling." }] }) });
    const d = await cardDetails("11111111-1111-1111-1111-111111111111");
    expect(d.rulings).toHaveLength(1);
    await cardDetails("11111111-1111-1111-1111-111111111111"); // cached for a day
    expect(fetchMock).toHaveBeenCalledTimes(2);
    jest.spyOn(global, "fetch").mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(cardDetails("22222222-2222-2222-2222-222222222222")).resolves.toBeNull();
  });
});

test("sample picks distinct items without changing the source list", () => {
  const items = [1, 2, 3, 4, 5, 6];
  const picked = sample(items, 4);
  expect(new Set(picked).size).toBe(4);
  expect(picked.every((x) => items.includes(x))).toBe(true);
  expect(items).toEqual([1, 2, 3, 4, 5, 6]);
  expect(sample(items, 10)).toHaveLength(6);
});

test("the showcase pool is fetched once and shared by callers", async () => {
  const page = { total_cards: 400, data: [card, { ...card, id: "other", image_uris: undefined }] };
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => page });
  const [a, b] = await Promise.all([showcasePool(), showcasePool()]);
  expect(a).toBe(b);
  expect(a.map((c) => c.id)).toEqual([card.id]); // cards without an image are left out, duplicates merged
  expect(fetchMock).toHaveBeenCalledTimes(5); // one to count the pages, four random pages
  await showcasePool();
  expect(fetchMock).toHaveBeenCalledTimes(5);
  fetchMock.mockRestore();
});
