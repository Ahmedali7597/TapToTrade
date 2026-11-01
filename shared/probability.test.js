import { hash, hyperAtLeast, hyperBetween, hyperPmf, logChoose, margin, rng, seenBy, shuffle, simulate } from "./probability.js";

// 1 - C(N-K, n) / C(N, n), multiplied out term by term.
const missAll = (N, K, n) => {
  let p = 1;
  for (let i = 0; i < n; i++) p *= (N - K - i) / (N - i);
  return 1 - p;
};

test("binomial coefficients", () => {
  expect(Math.exp(logChoose(5, 2))).toBeCloseTo(10, 9);
  expect(Math.exp(logChoose(99, 7))).toBeCloseTo(14887031544, -3);
  expect(logChoose(3, 4)).toBe(-Infinity);
  expect(logChoose(3, -1)).toBe(-Infinity);
});

test("hypergeometric odds match the formula", () => {
  // 10 fast mana in the 99, opening seven.
  expect(hyperAtLeast(99, 10, 7)).toBeCloseTo(missAll(99, 10, 7), 12);
  expect(hyperAtLeast(99, 10, 7)).toBeCloseTo(0.5372, 4);
  // The pmf sums to one, and "at least 0" is certain.
  let sum = 0;
  for (let k = 0; k <= 7; k++) sum += hyperPmf(99, 30, 7, k);
  expect(sum).toBeCloseTo(1, 12);
  expect(hyperAtLeast(99, 30, 7, 0)).toBe(1);
  expect(hyperAtLeast(99, 0, 7)).toBe(0);
  // Two to four lands from 30.
  expect(hyperBetween(99, 30, 7, 2, 4)).toBeCloseTo(hyperPmf(99, 30, 7, 2) + hyperPmf(99, 30, 7, 3) + hyperPmf(99, 30, 7, 4), 12);
  expect(hyperBetween(99, 30, 7, 0, 7)).toBeCloseTo(1, 12);
  expect(seenBy(1)).toBe(8);
});

test("seeded randomness repeats, and shuffling keeps every card", () => {
  const a = rng(42);
  const b = rng(42);
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  expect(hash("Rograkh")).toBe(hash("Rograkh"));
  expect(hash("Rograkh")).not.toBe(hash("Kinnan"));
  const deck = Array.from({ length: 20 }, (_, i) => i);
  expect(shuffle(deck, rng(1)).sort((x, y) => x - y)).toEqual(deck);
  expect(margin(0.5, 10000)).toBeCloseTo(0.0098, 4);
});

const card = (name, extra = {}) => ({ name, land: false, mana: 0, tutor: null, cost: 0, ...extra });

test("simulation finds a two-card combo sooner with tutors and fast mana", () => {
  const lands = Array.from({ length: 30 }, (_, i) => card(`Land ${i}`, { land: true }));
  const filler = (n) => Array.from({ length: n }, (_, i) => card(`Filler ${i}`));
  const line = { pieces: ["Piece A", "Piece B"], mana: 4 };
  const plain = [...lands, card("Piece A"), card("Piece B"), ...filler(67)];
  const tuned = [
    ...lands,
    card("Piece A"),
    card("Piece B"),
    ...Array.from({ length: 16 }, (_, i) => card(`Tutor ${i}`, { tutor: { finds: () => true }, cost: 1 })),
    ...Array.from({ length: 8 }, (_, i) => card(`Rock ${i}`, { mana: 1 })),
    ...filler(43),
  ];
  const slow = simulate({ library: plain, lines: [line], trials: 1500, seed: 7 });
  const fast = simulate({ library: tuned, lines: [line], trials: 1500, seed: 7 });
  expect(fast.byTurn[5]).toBeGreaterThan(slow.byTurn[5]);
  expect(fast.median).toBeLessThan(slow.median);
  // Cumulative odds never go down from one turn to the next.
  for (let i = 1; i < fast.byTurn.length; i++) expect(fast.byTurn[i]).toBeGreaterThanOrEqual(fast.byTurn[i - 1]);
  expect(slow.keep7).toBeGreaterThan(0.5);
  // Same seed, same answer.
  expect(simulate({ library: tuned, lines: [line], trials: 300, seed: 3 })).toEqual(simulate({ library: tuned, lines: [line], trials: 300, seed: 3 }));
});

test("the commander is always available, and a line nothing can reach never fires", () => {
  const lands = Array.from({ length: 40 }, (_, i) => card(`Land ${i}`, { land: true }));
  const rest = Array.from({ length: 59 }, (_, i) => card(`Filler ${i}`));
  const withCommander = simulate({ library: [...lands, ...rest], lines: [{ pieces: ["Commander"], mana: 1 }], free: ["Commander"], trials: 200 });
  expect(withCommander.byTurn[0]).toBeGreaterThan(0.9);
  const never = simulate({ library: [...lands, ...rest], lines: [{ pieces: ["Missing"], mana: 0 }], trials: 200, maxTurn: 5 });
  expect(never.byTurn).toEqual([0, 0, 0, 0, 0]);
  expect(never.median).toBe(6);
});
