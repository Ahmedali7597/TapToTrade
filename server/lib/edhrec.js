// Card suggestions for a Commander deck from EDHREC (edhrec.com), which ranks the cards players run with each
// commander. We read the same public JSON their commander pages use, keep it for a day, and always link back.
const DAY = 24 * 60 * 60 * 1000;
const cache = new Map();

/** EDHREC's page name for a card: "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice". Front face only. */
export function edhrecSlug(name) {
  return String(name)
    .split(" // ")[0]
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['",.!?:]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The slug for one or two commanders (partners share a page, named in alphabetical order). */
export const commanderSlug = (names) => names.map(edhrecSlug).sort().join("-");

/**
 * { slug, url, themes: [names], lists: [{ tag, header, cards: [{ name, synergy, inclusion }] }] } for a commander page, or null
 * if EDHREC has no page for it. `synergy` and `inclusion` are fractions (0.72 = 72%). Throws if EDHREC is down.
 * `variant` picks one of the page's filtered versions, e.g. "cedh" for competitive decks only.
 */
export async function commanderSuggestions(names, variant = "") {
  const slug = commanderSlug(names) + (variant ? `/${variant}` : "");
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  const res = await fetch(`https://json.edhrec.com/pages/commanders/${slug}.json`, {
    headers: { "User-Agent": "TapToTrade/1.0 (student capstone)", Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  let value = null;
  if (res.ok) {
    const json = await res.json();
    const lists = json.container?.json_dict?.cardlists ?? [];
    value = {
      slug,
      url: `https://edhrec.com/commanders/${slug}`,
      // The page's most common deck themes ("Reanimator", "Sacrifice"...), most decks first.
      themes: (json.panels?.taglinks ?? []).map((t) => String(t.value)).filter(Boolean),
      lists: lists
        .map((l) => ({
          tag: String(l.tag),
          header: String(l.header),
          cards: (l.cardviews ?? []).slice(0, 40).map((c) => ({
            name: String(c.name),
            synergy: typeof c.synergy === "number" ? c.synergy : null,
            inclusion: c.potential_decks ? c.num_decks / c.potential_decks : null,
          })),
        }))
        .filter((l) => l.cards.length),
    };
  } else if (res.status !== 404 && res.status !== 403) {
    throw new Error(`EDHREC responded ${res.status}`);
  }
  cache.set(slug, { at: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
}

const recsCache = new Map();

/**
 * EDHREC's suggestions for one decklist (its Recs page, edhrec.com/recs): { adds, cuts }, each a Map from a card's
 * front name to a 0-1 score (EDHREC's 0-100 / 100). EDHREC rates every card in the list for cutting and its top 100
 * cards for adding, from the decks it has seen with the commander. null if EDHREC doesn't answer: the optimizer then
 * goes on without it. Kept for a day per list.
 */
export async function deckRecs(commanders, cards) {
  const key = `${[...commanders].sort().join("|")}\n${[...new Set(cards)].sort().join("\n")}`;
  const hit = recsCache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  let value = null;
  try {
    const res = await fetch("https://edhrec.com/api/recs", {
      method: "POST",
      headers: { "User-Agent": "TapToTrade/1.0 (student capstone)", Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ cards: [...new Set(cards)], commanders, options: { excludeLands: false, offset: 0 } }),
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const json = await res.json();
      const scores = (list) => new Map((list ?? []).map((c) => [String(c.name).split(" // ")[0], Math.max(0, Math.min(100, Number(c.score) || 0)) / 100]));
      if (json.inRecs || json.outRecs) value = { adds: scores(json.inRecs), cuts: scores(json.outRecs) };
    }
  } catch {
    // EDHREC down or slow: the optimizer works without it.
  }
  recsCache.set(key, { at: Date.now(), value });
  if (recsCache.size > 300) recsCache.delete(recsCache.keys().next().value);
  return value;
}
