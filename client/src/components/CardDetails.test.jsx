import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardImage } from "@/components/common";
import { mockApi, renderAt } from "@/test/render";
import { CardText, CardViewerProvider, symbolName } from "./CardDetails";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const details = (id, name, extra = {}) => ({
  card: {
    id,
    name,
    setCode: "msc",
    setName: "Marvel Super Heroes Commander",
    collectorNumber: "6",
    rarity: "mythic",
    artist: "Nathaniel Himawan",
    imageUrl: null,
    faces: [{ name, manaCost: "{1}{U}{B}{R}", typeLine: "Legendary Creature", oracleText: "It connives. (Draw a card, then discard a card.)", flavorText: '"Kneel before Doom."', stats: "3 / 3", imageUrl: null }],
    legalities: { commander: "legal", modern: "not_legal", vintage: "restricted" },
    prices: { usd: "1.49", usdFoil: null, eur: null },
    scryfallUrl: "https://scryfall.com/card/msc/6",
    rulings: [{ date: "2026-01-01", text: "Conniving is optional." }],
    ...extra,
  },
});

test("card text turns {symbols} into labelled images and puts reminder text in italics", () => {
  render(<CardText text="{T}: Add {G/U}. (Phyrexian {B/P} can be paid with life.)" />);
  expect(screen.getByAltText("tap")).toHaveAttribute("src", "https://svgs.scryfall.io/card-symbols/T.svg");
  expect(screen.getByAltText("green or blue mana")).toHaveAttribute("src", expect.stringContaining("/GU.svg"));
  expect(screen.getByAltText("Phyrexian black mana")).toBeInTheDocument();
  expect(screen.getByText(/can be paid with life/).closest("i")).not.toBeNull();
  expect(symbolName("3")).toBe("3 generic mana");
});

test("tapping a card opens its details, and Previous/Next walk through the cards on screen", async () => {
  mockApi({ [`GET /api/cards/${A}`]: details(A, "Doctor Doom, King of Latveria"), [`GET /api/cards/${B}`]: details(B, "Second Card", { rulings: [] }) });
  renderAt(
    <CardViewerProvider>
      <CardImage name="Doctor Doom, King of Latveria" setCode="msc" imageUrl={null} printingId={A} siblings={[A, B]} />
    </CardViewerProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Zoom in on Doctor Doom, King of Latveria (MSC)" }));
  const dialog = await screen.findByRole("dialog", { name: "Doctor Doom, King of Latveria" });
  expect(within(dialog).getByText("Legendary Creature")).toBeInTheDocument();
  expect(within(dialog).getByText("Conniving is optional.")).toBeInTheDocument();
  expect(within(dialog).getByText("Commander").closest("li")).toHaveTextContent(": legal");
  expect(within(dialog).getByText("(restricted)")).toBeInTheDocument();
  expect(within(dialog).getByRole("link", { name: /View on Scryfall/ })).toHaveAttribute("href", "https://scryfall.com/card/msc/6");
  expect(within(dialog).getByRole("link", { name: /Find players trading it/ })).toHaveAttribute("href", "/search?name=Doctor%20Doom%2C%20King%20of%20Latveria");
  expect(within(dialog).getByRole("button", { name: /Previous/ })).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("button", { name: /Next/ }));
  expect(await screen.findByRole("dialog", { name: "Second Card" })).toBeInTheDocument();
  expect(screen.getByText("No official rulings for this card.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Close/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("without a card viewer (or a printing id) a card image is just a picture", () => {
  render(<CardImage name="Sol Ring" setCode="c21" imageUrl={null} printingId={A} />);
  expect(screen.getByRole("img", { name: "Sol Ring (C21) card image" })).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
