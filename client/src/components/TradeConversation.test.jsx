import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { alice, mockApi, renderAt } from "@/test/render";
import { MeetupPlanner, TradeMessages } from "./TradeConversation";

const bob = { id: 2, username: "bob" };
const msg = (id, sender, body) => ({ id, body, createdAt: "2026-10-21T18:00:00Z", sender });

test("messages show who wrote them, send with the button, and show the server's reason when refused", async () => {
  const fetch = mockApi({
    "POST /api/trades/5/messages": (req) =>
      req.body === "you retard" ? { __status: 400, error: "Please fix", fields: { body: "That includes a slur." } } : { message: msg(3, { id: alice.id, username: "alice" }, req.body) },
  });
  renderAt(<TradeMessages tradeId={5} initial={[msg(1, bob, "Saturday at 2?")]} canMessage other={bob} />);
  expect(screen.getByRole("log", { name: "Messages with bob" })).toHaveTextContent("Saturday at 2?");

  const box = screen.getByLabelText("Write a message");
  await userEvent.type(box, "you retard");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("That includes a slur.")).toBeInTheDocument();
  expect(box).toHaveAttribute("aria-invalid", "true");

  await userEvent.clear(box);
  await userEvent.type(box, "See you there!");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("See you there!")).toBeInTheDocument();
  expect(box).toHaveValue("");
  expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ body: "See you there!" });
});

test("closed trades keep their messages but can't get new ones", () => {
  renderAt(<TradeMessages tradeId={5} initial={[msg(1, bob, "Never mind")]} canMessage={false} other={bob} />);
  expect(screen.getByText("Never mind")).toBeInTheDocument();
  expect(screen.queryByLabelText("Write a message")).not.toBeInTheDocument();
  expect(screen.getByText(/This trade is closed/)).toBeInTheDocument();
});

test("the other player confirms a suggested meetup, then it can go in a calendar", async () => {
  const meetup = { meetAt: "2026-12-05T19:00:00Z", timeZone: "America/Toronto", when: "Saturday, December 5, 2026 at 2:00 p.m. EST", place: "The Mana Vault, 1 King St W, Hamilton, ON", store: { id: 7 }, proposedBy: bob, confirmedAt: null };
  mockApi({ "POST /api/trades/5/meetup/confirm": { meetup: { ...meetup, confirmedAt: "2026-10-21T18:00:00Z" } } });
  renderAt(<MeetupPlanner tradeId={5} initial={meetup} other={bob} />);
  expect(screen.getByText(meetup.when)).toBeInTheDocument();
  expect(screen.getByText(meetup.place)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirm this meetup" }));
  expect(await screen.findByText("Confirmed by both of you.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add to calendar" })).toHaveAttribute("href", "/api/trades/5/meetup.ics");
});
