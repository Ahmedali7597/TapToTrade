import { screen } from "@testing-library/react";
import { mockApi, renderAt } from "@/test/render";
import CityPage from "./City";

const HAMILTON = {
  city: "Hamilton, ON",
  path: "/trade/hamilton-on",
  radiusKm: 25,
  players: 4,
  listings: 71,
  localPlayers: 2,
  localStores: 1,
  indexable: true,
  stores: [{ id: 1, name: "The Mana Vault", address: "120 King St E", city: "Hamilton, ON", tags: ["trade_night"], path: "/stores/1-the-mana-vault", distanceKm: 0 }],
  events: [],
  cards: [{ name: "Sol Ring", players: 3 }],
};

test("a city page sums up local trading and links to cards, stores and a search near the city", async () => {
  mockApi({ "GET /api/cities/hamilton-on": HAMILTON });
  renderAt(<CityPage />, { route: "/trade/hamilton-on", path: "/trade/:slug", user: null });
  expect(await screen.findByRole("heading", { level: 1, name: "Trade Magic: The Gathering cards in Hamilton, ON" })).toBeInTheDocument();
  expect(screen.getByText(/4 players within 25 km of Hamilton, ON have shared 71 card listings/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Find cards near Hamilton/ })).toHaveAttribute("href", "/search?city=Hamilton%2C+ON&radius=25");
  expect(screen.getByRole("link", { name: "Sol Ring" })).toHaveAttribute("href", expect.stringContaining("name=Sol+Ring"));
  expect(screen.getByRole("link", { name: "The Mana Vault" })).toHaveAttribute("href", "/stores/1-the-mana-vault");
  expect(screen.getByRole("link", { name: "Create a free account" })).toBeInTheDocument();
  expect(document.title).toBe("Trade MTG cards in Hamilton, ON · Tap to Trade");
});
