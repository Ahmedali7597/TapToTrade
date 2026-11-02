import { commanderSlug, commanderSuggestions, deckRecs, edhrecSlug } from "./edhrec.js";

test("names EDHREC pages the way the site does", () => {
  expect(edhrecSlug("Atraxa, Praetors' Voice")).toBe("atraxa-praetors-voice");
  expect(edhrecSlug("Krenko, Mob Boss")).toBe("krenko-mob-boss");
  expect(edhrecSlug("Lim-Dûl the Necromancer")).toBe("lim-dul-the-necromancer");
  expect(edhrecSlug("Esika, God of the Tree // The Prismatic Bridge")).toBe("esika-god-of-the-tree");
  expect(commanderSlug(["Tymna the Weaver", "Kraum, Ludevic's Opus"])).toBe("kraum-ludevics-opus-tymna-the-weaver");
});

test("reads EDHREC's lists, and treats a missing page as no suggestions", async () => {
  const page = {
    panels: { taglinks: [{ count: 900, slug: "goblins", value: "Goblins" }, { count: 300, slug: "tokens", value: "Tokens" }] },
    container: { json_dict: { cardlists: [{ tag: "topcards", header: "Top Cards", cardviews: [{ name: "Sol Ring", synergy: 0.01, num_decks: 90, potential_decks: 100 }] }, { tag: "empty", header: "Empty", cardviews: [] }] } },
  };
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => page }).mockResolvedValueOnce({ ok: false, status: 403 });
  expect(await commanderSuggestions(["Krenko, Mob Boss"])).toEqual({
    slug: "krenko-mob-boss",
    url: "https://edhrec.com/commanders/krenko-mob-boss",
    themes: ["Goblins", "Tokens"],
    lists: [{ tag: "topcards", header: "Top Cards", cards: [{ name: "Sol Ring", synergy: 0.01, inclusion: 0.9 }] }],
  });
  expect(await commanderSuggestions(["Krenko, Mob Boss"])).not.toBeNull(); // cached, no second request
  expect(await commanderSuggestions(["Nobody Real"])).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("passes on an EDHREC server error so the page can say it isn't answering", async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 502 });
  await expect(commanderSuggestions(["Someone Else"])).rejects.toThrow("EDHREC responded 502");
});

test("asks EDHREC what to add and cut for a list, and goes on without it when it doesn't answer", async () => {
  const recs = { inRecs: [{ name: "Beast Within", score: 51 }], outRecs: [{ name: "Doom Blade", score: 88 }, { name: "Disciple of Freyalise // Garden of Freyalise", score: 26 }] };
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => recs }).mockResolvedValueOnce({ ok: false, status: 500 });
  expect(await deckRecs(["Venom"], ["Doom Blade", "Doom Blade", "Disciple of Freyalise"])).toEqual({
    adds: new Map([["Beast Within", 0.51]]),
    cuts: new Map([["Doom Blade", 0.88], ["Disciple of Freyalise", 0.26]]),
  });
  const [url, init] = global.fetch.mock.calls[0];
  expect(url).toBe("https://edhrec.com/api/recs");
  expect(JSON.parse(init.body)).toEqual({ cards: ["Doom Blade", "Disciple of Freyalise"], commanders: ["Venom"], options: { excludeLands: false, offset: 0 } });
  expect(await deckRecs(["Venom"], ["Disciple of Freyalise", "Doom Blade"])).not.toBeNull(); // same list: cached
  expect(await deckRecs(["Venom"], ["Murder"])).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
