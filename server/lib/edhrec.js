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
 * { slug, url, lists: [{ tag, header, cards: [{ name, synergy, inclusion }] }] } for a commander page, or null
 * if EDHREC has no page for it. `synergy` and `inclusion` are fractions (0.72 = 72%). Throws if EDHREC is down.
 */
export async function commanderSuggestions(names) {
  const slug = commanderSlug(names);
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
