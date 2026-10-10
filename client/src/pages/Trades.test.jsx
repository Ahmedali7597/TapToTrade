import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { RequireAuth } from "@/lib/auth";
import { alice, mockApi, renderAt } from "@/test/render";
import { perspective } from "@/components/TradeSummary";
import { TradeDetail, TradesPage } from "./Trades";
import { ListingCard, RequestTradeButton } from "@/components/ListingCard";

const line = (id, cardName, quantity, ownerId) => ({
  id,
  inventoryItemId: id,
  quantity,
  ownerId,
  printingId: `p${id}`,
  cardName,
  setCode: "m10",
  collectorNumber: "1",
  condition: "NM",
  imageUrl: null,
});
const bob = { id: 2, username: "bob", city: "Burlington, ON" };
const trade = (over = {}) => ({
  id: 5,
  parentId: null,
  status: "pending",
  message: "<script>alert(1)</script>",
  createdAt: "2026-10-01T12:00:00Z",
  sender: bob,
  receiver: { id: alice.id, username: alice.username, city: alice.city },
  requested: [line(1, "Sol Ring", 1, alice.id)],
  offered: [],
  ...over,
});

test("perspective flips give/receive for sender and receiver", () => {
  const t = trade({ offered: [line(2, "Lightning Bolt", 2, bob.id)] });
  expect(perspective(t, alice.id)).toMatchObject({ iAmSender: false, other: bob, give: t.requested, receive: t.offered });
  expect(perspective(t, bob.id)).toMatchObject({ iAmSender: true, give: t.offered, receive: t.requested });
});

describe("TradeDetail (4.5.4, 4.5.6)", () => {
  test("the receiver sees You give / You receive, request-only wording and all three actions", async () => {
    mockApi({ "GET /api/trades/5": { thread: [trade()], currentId: 5 } });
    renderAt(<TradeDetail />, { route: "/trades/5", path: "/trades/:id" });
    expect(await screen.findByText("You give")).toBeInTheDocument();
    expect(screen.getByText("You receive")).toBeInTheDocument();
    expect(screen.getAllByText(/No cards were offered in return/)).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Accept offer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Counter-offer" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Decline" })).toBeEnabled();
    // ST-02: user text is rendered as inert text
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  test("the sender just waits; nobody can act on a finished proposal", async () => {
    mockApi({ "GET /api/trades/5": { thread: [trade({ sender: { ...alice }, receiver: bob })], currentId: 5 } });
    renderAt(<TradeDetail />, { route: "/trades/5", path: "/trades/:id" });
    expect(await screen.findByText(/Waiting for bob/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept offer" })).toBeNull();
  });

  test("accepting posts to the API and shows the honest accepted wording", async () => {
    let status = "pending";
    const fetch = mockApi({
      "GET /api/trades/5": () => ({ thread: [trade({ status })], currentId: 5 }),
      "POST /api/trades/5/accept": () => {
        status = "accepted";
        return { trade: trade({ status }) };
      },
    });
    renderAt(<TradeDetail />, { route: "/trades/5", path: "/trades/:id" });
    await userEvent.click(await screen.findByRole("button", { name: "Accept offer" }));
    expect(await screen.findByText(/doesn't\s+mean the trade is complete/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/trades/5/accept", expect.objectContaining({ method: "POST" }));
  });
});

test("FE-08 the trades inbox shows received and sent tabs", async () => {
  mockApi({ "GET /api/trades": { received: [trade()], sent: [] } });
  renderAt(<TradesPage />);
  expect(await screen.findByRole("tab", { name: "Received (1)" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Sent (0)" })).toBeInTheDocument();
  expect(screen.getByText("Needs your response")).toBeInTheDocument();
});

test("FE-05 a search result shows a Send request button for another player's card", () => {
  const r = { id: 7, quantity: 3, condition: "LP", printing: { name: "Black Lotus", setCode: "lea", collectorNumber: "232", imageUrl: null } };
  renderAt(<ListingCard item={r} owner={bob} action={<RequestTradeButton owner={bob} item={r} />} />);
  expect(screen.getByRole("link", { name: /Send request/ })).toHaveAttribute("href", "/trades/new?to=bob&item=7");
  expect(screen.getByRole("img", { name: "Black Lotus (LEA) card image" })).toBeInTheDocument(); // AC-05
});

describe("route guard (4.1.8)", () => {
  const guarded = (roles) => (
    <Routes>
      <Route element={<RequireAuth roles={roles} />}>
        <Route path="*" element={<p>Secret inventory</p>} />
      </Route>
    </Routes>
  );

  test("FE-06 anonymous visitors are redirected to /login", () => {
    renderAt(guarded(), { user: null, route: "/inventory" });
    expect(screen.queryByText("Secret inventory")).toBeNull();
    expect(screen.getAllByTestId("location")[0]).toHaveTextContent("/login?next=%2Finventory");
  });

  test("signed-in users without the role see a permission message", () => {
    renderAt(guarded(["moderator"]), { route: "/moderation" });
    expect(screen.getByRole("heading", { name: "Permission needed" })).toBeInTheDocument();
  });
});
