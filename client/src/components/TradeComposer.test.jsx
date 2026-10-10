import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TradeComposer, { toLines } from "./TradeComposer";

const item = (id, name, quantity) => ({
  id,
  quantity,
  condition: "NM",
  available: true,
  printing: { id: `p${id}`, name, setCode: "m10", setName: "Magic 2010", collectorNumber: String(id), imageUrl: null },
});

const setup = (onSubmit = jest.fn()) => {
  render(
    <TradeComposer
      counterpart={{ id: 2, username: "bob", city: "Burlington, ON" }}
      theirItems={[item(10, "Lightning Bolt", 4)]}
      myItems={[item(20, "Sol Ring", 2)]}
      initialRequested={{ 10: 1 }}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
};

test("toLines drops zero quantities", () => {
  expect(toLines({ 10: 2, 11: 0 })).toEqual([{ inventoryItemId: 10, quantity: 2 }]);
});

test("quantities can't exceed what the owner has (4.5.7)", async () => {
  setup();
  const input = screen.getByLabelText("Offer quantity of Sol Ring");
  await userEvent.clear(input);
  await userEvent.type(input, "9");
  expect(input).toHaveValue(2);
  expect(screen.getByRole("button", { name: "Increase Offer quantity of Sol Ring" })).toBeDisabled();
});

test("sends requested and optional offered lines with the message", async () => {
  const onSubmit = setup(jest.fn().mockResolvedValue());
  await userEvent.click(screen.getByRole("button", { name: "Increase Request quantity of Lightning Bolt" }));
  await userEvent.click(screen.getByRole("button", { name: "Increase Offer quantity of Sol Ring" }));
  await userEvent.type(screen.getByLabelText(/Message/), "Library on Saturday?");
  expect(screen.getByTestId("trade-summary").textContent).toMatch(/You receive 2 · You give 1/);
  await userEvent.click(screen.getByRole("button", { name: /Tap to trade/ }));
  expect(onSubmit).toHaveBeenCalledWith({
    requested: [{ inventoryItemId: 10, quantity: 2 }],
    offered: [{ inventoryItemId: 20, quantity: 1 }],
    message: "Library on Saturday?",
  });
});

test("requires at least one requested card and keeps entries after a server error", async () => {
  const onSubmit = setup(jest.fn().mockRejectedValue(new Error("Only 1 × Lightning Bolt available (you chose 2).")));
  await userEvent.click(screen.getByRole("button", { name: "Decrease Request quantity of Lightning Bolt" }));
  await userEvent.click(screen.getByRole("button", { name: /Tap to trade/ }));
  expect(screen.getByText("Choose at least one card you want to receive.")).toBeInTheDocument();
  expect(onSubmit).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Increase Request quantity of Lightning Bolt" }));
  await userEvent.click(screen.getByRole("button", { name: /Tap to trade/ }));
  const alert = await screen.findByRole("alert");
  expect(within(alert).getByText(/Only 1 × Lightning Bolt/)).toBeInTheDocument();
  expect(screen.getByLabelText("Request quantity of Lightning Bolt")).toHaveValue(1); // 5.5.2
});

test("a request-only proposal is labelled as such", () => {
  setup();
  expect(screen.getByText(/request only/)).toBeInTheDocument();
});
