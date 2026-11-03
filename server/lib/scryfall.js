import { DECK_FORMATS } from "../../shared/decks.js";
import { FINISHES } from "../../shared/validation.js";
import { matchesIdentifier } from "./collectionImport.js";

// Scryfall card lookups for choosing a printing. Scryfall asks for a descriptive User-Agent, an Accept header and
// at most 10 requests a second, or 2 a second for searches and bulk lookups; results are cached in memory.
const TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new Map();
let lastCall = 0;
let lastSlow = 0;
const API = "https://api.scryfall.com";
const HEADERS = { "User-Agent": "TapToTrade/1.0 (student capstone)", Accept: "application/json" };

// Trims a Scryfall card down to the fields we store. Double-faced cards keep their images on
// card_faces instead of the top level, so fall back to the front face.
export function toPrinting(card) {
  const images = card.image_uris ?? card.card_faces?.[0]?.image_uris;
  // Keep only the finishes we support (Scryfall has a few rare extras like "glossy").
  const finishes = (card.finishes ?? []).filter((x) => FINISHES.includes(x));
  return {
    id: card.id,
    name: card.name,
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    imageUrl: images?.normal ?? null,
    finishes: finishes.length ? finishes : ["nonfoil"],
    // For grouping a collection. Double-faced cards keep their colours on the faces.
    typeLine: card.type_line ?? card.card_faces?.[0]?.type_line ?? "",
    colors: card.colors ?? card.card_faces?.[0]?.colors ?? [],
    rarity: card.rarity ?? null,
    // For decks: mana value and cost (front face for double-faced cards), colour identity and format legality.
    manaValue: card.cmc ?? 0,
    manaCost: card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? "",
    colorIdentity: card.color_identity ?? [],
    legalities: card.legalities ? Object.fromEntries(DECK_FORMATS.map((f) => [f, card.legalities[f] ?? "not_legal"])) : null,
  };
}

/** Scryfall's full-text match returns "Solemn Offering" for "sol ring"; put exact, then prefix matches first. */
export function rankByName(printings, q) {
  const needle = q.trim().toLowerCase();
  const rank = (p) => {
    const name = p.name.toLowerCase();
    return name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : 3;
  };
  return printings.map((p, i) => [rank(p), i, p]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , p]) => p);
}

// Scryfall's limits: 100 ms between requests, and 500 ms between /cards/search, /cards/named, /cards/random and
// /cards/collection requests (a 429 locks the app out for 30 seconds). No waiting in the tests, which fake Scryfall.
// Note: per-process throttle; share it (e.g. via the DB) if the app ever runs several instances.
const GAP = process.env.NODE_ENV === "test" ? 0 : 100;
const SLOW_GAP = process.env.NODE_ENV === "test" ? 0 : 600; // 500 ms plus a margin, so network jitter never squeezes two together
async function throttle(slow = false) {
  const at = Math.max(Date.now(), lastCall + GAP, slow ? lastSlow + SLOW_GAP : 0);
  const wait = at - Date.now();
  lastCall = at; // reserve the slot before waiting, so parallel calls queue up
  if (slow) lastSlow = at;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Card name search. `unique: "prints"` (the add-card form) lists every printing; `"cards"` (the public card
 * browser) lists each card once, in its newest printing.
 */
export async function searchPrintings(q, { unique = "prints" } = {}) {
  // Serve repeat searches from the cache so typing the same name twice doesn't hit Scryfall again.
  const key = `${unique}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  await throttle(true);

  const url = `${API}/cards/search?unique=${unique}&order=name&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
  // Scryfall answers 404 when nothing matches, which for us is just an empty list.
  let data;
  if (res.status === 404) data = [];
  else if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
  else data = rankByName((await res.json()).data.map(toPrinting), q).slice(0, 40);

  // Crude size cap: Maps keep insertion order, so the first key is the oldest entry.
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

/**
 * Card names that match what the player has typed so far, for the suggestions under card-name boxes. Scryfall's
 * autocomplete returns up to 20 names, best matches first. Card names rarely change, so answers are kept a day.
 */
export async function autocompleteNames(q) {
  const key = `names:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.data;

  await throttle();
  const res = await fetch(`${API}/cards/autocomplete?q=${encodeURIComponent(q)}`, { headers: HEADERS, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
  const data = (await res.json()).data;

  cache.set(key, { at: Date.now(), data });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return data;
}

/**
 * Raw Scryfall cards for a search, following up to `pages` pages of 175 (the deck optimizer reads oracle text and
 * prices). A search with no matches is an empty list.
 */
export async function searchCards(q, { pages = 1 } = {}) {
  const out = [];
  let url = `${API}/cards/search?q=${encodeURIComponent(q)}`;
  for (let page = 0; url && page < pages; page++) {
    await throttle(true);
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Scryfall responded ${res.status}: ${(await res.json().catch(() => ({}))).details ?? ""}`);
    const json = await res.json();
    out.push(...json.data);
    url = json.has_more ? json.next_page : null;
  }
  return out;
}

// Scryfall's bulk lookup accepts at most 75 identifiers per request.
const COLLECTION_BATCH = 75;

/**
 * Fills in setCode for rows that name their set instead ("Magic 2010" -> "m10"), from Scryfall's list of sets,
 * kept for a day. Names compare ignoring case and punctuation. Rows whose set name isn't found are left as they are.
 */
export async function fillSetCodes(rows) {
  const wanting = rows.filter((r) => !r.setCode && r.setName);
  if (!wanting.length) return;
  const norm = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, "");
  let hit = cache.get("sets");
  if (!hit || Date.now() - hit.at > DAY_MS) {
    await throttle();
    const res = await fetch(`${API}/sets`, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
    hit = { at: Date.now(), data: new Map((await res.json()).data.map((s) => [norm(s.name), s.code])) };
    cache.set("sets", hit);
  }
  for (const r of wanting) r.setCode = hit.data.get(norm(r.setName)) ?? null;
}

/**
 * Looks up many cards at once (collection import, prices). `entries` is [[key, identifier], ...] from
 * collectionImport.identifierFor; returns Map(key -> map(card)) for every identifier Scryfall found (a printing by default).
 */
export async function lookupCollection(entries, map = toPrinting) {
  const found = new Map();
  for (let i = 0; i < entries.length; i += COLLECTION_BATCH) {
    const batch = entries.slice(i, i + COLLECTION_BATCH);
    await throttle(true);
    const res = await fetch(`${API}/cards/collection`, {
      method: "POST",
      headers: { ...HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ identifiers: batch.map(([, ident]) => ident) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
    const { data = [] } = await res.json();
    // Match by content rather than position, so a missing card can't shift the others.
    for (const [key, ident] of batch) {
      const card = data.find((c) => matchesIdentifier(c, ident));
      if (card) found.set(key, map(card));
    }
  }
  return found;
}

// ---- Card details (the zoomed-in card view) ----

const details = new Map();

/** The parts of a Scryfall card the details view shows. Double-faced and split cards keep one entry per face. */
export function toDetails(card, rulings = []) {
  const faces = card.card_faces ?? [card];
  const images = card.image_uris ?? card.card_faces?.[0]?.image_uris;
  return {
    id: card.id,
    name: card.name,
    setCode: card.set,
    setName: card.set_name,
    collectorNumber: card.collector_number,
    finishes: toPrinting(card).finishes,
    rarity: card.rarity,
    artist: card.artist ?? null,
    imageUrl: images?.large ?? images?.normal ?? null,
    // Each face falls back to the card itself, so single-faced cards and split cards read the same way.
    faces: faces.map((f) => ({
      name: f.name,
      manaCost: f.mana_cost ?? card.mana_cost ?? "",
      typeLine: f.type_line ?? card.type_line ?? "",
      oracleText: f.oracle_text ?? card.oracle_text ?? "",
      flavorText: f.flavor_text ?? null,
      stats: f.power != null ? `${f.power} / ${f.toughness}` : f.loyalty != null ? `Loyalty ${f.loyalty}` : f.defense != null ? `Defense ${f.defense}` : null,
      imageUrl: f.image_uris?.large ?? null,
    })),
    legalities: card.legalities ?? {},
    prices: { usd: card.prices?.usd ?? null, usdFoil: card.prices?.usd_foil ?? null, eur: card.prices?.eur ?? null },
    scryfallUrl: card.scryfall_uri,
    rulings: rulings.map((r) => ({ date: r.published_at, text: r.comment })),
  };
}

/** One card's details and rulings, cached for a day as Scryfall asks. Resolves to null for an unknown id. */
export async function cardDetails(id) {
  const hit = details.get(id);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.data;
  await throttle();
  const res = await fetch(`${API}/cards/${id}`, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
  const card = await res.json();
  // Rulings are a nice extra: if they fail, show the card without them.
  let rulings = [];
  try {
    await throttle();
    const r = await fetch(`${API}/cards/${id}/rulings`, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
    if (r.ok) rulings = (await r.json()).data ?? [];
  } catch {
    // keep the empty list
  }
  const data = toDetails(card, rulings);
  details.set(id, { at: Date.now(), data });
  if (details.size > 500) details.delete(details.keys().next().value);
  return data;
}

// ---- Random showcase cards (home page and sign-in pages) ----

// Scryfall has no random sort for searches, so once a day we read a few random pages of a broad search, each in a
// different order, and every page view samples from that pool. About 5 requests a day.
const SHOWCASE_QUERY = "game:paper legal:vintage -t:basic";
const SHOWCASE_ORDERS = ["name", "released", "artist", "edhrec", "set", "color", "cmc"];
const PAGE_SIZE = 175;
let pool = { at: 0, cards: [] };
let refreshing = null;

async function searchPage(order, page) {
  await throttle(true);
  const url = `${API}/cards/search?unique=art&order=${order}&page=${page}&q=${encodeURIComponent(SHOWCASE_QUERY)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
  return res.json();
}

async function refreshPool(random = Math.random) {
  const pick = (n) => 1 + Math.floor(random() * n);
  const first = await searchPage("name", 1);
  const pages = Math.max(1, Math.ceil(first.total_cards / PAGE_SIZE));
  const lists = [];
  for (let i = 0; i < 4; i++) lists.push((await searchPage(SHOWCASE_ORDERS[pick(SHOWCASE_ORDERS.length) - 1], pick(pages))).data ?? []);
  const cards = lists.flat().map(toPrinting).filter((p) => p.imageUrl);
  pool = { at: Date.now(), cards: [...new Map(cards.map((c) => [c.id, c])).values()] };
  return pool.cards;
}

/** Today's pool of random cards (refreshed at most once a day; concurrent callers share one refresh). */
export async function showcasePool() {
  if (pool.cards.length && Date.now() - pool.at < DAY_MS) return pool.cards;
  refreshing ??= refreshPool().finally(() => (refreshing = null));
  return refreshing;
}

/** `count` distinct items picked at random (partial Fisher-Yates shuffle). */
export function sample(items, count, random = Math.random) {
  const a = [...items];
  const n = Math.min(count, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
