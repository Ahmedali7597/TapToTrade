import { commanderSlug, commanderSuggestions, edhrecSlug } from "./edhrec.js";

test("names EDHREC pages the way the site does", () => {
  expect(edhrecSlug("Atraxa, Praetors' Voice")).toBe("atraxa-praetors-voice");
  expect(edhrecSlug("Krenko, Mob Boss")).toBe("krenko-mob-boss");
  expect(edhrecSlug("Lim-Dûl the Necromancer")).toBe("lim-dul-the-necromancer");
  expect(edhrecSlug("Esika, God of the Tree // The Prismatic Bridge")).toBe("esika-god-of-the-tree");
  expect(commanderSlug(["Tymna the Weaver", "Kraum, Ludevic's Opus"])).toBe("kraum-ludevics-opus-tymna-the-weaver");
});

test("reads EDHREC's lists, and treats a missing page as no suggestions", async () => {
  const page = { container: { json_dict: { cardlists: [{ tag: "topcards", header: "Top Cards", cardviews: [{ name: "Sol Ring", synergy: 0.01, num_decks: 90, potential_decks: 100 }] }, { tag: "empty", header: "Empty", cardviews: [] }] } } };
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => page }).mockResolvedValueOnce({ ok: false, status: 403 });
  expect(await commanderSuggestions(["Krenko, Mob Boss"])).toEqual({
    slug: "krenko-mob-boss",
    url: "https://edhrec.com/commanders/krenko-mob-boss",
    lists: [{ tag: "topcards", header: "Top Cards", cards: [{ name: "Sol Ring", synergy: 0.01, inclusion: 0.9 }] }],
  });
  expect(await commanderSuggestions(["Krenko, Mob Boss"])).not.toBeNull(); // cached, no second request
  expect(await commanderSuggestions(["Nobody Real"])).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
