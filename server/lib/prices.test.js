import { clearPriceCache, priceCards, storeSlug } from "./prices.js";

const BOLT = "435589bb-27c6-4a6d-9d63-394d5092b9d8";
const LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe";
const JORN = "0b9b64b5-5a7d-4b5c-9e2b-2f6b7d2f3c11";
const SCRYFALL = {
  [BOLT]: { id: BOLT, name: "Lightning Bolt", set_name: "Magic 2010", collector_number: "146", prices: { usd: "1.88", usd_foil: "7.48" } },
  [LOTUS]: { id: LOTUS, name: "Black Lotus", set_name: "Limited Edition Alpha", collector_number: "232", prices: {} },
  [JORN]: { id: JORN, name: "Jorn, God of Winter // Kaldring, the Rimestaff", set_name: "Kaldheim", collector_number: "317", prices: {} },
};
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const product = (handle, nm, pl) => ({ handle, variants: [{ title: "NM", price: nm }, { title: "PL", price: pl }] });

// Fake answers from the Bank of Canada, Scryfall and Face to Face Games, by address. `storeDown` makes the store fail.
function fakeInternet({ storeDown = false } = {}) {
  return jest.spyOn(global, "fetch").mockImplementation(async (url, init) => {
    url = String(url);
    if (storeDown && url.includes("facetofacegames")) return json({}, 503);
    if (url.includes("bankofcanada.ca")) return json({ observations: [{ d: "2026-10-21", FXUSDCAD: { v: "1.4057" } }] });
    if (url.endsWith("/cards/collection")) return json({ data: JSON.parse(init.body).identifiers.map(({ id }) => SCRYFALL[id]).filter(Boolean) });
    if (url.endsWith("/products/black-lotus-232-limited-edition-alpha-non-foil.js")) return json(product("black-lotus-232-limited-edition-alpha-non-foil", 20524999, 15000000));
    if (url.endsWith("/products/lightning-bolt-146-magic-2010-foil.js")) return json(product("lightning-bolt-146-magic-2010-foil", 1999, 1499));
    // Jorn's showcase printing has "showcase" in its page name, so only the store's search finds it.
    if (url.includes("/search/suggest.json"))
      return json({ resources: { results: { products: [{ handle: "jorn-god-of-winter-kaldring-the-rimestaff-317-showcase-kaldheim-non-foil" }, { handle: "jorn-god-of-winter-kaldring-the-rimestaff-317-showcase-kaldheim-foil" }] } } });
    if (url.endsWith("/products/jorn-god-of-winter-kaldring-the-rimestaff-317-showcase-kaldheim-non-foil.js")) return json(product("jorn-god-of-winter-kaldring-the-rimestaff-317-showcase-kaldheim-non-foil", 39, 29));
    return json({}, 404);
  });
}

beforeEach(() => clearPriceCache());
afterEach(() => jest.restoreAllMocks());

test("store page names follow the card's name", () => {
  expect(storeSlug("Jorn, God of Winter // Kaldring, the Rimestaff")).toBe("jorn-god-of-winter-kaldring-the-rimestaff");
  expect(storeSlug("Urza's Saga")).toBe("urzas-saga");
  expect(storeSlug("Lim-Dûl's Vault")).toBe("lim-duls-vault");
});

test("the market price is converted to CAD; the store's near-mint price fills in when there's none", async () => {
  const fetch = fakeInternet();
  const { rate, prices } = await priceCards([
    { printingId: BOLT, finish: "nonfoil" },
    { printingId: LOTUS, finish: "nonfoil" },
    { printingId: JORN, finish: "nonfoil" },
  ]);
  expect(rate).toEqual({ usdCad: 1.4057, date: "2026-10-21" });
  expect(prices[`${BOLT}:nonfoil`]).toEqual({ cad: 2.64, source: "market", marketUsd: 1.88, marketCad: 2.64, store: null }); // 1.88 x 1.4057
  expect(prices[`${LOTUS}:nonfoil`]).toMatchObject({ cad: 205249.99, source: "store", marketCad: null, store: { condition: "NM" } });
  expect(prices[`${JORN}:nonfoil`].store).toEqual({ cad: 0.39, condition: "NM", url: "https://facetofacegames.com/products/jorn-god-of-winter-kaldring-the-rimestaff-317-showcase-kaldheim-non-foil" });
  // The store wasn't asked about the Bolt, which has a market price.
  expect(fetch.mock.calls.some(([url]) => String(url).includes("lightning-bolt"))).toBe(false);

  // Asked again within the day: answered from memory, no new requests.
  const before = fetch.mock.calls.length;
  await priceCards([{ printingId: BOLT, finish: "nonfoil" }]);
  expect(fetch.mock.calls.length).toBe(before);
});

test("the card close-up asks the store too; a card the store doesn't sell has no store price", async () => {
  fakeInternet();
  const { prices } = await priceCards([{ printingId: BOLT, finish: "foil" }, { printingId: BOLT, finish: "etched" }], { store: true });
  expect(prices[`${BOLT}:foil`]).toMatchObject({ cad: 10.51, source: "market", store: { cad: 19.99, condition: "NM" } });
  expect(prices[`${BOLT}:etched`]).toEqual({ cad: null, source: null, marketUsd: null, marketCad: null, store: null });
});

test("a store outage only removes the store price; the market price still shows", async () => {
  fakeInternet({ storeDown: true });
  const { prices } = await priceCards([{ printingId: BOLT, finish: "foil" }, { printingId: LOTUS, finish: "nonfoil" }], { store: true });
  expect(prices[`${BOLT}:foil`]).toMatchObject({ cad: 10.51, source: "market", store: null });
  expect(prices[`${LOTUS}:nonfoil`]).toMatchObject({ cad: null, source: null });
});

test("without any exchange rate, prices fail rather than guessing", async () => {
  jest.spyOn(global, "fetch").mockResolvedValue(json({}, 500));
  await expect(priceCards([{ printingId: BOLT, finish: "nonfoil" }])).rejects.toThrow("Bank of Canada");
});
