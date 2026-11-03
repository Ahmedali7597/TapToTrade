import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import Optimizer from "./Optimizer";

// A small made-up pool: a commander, basics, and cheap and pricey cards of each role.
const card = (name, roles, price, extra = {}) => ({ name, roles, price, manaValue: 1, manaCost: "{U}", typeLine: roles[0] === "land" ? "Land" : "Instant", colorIdentity: ["U"], legal: true, inIdentity: true, basic: false, cedh: null, imageUrl: null, printingId: `${name}-id`, setCode: "tst", collectorNumber: "1", ...extra });
const series = (prefix, n, roles, price, extra) => Array.from({ length: n }, (_, i) => card(`${prefix} ${i + 1}`, roles, price, extra));
const COMMANDER = card("Talrand, Sky Summoner", ["other"], 1, { typeLine: "Legendary Creature" });
const POOL = [
  COMMANDER,
  card("Island", ["land"], 0.1, { basic: true, typeLine: "Basic Land — Island" }),
  ...series("Rock", 12, ["fastMana"], 30, { cedh: 0.6, net: 1 }),
  ...series("Tutor", 10, ["tutor"], 3, { cedh: 0.5, finds: "any" }),
  ...series("Counter", 14, ["interaction"], 1, { cedh: 0.4, cheap: true }),
  ...series("Cantrip", 12, ["draw"], 0.5),
  ...series("Filler", 40, ["other"], 0.2),
];
const ORIGINAL = [...Array.from({ length: 40 }, (_, i) => `Filler ${i + 1}`), ...Array(59).fill("Island")];
const analysis = { commanders: [COMMANDER], identity: ["U"], original: ORIGINAL, skipped: [], pool: POOL, combos: [], rate: { usdCad: 1.4, date: "2026-10-30" }, sources: { cedh: null, spellbook: "https://commanderspellbook.com" } };

test("locks the commander, rebuilds on a budget change, respects a rejection and saves the picks as a new deck", async () => {
  const user = userEvent.setup();
  let imported = null;
  mockApi({
    "GET /api/decks": { decks: [] },
    "POST /api/optimizer/analyze": analysis,
    "POST /api/optimizer/listings": { listings: {} },
    "POST /api/decks": { deck: { id: 9 } },
    "POST /api/decks/9/import": (body) => {
      imported = body;
      return { added: 100, skippedCount: 0, skipped: [] };
    },
  });
  renderAt(<Optimizer />, { route: "/optimizer" });
  await user.type(screen.getByLabelText("Commander"), "Talrand, Sky Summoner");
  await user.click(screen.getByRole("button", { name: /Analyze and optimize/ }));

  expect(await screen.findByText("Commander locked")).toBeInTheDocument();
  expect(screen.getAllByText("Talrand, Sky Summoner").length).toBeGreaterThan(0);
  const summary = () => screen.getByText(/swaps? suggested/).textContent;
  await waitFor(() => expect(summary()).toMatch(/\d+ swaps? suggested/));
  const atDefault = summary();

  // A smaller budget builds a different deck, and never names the commander as a swap.
  await user.click(screen.getByRole("button", { name: "CA$100" }));
  await waitFor(() => expect(summary()).not.toBe(atDefault), { timeout: 4000 });
  const table = screen.getByRole("table", { name: "" });
  expect(within(table).queryByText("Talrand, Sky Summoner")).toBeNull();

  // Rejecting a swap keeps the card and never suggests the other one again.
  const firstRow = within(table).getAllByRole("row")[1];
  const added = within(firstRow).getAllByRole("cell")[2].textContent;
  await user.click(within(firstRow).getByRole("button", { name: /Reject/ }));
  expect(await screen.findByText(new RegExp(`never add ${added}`))).toBeInTheDocument();
  await waitFor(() => expect(within(screen.getByRole("table", { name: "" })).queryByText(added)).toBeNull());

  await user.click(screen.getByRole("button", { name: /Save as a new deck/ }));
  expect(await screen.findByText("Saved as a new private deck.")).toBeInTheDocument();
  expect(imported.replace).toBe(true);
  expect(imported.text.startsWith("Commander\n1 Talrand, Sky Summoner (TST) 1\n\nDeck\n")).toBe(true);
  const total = imported.text
    .split("\n")
    .filter((l) => /^\d+ /.test(l))
    .reduce((n, l) => n + Number(l.split(" ")[0]), 0);
  expect(total).toBe(100); // the commander plus 99

  // Revert to my list takes every swap back out.
  await user.click(screen.getByRole("button", { name: /Revert to my list/ }));
  expect(screen.getByText(/0 selected/)).toBeInTheDocument();
});
