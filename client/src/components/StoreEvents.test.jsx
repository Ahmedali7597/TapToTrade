import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import { NextEvents, StoreEvents } from "./StoreEvents";

const STORE = { id: 3, name: "Knight Games", city: "Hamilton, ON" };
// 22:00 UTC on Oct 9 is 6 pm in Hamilton.
const NIGHT = {
  id: 11,
  storeId: 3,
  title: "Friday trade night",
  kind: "trade_night",
  startsAt: "2026-10-09T22:00:00.000Z",
  endsAt: "2026-10-10T02:00:00.000Z",
  timeZone: "America/Toronto",
  date: "2026-10-09",
  startTime: "18:00",
  endTime: "22:00",
  details: "Bring your binder.",
  cost: "Free",
  link: "https://example.test/rsvp",
  cancelled: false,
};
const PRERELEASE = { ...NIGHT, id: 12, title: "Prerelease", kind: "prerelease", startsAt: "2026-10-10T14:00:00.000Z", endsAt: null, details: null, cost: null, link: null, cancelled: true };

test("players see upcoming events in the store's time, with calendar links and cancellations marked", () => {
  renderAt(<StoreEvents store={STORE} events={[NIGHT, PRERELEASE]} canManage={false} onChange={jest.fn()} />);
  const list = screen.getByRole("list", { name: "Upcoming events at Knight Games" });
  const [night, prerelease] = within(list).getAllByRole("listitem");
  expect(night).toHaveTextContent("Friday trade night");
  expect(night).toHaveTextContent(/Fri, Oct 9 · 6:00\s?–\s?10:00\s(PM|p\.m\.) · Free/u);
  expect(within(night).getByRole("link", { name: /Add to calendar/ })).toHaveAttribute("href", "/api/stores/3/events/11.ics");
  expect(within(night).getByRole("link", { name: /sign-up/ })).toHaveAttribute("href", "https://example.test/rsvp");
  expect(within(prerelease).getByText("Cancelled")).toBeInTheDocument();
  expect(within(prerelease).queryByRole("link", { name: /Add to calendar/ })).toBeNull();
  // Visitors can subscribe but not edit.
  expect(screen.getByRole("button", { name: /Subscribe/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Add event/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
});

test("with no events, the section is hidden from players and invites the store to add some", () => {
  const { unmount } = renderAt(<StoreEvents store={STORE} events={[]} canManage={false} onChange={jest.fn()} />);
  expect(screen.queryByRole("heading", { name: "Upcoming events" })).toBeNull();
  unmount();
  renderAt(<StoreEvents store={STORE} events={[]} canManage onChange={jest.fn()} />);
  expect(screen.getByText(/No upcoming events yet/)).toBeInTheDocument();
});

test("the store's account posts a weekly event in local time", async () => {
  const post = jest.fn(() => ({ events: [NIGHT] }));
  mockApi({ "POST /api/stores/3/events": post });
  const onChange = jest.fn();
  renderAt(<StoreEvents store={STORE} events={[]} canManage onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: /Add event/ }));
  const dialog = screen.getByRole("dialog", { name: "Add an event at Knight Games" });
  expect(dialog).toHaveTextContent("Times are local to Hamilton, ON.");
  await userEvent.type(within(dialog).getByLabelText("Title"), "Friday trade night");
  await userEvent.selectOptions(within(dialog).getByLabelText("Kind of event"), "Trade night");
  await userEvent.type(within(dialog).getByLabelText("Date"), "2026-10-09");
  await userEvent.type(within(dialog).getByLabelText("Ends (optional)"), "22:00");
  await userEvent.selectOptions(within(dialog).getByLabelText("Repeat"), "Every week for 4 weeks");
  await userEvent.click(within(dialog).getByRole("button", { name: "Add event" }));
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ title: "Friday trade night", kind: "trade_night", date: "2026-10-09", startTime: "18:00", endTime: "22:00", repeatWeeks: 4 }));
  expect(onChange).toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("editing marks an event cancelled; field errors show inline", async () => {
  let attempt = 0;
  const patch = jest.fn(() => (++attempt === 1 ? { error: "Please fix the highlighted fields.", fields: { link: "Use a full https:// link, or leave it blank." }, __status: 400 } : { event: NIGHT }));
  mockApi({ "PATCH /api/stores/3/events/11": patch });
  renderAt(<StoreEvents store={STORE} events={[NIGHT]} canManage onChange={jest.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /^Edit Friday trade night/ }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("Title")).toHaveValue("Friday trade night");
  expect(within(dialog).queryByLabelText("Repeat")).toBeNull();
  await userEvent.click(within(dialog).getByRole("switch", { name: /Cancelled/ }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Save event" }));
  expect(await within(dialog).findByText("Use a full https:// link, or leave it blank.")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Save event" }));
  expect(patch).toHaveBeenLastCalledWith(expect.objectContaining({ cancelled: true, date: "2026-10-09", startTime: "18:00" }));
});

test("the directory shows a store's next events", () => {
  renderAt(<NextEvents events={[NIGHT]} />);
  expect(screen.getByRole("list", { name: "Next events" })).toHaveTextContent(/Friday trade night · Fri, Oct 9 · 6:00/);
});
