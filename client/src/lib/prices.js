import { useEffect, useState } from "react";
import { api, qs } from "@/lib/api";

// Reference prices in CAD for cards (server/lib/prices.js has the sources): the TCGplayer market price converted
// at the Bank of Canada's rate, or Face to Face Games' near-mint price when there's no market price.

const keyOf = (c) => `${c.printingId}:${c.finish}`;

/**
 * Prices for `cards` ([{ printingId, finish }]): { rate, prices } once loaded, or null while loading or if prices
 * aren't available (they're extra information, so the page works the same without them). `store` adds Face to
 * Face Games' price next to the market price (the card close-up, a few cards at most).
 */
export function usePrices(cards, { store = false } = {}) {
  const keys = [...new Set(cards.filter((c) => c.printingId && c.finish).map(keyOf))].sort();
  const id = keys.join(",");
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!id) return setResult(null);
    let live = true;
    // The server takes up to 40 cards a request.
    const groups = [];
    const all = id.split(",");
    for (let i = 0; i < all.length; i += 40) groups.push(all.slice(i, i + 40).join(","));
    Promise.all(groups.map((cards) => api(`/cards/prices${qs({ cards, store: store ? "1" : "" })}`))).then(
      (answers) => live && setResult({ rate: answers[0].rate, prices: Object.assign({}, ...answers.map((a) => a.prices)) }),
      () => live && setResult(null),
    );
    return () => {
      live = false;
    };
  }, [id, store]);
  return result;
}

/** The price for one card from usePrices(), or null. */
export const priceOf = (result, card) => result?.prices[keyOf(card)] ?? null;

/** "CA$1,234.50". */
export const cad = (n) => `CA$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The total for [{ printingId, finish, quantity }], or null if any of them has no price (a partial total would mislead). */
export function totalOf(result, lines) {
  if (!result || !lines.length) return null;
  let sum = 0;
  for (const l of lines) {
    const p = priceOf(result, l)?.cad;
    if (p == null) return null;
    sum += p * l.quantity;
  }
  return Math.round(sum * 100) / 100;
}

/** Where a price came from, for a tooltip or small print. */
export const priceSource = (price, rate) =>
  price?.source === "store"
    ? "Face to Face Games near-mint price"
    : `TCGplayer market price via Scryfall, at the Bank of Canada rate of ${rate?.usdCad} USD/CAD (${rate?.date})`;
