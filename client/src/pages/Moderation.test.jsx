import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { alice, mockApi, renderAt } from "@/test/render";
import { ModerationPage } from "./Moderation";

const moderator = { ...alice, role: "moderator" };
const report = (target = {}, over = {}) => ({
  id: 7,
  reason: "Looks like a proxy.",
  reporter: "carol",
  createdAt: "2026-11-01T12:00:00Z",
  item: { id: 11, label: "Black Lotus (LEA)" },
  target: { id: 2, username: "bob", city: "Burlington, ON", role: "user", status: "active", ...target },
  ...over,
});

// The request the page sent for `method path`, with its JSON body.
const sent = (fetch, method, path) => {
  const call = fetch.mock.calls.find(([url, init]) => url === path && init?.method === method);
  return call && JSON.parse(call[1].body);
};

// Opens the reason dialog for `button`, types a reason and confirms.
async function act(button, reason, confirm = button) {
  await userEvent.click(await screen.findByRole("button", { name: button }));
  const dialog = await screen.findByRole("dialog");
  const submit = within(dialog).getByRole("button", { name: confirm });
  await userEvent.type(within(dialog).getByLabelText("Reason"), "abc");
  expect(submit).toBeDisabled(); // 5.2.3: every action needs a real reason
  await userEvent.type(within(dialog).getByLabelText("Reason"), reason);
  await userEvent.click(submit);
}

describe("moderation report queue (4.6.2 to 4.6.4)", () => {
  test("a pending listing report shows every moderator action", async () => {
    mockApi({ "GET /api/moderation/reports": { reports: [report()] } });
    renderAt(<ModerationPage />, { user: moderator });
    expect(await screen.findByText("Black Lotus (LEA)")).toBeInTheDocument();
    for (const name of ["Remove listing", "Suspend account", "Mark reviewed", "Dismiss"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  test("4.6.2 remove listing sends DELETE with the reason and the report id, then reloads", async () => {
    const fetch = mockApi({ "GET /api/moderation/reports": { reports: [report()] }, "DELETE /api/moderation/inventory/11": { ok: true } });
    renderAt(<ModerationPage />, { user: moderator });
    await act("Remove listing", " counterfeit card");
    expect(sent(fetch, "DELETE", "/api/moderation/inventory/11")).toEqual({ reason: "abc counterfeit card", reportId: 7 });
    expect(await screen.findByText("Black Lotus (LEA)")).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => url.startsWith("/api/moderation/reports"))).toHaveLength(2); // reloaded
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("4.6.3 suspend account sends the reason and the report id", async () => {
    const fetch = mockApi({ "GET /api/moderation/reports": { reports: [report()] }, "POST /api/moderation/users/2/suspend": { ok: true } });
    renderAt(<ModerationPage />, { user: moderator });
    await act("Suspend account", " repeated fakes");
    expect(sent(fetch, "POST", "/api/moderation/users/2/suspend")).toEqual({ reason: "abc repeated fakes", reportId: 7 });
  });

  test("4.7 a moderator gets no actions on a report about an admin (the server refuses them too)", async () => {
    mockApi({ "GET /api/moderation/reports": { reports: [report({ role: "admin" })] } });
    renderAt(<ModerationPage />, { user: moderator });
    expect(await screen.findByText("Looks like a proxy.")).toBeInTheDocument();
    for (const name of ["Remove listing", "Suspend account", "Mark reviewed", "Dismiss"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  test("4.6.4 a suspended player can be reinstated", async () => {
    const fetch = mockApi({ "GET /api/moderation/reports": { reports: [report({ status: "suspended" })] }, "POST /api/moderation/users/2/unsuspend": { ok: true } });
    renderAt(<ModerationPage />, { user: moderator });
    expect(await screen.findByText("Suspended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend account" })).not.toBeInTheDocument();
    await act("Reinstate account", " appeal accepted", "Reinstate");
    expect(sent(fetch, "POST", "/api/moderation/users/2/unsuspend")).toEqual({ reason: "abc appeal accepted" });
  });

  test("dismiss resolves the report as dismissed", async () => {
    const fetch = mockApi({ "GET /api/moderation/reports": { reports: [report()] }, "POST /api/moderation/reports/7/resolve": { ok: true } });
    renderAt(<ModerationPage />, { user: moderator });
    await act("Dismiss", " not a fake");
    expect(sent(fetch, "POST", "/api/moderation/reports/7/resolve")).toEqual({ status: "dismissed", reason: "abc not a fake" });
  });

  test("an already removed listing has no Remove button", async () => {
    mockApi({ "GET /api/moderation/reports": { reports: [report({}, { item: { id: null, label: "Black Lotus (LEA)" } })] } });
    renderAt(<ModerationPage />, { user: moderator });
    expect(await screen.findByText("(already removed)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove listing" })).not.toBeInTheDocument();
  });

  test("a server error stays in the dialog so the moderator can retry", async () => {
    mockApi({
      "GET /api/moderation/reports": { reports: [report()] },
      "POST /api/moderation/users/2/suspend": { __status: 400, error: "That player is already suspended." },
    });
    renderAt(<ModerationPage />, { user: moderator });
    await act("Suspend account", " repeated fakes");
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("That player is already suspended.")).toBeInTheDocument();
  });
});

describe("bans and appeals tabs", () => {
  test("the Bans tab lists suspended accounts with the reason and a Reinstate button", async () => {
    const fetch = mockApi({
      "GET /api/moderation/reports": { reports: [] },
      "GET /api/moderation/suspended": { users: [{ id: 2, username: "bob", city: "Burlington, ON", role: "user", suspendedAt: "2026-11-01T12:00:00Z", suspendedBy: "mod", reason: "Sold fakes.", appealPending: true }] },
      "POST /api/moderation/users/2/unsuspend": { ok: true },
    });
    renderAt(<ModerationPage />, { user: moderator });
    await userEvent.click(await screen.findByRole("button", { name: "Bans" }));
    expect(await screen.findByText("Sold fakes.")).toBeInTheDocument();
    expect(screen.getByText("Appeal waiting")).toBeInTheDocument();
    await act("Reinstate account", " served the time", "Reinstate");
    expect(sent(fetch, "POST", "/api/moderation/users/2/unsuspend")).toEqual({ reason: "abc served the time" });
  });

  test("the Players tab finds a player and suspends them, with no button for staff you don't outrank", async () => {
    const fetch = mockApi({
      "GET /api/moderation/reports": { reports: [] },
      "GET /api/moderation/users": {
        users: [
          { id: 2, username: "bob", city: "Burlington, ON", role: "user", status: "active", joinedAt: "2026-10-01T12:00:00Z", openReports: 2 },
          { id: 3, username: "dana", city: "Hamilton, ON", role: "admin", status: "active", joinedAt: "2026-09-01T12:00:00Z", openReports: 0 },
        ],
      },
      "POST /api/moderation/users/2/suspend": { ok: true },
    });
    renderAt(<ModerationPage />, { user: moderator });
    await userEvent.click(await screen.findByRole("button", { name: "Players" }));
    expect(await screen.findByText("2 open reports")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Suspend" })).toHaveLength(1); // not on the admin
    await userEvent.type(screen.getByLabelText("Find a player"), "bob");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(fetch.mock.calls.some(([url]) => url === "/api/moderation/users?q=bob&status=all")).toBe(true);
    await act("Suspend", " ghosted three trades", "Suspend account");
    expect(sent(fetch, "POST", "/api/moderation/users/2/suspend")).toEqual({ reason: "abc ghosted three trades" });
  });

  test("the Appeals tab accepts (reinstates) or rejects an appeal", async () => {
    const appeal = { id: 5, message: "I have receipts.", status: "pending", createdAt: "2026-11-02T12:00:00Z", user: { id: 2, username: "bob", city: "Burlington, ON", role: "user", status: "suspended" } };
    const fetch = mockApi({
      "GET /api/moderation/reports": { reports: [] },
      "GET /api/moderation/appeals": { appeals: [appeal] },
      "POST /api/moderation/appeals/5/reject": { ok: true },
    });
    renderAt(<ModerationPage />, { user: moderator });
    await userEvent.click(await screen.findByRole("button", { name: "Appeals" }));
    expect(await screen.findByText("I have receipts.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept and reinstate" })).toBeEnabled();
    await act("Reject appeal", " no receipts shown");
    expect(sent(fetch, "POST", "/api/moderation/appeals/5/reject")).toEqual({ reason: "abc no receipts shown" });
  });
});
