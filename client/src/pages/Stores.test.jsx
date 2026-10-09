import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import { StorePage, Stores } from "./Stores";

// The real map needs a browser; these tests only check what it's given.
jest.mock("@/components/TradeMap", () => ({ __esModule: true, default: ({ stores, label }) => <div role="region" aria-label={label}>{stores.length} on the map</div> }));

const VAULT = {
  id: 1,
  name: "The Mana Vault",
  address: "120 King St E",
  city: "Hamilton, ON",
  lat: 43.25,
  lng: -79.86,
  website: "https://example.com",
  notes: "Forty seats of play space.",
  tags: ["trade_night", "commander"],
  featured: true,
  perk: "10% off singles for Tap to Trade players",
  hours: "Trade night Fridays 6-10 pm",
  account: "vault_store",
  path: "/stores/1-the-mana-vault",
  distanceKm: 0,
};
const CAFE = { ...VAULT, id: 2, name: "Burlington Card Café", city: "Burlington, ON", tags: ["fnm"], featured: false, perk: null, hours: null, website: null, account: null, path: "/stores/2-burlington-card-cafe", distanceKm: 12 };

test("the directory lists partner stores with what they offer, filters by tag, and invites store owners", async () => {
  mockApi({ "GET /api/stores": { stores: [VAULT, CAFE] } });
  renderAt(<Stores />);
  const list = await screen.findByRole("list", { name: "Partner stores" });
  expect(within(list).getAllByRole("heading", { level: 2 })).toHaveLength(2);
  expect(screen.getByText("Featured partner")).toBeInTheDocument();
  expect(screen.getByText("10% off singles for Tap to Trade players")).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: /Directions/ })[0]).toHaveAttribute("href", expect.stringContaining("google.com/maps/dir/?api=1&destination=The%20Mana%20Vault"));
  expect(await screen.findByRole("region", { name: "Map of partner game stores" })).toHaveTextContent("2 on the map");

  await userEvent.selectOptions(screen.getByLabelText("Show"), "Friday Night Magic");
  expect(within(screen.getByRole("list", { name: "Partner stores" })).getAllByRole("heading", { level: 2 })).toHaveLength(1);
  expect(screen.getByRole("link", { name: "Burlington Card Café" })).toHaveAttribute("href", "/stores/2-burlington-card-cafe");
  expect(screen.getByRole("link", { name: "Become a partner store" })).toHaveAttribute("href", expect.stringMatching(/^mailto:hello@taptotrade\.ca\?subject=Partner/));
  // One text node, so nothing reading the page piece by piece can drop the space ("write tohello@").
  expect(screen.getByText("Or write to hello@taptotrade.ca.").childNodes).toHaveLength(1);
});

test("a store page shows its perk, hours and a search near the store; a missing store says so", async () => {
  mockApi({ "GET /api/stores/1-the-mana-vault": { store: VAULT, nearby: { radiusKm: 25, players: 4, listings: 71 } } });
  renderAt(<StorePage />, { route: "/stores/1-the-mana-vault", path: "/stores/:slug" });
  expect(await screen.findByRole("heading", { name: "The Mana Vault" })).toBeInTheDocument();
  expect(screen.getByText("71 card listings shared by 4 players within 25 km.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Find cards near this store" })).toHaveAttribute("href", "/search?city=Hamilton%2C+ON&radius=25");
  expect(screen.getByRole("link", { name: /store's own binder/ })).toHaveAttribute("href", "/u/vault_store");
  expect(screen.getByText("Member perk")).toBeInTheDocument();
  expect(document.title).toBe("The Mana Vault, Hamilton, ON · Partner game store · Tap to Trade");

  mockApi({ "GET /api/stores/9": { error: "That store was not found.", __status: 404 } });
  renderAt(<StorePage />, { route: "/stores/9", path: "/stores/:slug" });
  expect(await screen.findByText("Store not found")).toBeInTheDocument();
});
