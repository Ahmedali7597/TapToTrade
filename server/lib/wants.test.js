import { feedbackError, reputationView } from "./reputation.js";
import { groupMatches, readWantFields } from "./wants.js";

describe("want list fields", () => {
  test("defaults to one copy of any printing in any finish", () => {
    expect(readWantFields({})).toEqual({ values: { quantity: 1, finish: null, anyPrinting: true }, fields: {} });
    expect(readWantFields({ finish: "any" }).values.finish).toBeNull();
  });

  test("rejects bad quantities, finishes and printing modes", () => {
    const { fields } = readWantFields({ quantity: 0, finish: "gold", anyPrinting: "yes" });
    expect(Object.keys(fields).sort()).toEqual(["anyPrinting", "finish", "quantity"]);
  });

  test("partial updates only read the fields that were sent", () => {
    expect(readWantFields({ quantity: "3" }, true)).toEqual({ values: { quantity: 3 }, fields: {} });
  });
});

describe("matching nearby players", () => {
  const have = (player, want, city = "Hamilton, ON") => ({ player_id: player, want_id: want, city });

  test("players with cards both ways come first, then whoever covers more wants, then the nearest", () => {
    const km = { "Hamilton, ON": 0, "Toronto, ON": 58, "Burlington, ON": 12 };
    const ranked = groupMatches(
      [have(1, 10, "Toronto, ON"), have(1, 11, "Toronto, ON"), have(2, 10, "Burlington, ON"), have(3, 10), have(3, 10)],
      [{ player_id: 2, want_id: 99, city: "Burlington, ON" }],
      (city) => km[city],
    );
    expect(ranked.map((p) => p.playerId)).toEqual([2, 1, 3]);
    expect(ranked[0]).toMatchObject({ mutual: true, wantsCovered: 1, distanceKm: 12 });
    expect(ranked[1]).toMatchObject({ mutual: false, wantsCovered: 2 });
    // Two listings for the same want still cover one want.
    expect(ranked[2]).toMatchObject({ wantsCovered: 1, distanceKm: 0 });
    expect(ranked[2].theyHave).toHaveLength(2);
  });

  test("a player who only wants your cards is still a match", () => {
    const [only] = groupMatches([], [{ player_id: "7", want_id: 1, city: "Ottawa, ON" }]);
    expect(only).toMatchObject({ playerId: 7, mutual: false, wantsCovered: 0, city: "Ottawa, ON", distanceKm: null });
  });
});

describe("reputation and feedback", () => {
  test("reputation rounds the average and treats no feedback as zero trades", () => {
    expect(reputationView({ completed: 3, rating: "4.6666" })).toEqual({ completedTrades: 3, rating: 4.7 });
    expect(reputationView(undefined)).toEqual({ completedTrades: 0, rating: null });
  });

  test("a trade that happened needs 1-5 stars; one that didn't takes none", () => {
    expect(feedbackError({ completed: true, rating: 5 })).toBeNull();
    expect(feedbackError({ completed: false })).toBeNull();
    expect(feedbackError({ completed: true, rating: 6 })).toMatch(/1 to 5/);
    expect(feedbackError({ completed: true })).toMatch(/1 to 5/);
    expect(feedbackError({ completed: false, rating: 3 })).toMatch(/happened/);
    expect(feedbackError({ completed: "yes" })).toMatch(/whether/);
  });
});
