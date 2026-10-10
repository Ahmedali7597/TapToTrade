import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import Wants from "./Wants";
import { TradeDetail } from "./Trades";

const printing = (id, name) => ({ id, name, setCode: "m10", setName: "Magic 2010", collectorNumber: "1", imageUrl: null, finishes: ["nonfoil", "foil"] });
const listing = (id, name, wantId) => ({ id, quantity: 1, condition: "NM", finish: "nonfoil", available: true, printing: printing(`p${id}`, name), wantId });
const bolt = { id: 7, quantity: 4, finish: null, anyPrinting: true, printing: printing("pb", "Lightning Bolt") };

test("want list shows matches nearby, how many players have each card, and a prefilled proposal", async () => {
  mockApi({
    "GET /api/wants": { wants: [bolt] },
    "GET /api/wants/matches": {
      radius: 100,
      city: "Hamilton, ON",
      players: [
        {
          player: { id: 2, username: "bob", city: "Burlington, ON", store: null, reputation: { completedTrades: 3, rating: 4.7 } },
          distanceKm: 12,
          mutual: true,
          theyHave: [listing(11, "Lightning Bolt", 7)],
          theyWant: [listing(21, "Sol Ring", 99)],
        },
      ],
    },
  });
  renderAt(<Wants />, { route: "/wants" });
  const match = (await screen.findByRole("link", { name: "bob" })).closest("article");
  expect(within(match).getByText("Trade both ways")).toBeInTheDocument();
  expect(within(match).getByText("Has 1 card you want")).toBeInTheDocument();
  expect(within(match).getByText("Wants 1 card you have")).toBeInTheDocument();
  expect(within(match).getByTitle(/Rated 4.7 out of 5 · 3 completed trades/)).toBeInTheDocument();
  expect(within(match).getByRole("link", { name: /Propose a trade/ })).toHaveAttribute("href", "/trades/new?to=bob&item=11&offer=21");
  expect(screen.getByText("1 player nearby has it")).toBeInTheDocument();
});

test("an empty want list and no matches explain what to do", async () => {
  mockApi({ "GET /api/wants": { wants: [] }, "GET /api/wants/matches": { radius: 100, city: "Hamilton, ON", players: [] } });
  renderAt(<Wants />, { route: "/wants" });
  expect(await screen.findByText("Nothing on your want list yet")).toBeInTheDocument();
  expect(await screen.findByText("No matches within 100 km yet")).toBeInTheDocument();
});

describe("rating an accepted trade", () => {
  const bob = { id: 2, username: "bob", city: "Burlington, ON" };
  const accepted = {
    id: 5,
    parentId: null,
    status: "accepted",
    createdAt: "2026-10-01T12:00:00Z",
    sender: bob,
    receiver: { id: 1, username: "alice", city: "Hamilton, ON" },
    requested: [],
    offered: [],
  };

  test("pick stars, then send; the answer replaces the form", async () => {
    let feedback = null;
    const post = jest.fn((body) => {
      feedback = body;
      return { feedback: body };
    });
    mockApi({ "GET /api/trades/5": () => ({ thread: [accepted], currentId: 5, feedback }), "POST /api/trades/5/feedback": post });
    renderAt(<TradeDetail />, { route: "/trades/5", path: "/trades/:id" });
    const send = await screen.findByRole("button", { name: "We traded, send rating" });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    await userEvent.click(send);
    expect(post).toHaveBeenCalledWith({ completed: true, rating: 4 });
    expect(await screen.findByText("Thanks! You rated bob 4 out of 5.")).toBeInTheDocument();
  });

  test("players can say it didn't happen instead", async () => {
    const post = jest.fn(() => ({ feedback: { completed: false, rating: null } }));
    mockApi({ "GET /api/trades/5": { thread: [accepted], currentId: 5, feedback: null }, "POST /api/trades/5/feedback": post });
    renderAt(<TradeDetail />, { route: "/trades/5", path: "/trades/:id" });
    await userEvent.click(await screen.findByRole("button", { name: "It didn't happen" }));
    expect(post).toHaveBeenCalledWith({ completed: false });
  });
});
