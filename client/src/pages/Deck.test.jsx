import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import Deck from "./Deck";

const printing = (id, setCode, setName, finishes) => ({ id, name: "Lightning Bolt", typeLine: "Instant", colorIdentity: ["R"], setCode, setName, collectorNumber: "1", imageUrl: null, finishes, manaValue: 1, manaCost: "{R}", legalities: { modern: "legal" } });
const M10 = printing("m10-id", "m10", "Magic 2010", ["nonfoil", "foil"]);
const TWO_XM = printing("2xm-id", "2xm", "Double Masters", ["foil"]);

test("the card editor changes a deck card's printing, finish and condition", async () => {
  const user = userEvent.setup();
  let saved = null;
  mockApi({
    "GET /api/decks/3": { deck: { id: 3, name: "Burn", format: "modern", visibility: "private", owner: { username: "alice" } }, cards: [{ id: 7, board: "main", quantity: 4, finish: "nonfoil", condition: "NM", printing: M10 }], mine: true, owned: {} },
    "GET /api/cards/prices": { prices: {} },
    "GET /api/cards/printings": { printings: [TWO_XM, M10] },
    "PATCH /api/decks/3/cards/7": (body) => {
      saved = body;
      return { card: { id: 7, board: "main", quantity: 4, finish: body.finish, condition: body.condition, printing: TWO_XM } };
    },
  });
  renderAt(<Deck />, { route: "/decks/3", path: "/decks/:id" });
  await user.click(await screen.findByRole("button", { name: "Edit Lightning Bolt" }));
  const dialog = await screen.findByRole("dialog");
  await waitFor(() => expect(within(dialog).getByLabelText("Printing")).toBeEnabled());

  // 2XM only comes in foil, so picking it switches the finish and offers nothing else.
  await user.selectOptions(within(dialog).getByLabelText("Printing"), "2xm-id");
  expect(within(dialog).getByLabelText("Finish")).toHaveValue("foil");
  expect(within(within(dialog).getByLabelText("Finish")).getAllByRole("option")).toHaveLength(1);
  await user.selectOptions(within(dialog).getByLabelText("Condition"), "LP");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));

  await waitFor(() => expect(saved).toEqual({ quantity: 4, board: "main", printingId: "2xm-id", finish: "foil", condition: "LP" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
