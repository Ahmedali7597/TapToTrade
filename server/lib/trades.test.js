import { canTransition, lineShapeError, MAX_LINES, stockErrors } from "./trades.js";

const TRADE_STATUSES = ["pending", "accepted", "declined", "countered"];

describe("trade status transitions (4.5.4, 4.5.5)", () => {
  test("UT-06 pending → accepted is allowed", () => {
    expect(canTransition("pending", "accepted")).toBe(true);
  });

  test("UT-07 accepted → declined is rejected", () => {
    expect(canTransition("accepted", "declined")).toBe(false);
  });

  test("pending can be declined or countered; final states never change", () => {
    expect(canTransition("pending", "declined")).toBe(true);
    expect(canTransition("pending", "countered")).toBe(true);
    for (const from of ["accepted", "declined", "countered"]) {
      for (const to of TRADE_STATUSES) expect(canTransition(from, to)).toBe(false);
    }
    expect(canTransition("pending", "pending")).toBe(false);
    expect(canTransition("bogus", "accepted")).toBe(false);
  });
});

describe("offer quantity validation (4.5.7)", () => {
  const items = new Map([
    [1, { owner_id: 7, quantity: 3, available: true, card_name: "Lightning Bolt" }],
    [2, { owner_id: 7, quantity: 5, available: false, card_name: "Sol Ring" }],
    [3, { owner_id: 9, quantity: 5, available: true, card_name: "Counterspell" }],
  ]);

  test("UT-09 rejects offering 10 when the sender owns 3", () => {
    expect(stockErrors([{ inventoryItemId: 1, quantity: 10 }], items, 7)).toEqual([
      "Only 3 × Lightning Bolt available (you chose 10).",
    ]);
  });

  test("UT-10 accepts offering 2 when the sender owns 5", () => {
    expect(stockErrors([{ inventoryItemId: 2, quantity: 2 }], items, 7)).toEqual([]);
  });

  test("rejects items owned by someone else or missing", () => {
    expect(stockErrors([{ inventoryItemId: 3, quantity: 1 }], items, 7)).toHaveLength(1);
    expect(stockErrors([{ inventoryItemId: 99, quantity: 1 }], items, 7)).toHaveLength(1);
  });

  test("requested cards must also be shared by their owner", () => {
    expect(stockErrors([{ inventoryItemId: 2, quantity: 1 }], items, 7, { requireAvailable: true })).toHaveLength(1);
  });
});

describe("proposal shape (4.5.1–4.5.3)", () => {
  const line = (id, quantity = 1) => ({ inventoryItemId: id, quantity });

  test("needs at least one requested card; offers are optional", () => {
    expect(lineShapeError([], [])).toMatch(/at least one card/);
    expect(lineShapeError(undefined)).toMatch(/at least one card/);
    expect(lineShapeError([line(1)], [])).toBeNull();
    expect(lineShapeError([line(1)], undefined)).toBeNull();
    expect(lineShapeError([line(1)], [line(2, 4)])).toBeNull();
  });

  test("rejects bad ids, bad quantities, duplicates and oversize proposals", () => {
    expect(lineShapeError([line(0)])).toMatch(/valid listing/);
    expect(lineShapeError([line(1, 0)])).toMatch(/positive whole/);
    expect(lineShapeError([line(1, 1.5)])).toMatch(/positive whole/);
    expect(lineShapeError([line(1)], [line(1)])).toMatch(/only once/);
    expect(lineShapeError([line(1)], "nope")).toMatch(/must be a list/);
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => line(i + 1));
    expect(lineShapeError(many)).toMatch(/at most/);
  });
});
