import { lookupCollection } from "./scryfall.js";

// Card prices in Canadian dollars, shown for reference while trading (Tap to Trade never handles money).
// - Market price: TCGplayer's market price, the same figure MTGStocks shows, from Scryfall (which allows this use),
//   converted to CAD with the Bank of Canada's daily exchange rate.
// - Fallback: Face to Face Games' near-mint price for that exact printing and finish, already in CAD. Used when
//   there's no market price, and shown next to it in the card close-up.
// MTGStocks itself has no public API and blocks requests from servers, so it isn't asked directly.
//
// ponytail: answers are cached in this process (a day per card, six hours for the rate) and start empty after a
// deploy; move the cache to a database table if the site ever runs on more than one server.

const UA = "TapToTrade/1.0 (+https://taptotrade.ca; support@taptotrade.ca)";
const DAY = 86_400_000;
const F2F = "https://facetofacegames.com";

/** Rounds to cents. */
const cents = (n) => Math.round(n * 100) / 100;

// ---- US dollars to Canadian dollars (Bank of Canada Valet API, open data) ----

let rate = null; // { usdCad, date, at }

/** Today's Bank of Canada USD/CAD rate, e.g. { usdCad: 1.4057, date: "2026-10-21" }. Keeps the last good rate if the bank is down. */
export async function usdToCad() {
  if (rate && Date.now() - rate.at < 6 * 3_600_000) return rate;
  try {
    const res = await fetch("https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?recent=1", {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Bank of Canada responded ${res.status}`);
    const latest = (await res.json()).observations?.[0];
    const usdCad = Number(latest?.FXUSDCAD?.v);
    if (!(usdCad > 0)) throw new Error("Bank of Canada sent no rate");
    rate = { usdCad, date: latest.d, at: Date.now() };
  } catch (err) {
    if (!rate) throw err;
  }
  return rate;
}

// ---- Face to Face Games (a Shopify store: public product pages, prices in CAD) ----

/** "Jorn, God of Winter // Kaldring" -> "jorn-god-of-winter-kaldring", the way the store names its product pages. */
export const storeSlug = (s) =>
  String(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// One request a second at most, so the store is never hammered (no waiting in the tests, which fake the store).
const STORE_GAP_MS = process.env.NODE_ENV === "test" ? 0 : 1000;
let nextStoreCall = 0;
async function storeJson(path) {
  const wait = nextStoreCall - Date.now();
  nextStoreCall = Math.max(Date.now(), nextStoreCall) + STORE_GAP_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const res = await fetch(`${F2F}${path}`, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(6000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Face to Face Games responded ${res.status}`);
  return res.json();
}

/**
 * Face to Face Games' near-mint price for one printing ({ name, setName, collectorNumber }) in one finish:
 * { cad, condition, url }, or null if they don't list it. Their product pages are named
 * "name-number-[style-]set-finish" (style is e.g. "showcase"), so the usual name is tried first and their search
 * is the fallback, accepting only an exact match on name, number, set and finish.
 */
export async function storePrice({ name, setName, collectorNumber }, finish) {
  const tail = { nonfoil: "non-foil", foil: "foil", etched: "etched-foil" }[finish];
  if (!tail) return null;
  const start = `${storeSlug(name)}-${storeSlug(collectorNumber)}-`;
  const end = `-${storeSlug(setName)}-${tail}`;
  let product = await storeJson(`/products/${start}${end.slice(1)}.js`);
  if (!product) {
    const q = new URLSearchParams({ q: `${name} ${setName}`, "resources[type]": "product", "resources[limit]": "10" });
    const found = (await storeJson(`/search/suggest.json?${q}`))?.resources?.results?.products ?? [];
    const match = found.find((p) => p.handle.startsWith(start) && p.handle.endsWith(end));
    if (match) product = await storeJson(`/products/${match.handle}.js`);
  }
  if (!product?.variants?.length) return null;
  const nm = product.variants.find((v) => /^(NM|near mint)/i.test(v.title)) ?? product.variants[0];
  return { cad: cents(nm.price / 100), condition: nm.title, url: `${F2F}/products/${product.handle}` };
}

// ---- Putting it together ----

const cache = new Map(); // "printingId:finish" -> { value, at }
const MAX_CACHE = 5000;
const remember = (key, value) => {
  cache.set(key, { value, at: Date.now() });
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); // the oldest entry
};

/**
 * Prices for `cards` ([{ printingId, finish }]), keyed "printingId:finish". Each is
 * { cad, source: "market" | "store", marketUsd, marketCad, store: { cad, condition, url } | null }, with cad null
 * when neither source has one. `store: true` (the card close-up) also asks Face to Face when there's a market price.
 */
export async function priceCards(cards, { store = false } = {}) {
  const { usdCad, date } = await usdToCad();
  const keys = [...new Set(cards.map((c) => `${c.printingId}:${c.finish}`))];
  const fresh = (key) => {
    const hit = cache.get(key);
    return hit && Date.now() - hit.at < DAY && (!store || hit.value.storeChecked) ? hit.value : null;
  };
  const missing = keys.filter((k) => !fresh(k));
  if (missing.length) {
    // One Scryfall request per 75 printings: market prices plus the details Face to Face's search needs.
    const ids = [...new Set(missing.map((k) => k.split(":")[0]))];
    const found = await lookupCollection(ids.map((id) => [id, { id }]), (card) => ({
      name: card.name,
      setName: card.set_name,
      collectorNumber: card.collector_number,
      usd: { nonfoil: card.prices?.usd, foil: card.prices?.usd_foil, etched: card.prices?.usd_etched },
    }));
    for (const key of missing) {
      const [id, finish] = key.split(":");
      const card = found.get(id);
      const marketUsd = card?.usd[finish] ? Number(card.usd[finish]) : null;
      // The store is asked when it's the only source, or when the close-up wants both. A failure there just means no store price.
      const askStore = card && (store || marketUsd == null);
      const storeHit = askStore ? await storePrice(card, finish).catch(() => null) : null;
      remember(key, { marketUsd, store: storeHit, storeChecked: Boolean(askStore) });
    }
  }
  const prices = {};
  for (const key of keys) {
    const { marketUsd, store: s } = fresh(key) ?? cache.get(key).value;
    const marketCad = marketUsd == null ? null : cents(marketUsd * usdCad);
    prices[key] = { cad: marketCad ?? s?.cad ?? null, source: marketCad != null ? "market" : s ? "store" : null, marketUsd, marketCad, store: s };
  }
  return { rate: { usdCad, date }, prices };
}

/** For the tests: forget cached prices and the exchange rate. */
export const clearPriceCache = () => {
  cache.clear();
  rate = null;
  nextStoreCall = 0;
};
