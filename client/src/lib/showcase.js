import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

// Showcase cards for the home page and the sign-in pages. The server sends a fresh random set on every visit
// (GET /api/cards/showcase); this short list is only the fallback for when it can't (Scryfall CDN images).
const SHOWCASE_CARDS = [
  { name: "Aang, Airbending Master", imageUrl: "https://cards.scryfall.io/normal/front/d/e/de7a150b-1b0d-4928-a2cc-80a4b7412350.jpg?1783904837" },
  { name: "Baaallerina", imageUrl: "https://cards.scryfall.io/normal/front/d/b/db5b2911-5b22-4847-a570-c16ce719d9b4.jpg?1783920601" },
  { name: "Cabal Archon", imageUrl: "https://cards.scryfall.io/normal/front/4/b/4bdf6e2a-1bf5-4d63-a58b-883cfb1ea0fa.jpg?1783945073" },
  { name: "Dack Fayden", imageUrl: "https://cards.scryfall.io/normal/front/1/0/10158a5e-5a03-41ab-85d2-0907ccf32c9b.jpg?1783937555" },
  { name: "Eager Cadet", imageUrl: "https://cards.scryfall.io/normal/front/0/7/0732d372-1000-435e-905b-4a6c852ba427.jpg?1783944127" },
  { name: "Fa'adiyah Seer", imageUrl: "https://cards.scryfall.io/normal/front/9/6/966166ce-4bd4-4cfb-9b9b-b4f0dbe52502.jpg?1787679734" },
  { name: "Gabriel Angelfire", imageUrl: "https://cards.scryfall.io/normal/front/f/2/f2a26496-b4c9-4a29-9a85-26e217deafa2.jpg?1783947360" },
  { name: "Haakon, Stromgald Scourge", imageUrl: "https://cards.scryfall.io/normal/front/7/e/7e7d463b-e74e-4ebe-9f92-02ccdeadbf96.jpg?1783917159" },
  { name: "I Am Iron Man", imageUrl: "https://cards.scryfall.io/normal/front/9/c/9c401abb-5978-41c0-962b-0432f9433929.jpg?1783902957" },
  { name: "Jabari's Banner", imageUrl: "https://cards.scryfall.io/normal/front/3/d/3d51a496-1ca6-4286-bdbe-990d43196a25.jpg?1783946715" },
  { name: "K-9, Mark I", imageUrl: "https://cards.scryfall.io/normal/front/b/2/b2e46695-7bd3-448c-a5ea-6d544943ec5f.jpg?1783914668" },
  { name: "La'An Noonien-Singh, Security", imageUrl: "https://cards.scryfall.io/normal/front/a/f/afe08bef-b184-4b91-8d69-0101e183c3ff.jpg?1785981540" },
  { name: "Maalfeld Twins", imageUrl: "https://cards.scryfall.io/normal/front/c/1/c166df8f-9508-427a-8ec7-bc8541b6ed88.jpg?1783908958" },
  { name: "Naban, Dean of Iteration", imageUrl: "https://cards.scryfall.io/normal/front/8/8/88f41175-880f-491e-96c3-bf52f3c0db5d.jpg?1783935023" },
  { name: "O'aka, Traveling Merchant", imageUrl: "https://cards.scryfall.io/normal/front/9/d/9d860089-fb88-4736-b7f4-b605551bedc8.jpg?1783906362" },
  { name: "Pacesetter Paragon", imageUrl: "https://cards.scryfall.io/normal/front/7/3/7364b4dc-8cce-498d-a62e-eabc612b062a.jpg?1783907879" },
  { name: "Qala, Ajani's Pridemate", imageUrl: "https://cards.scryfall.io/normal/front/3/c/3cf1e9ab-343d-462c-a71e-e12b101aa0b4.jpg?1783908864" },
  { name: "Rabanastre, Royal City", imageUrl: "https://cards.scryfall.io/normal/front/c/4/c44c9bbe-f4c6-41cf-b3c3-b943f4011bc1.jpg?1783906547" },
  { name: "Saavik, Stoic Student", imageUrl: "https://cards.scryfall.io/normal/front/3/7/3783c530-a2da-4dc1-811a-0a9a412c8e78.jpg?1785981363" },
  { name: "T-45 Power Armor", imageUrl: "https://cards.scryfall.io/normal/front/5/0/5065ae25-c96e-489b-aea9-d077c2df513d.jpg?1783904271" },
  { name: "Uba Mask", imageUrl: "https://cards.scryfall.io/normal/front/f/a/fa3ecb4e-d08f-4fac-8842-c3e772b95bd5.jpg?1783944275" },
  { name: "Vaan, Street Thief", imageUrl: "https://cards.scryfall.io/normal/front/5/0/50e1ec29-9de3-4f1b-b818-057e030d475b.jpg?1783906593" },
  { name: "Wailing Ghoul", imageUrl: "https://cards.scryfall.io/normal/front/4/e/4e35a461-9a8e-4d08-b963-14c8b5237eec.jpg?1783930406" },
  { name: "Xenagos's Strike", imageUrl: "https://cards.scryfall.io/normal/front/6/b/6b5fef7d-b8bb-43e2-a36b-d4cc98c3ef13.jpg?1783939389" },
];

// Extra cards fetched beyond what's shown, ready to replace any image that won't load.
const SPARES = 8;

const shuffled = (list) =>
  list
    .map((card) => [Math.random(), card])
    .sort((a, b) => a[0] - b[0])
    .map(([, card]) => card);

/**
 * `count` random cards, different on every visit: { cards, swap }. `cards` is null while loading.
 * swap(i) replaces card i with a spare, for when its image can't be loaded.
 */
export function useShowcase(count) {
  const [deck, setDeck] = useState(null);
  useEffect(() => {
    let live = true;
    api(`/cards/showcase?count=${count + SPARES}`)
      .then((d) => d.cards, () => [])
      .then((cards) => {
        // Top up from the fallback list if the server sent too few (Scryfall down and an empty database).
        const names = new Set(cards.map((c) => c.name));
        if (live) setDeck([...cards, ...shuffled(SHOWCASE_CARDS).filter((c) => !names.has(c.name))]);
      });
    return () => {
      live = false;
    };
  }, [count]);
  const swap = useCallback(
    (i) =>
      setDeck((d) => {
        if (!d || d.length <= count) return d;
        const next = [...d];
        next[i] = next.splice(count, 1)[0];
        return next;
      }),
    [count],
  );
  return { cards: deck?.slice(0, count) ?? null, swap };
}
