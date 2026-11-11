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

  test("4.7 a moderator gets no Suspend button for an admin (the server refuses it too)", async () => {
    mockApi({ "GET /api/moderation/reports": { reports: [report({ role: "admin" })] } });
    renderAt(<ModerationPage />, { user: moderator });
    expect(await screen.findByRole("button", { name: "Remove listing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Suspend account" })).not.toBeInTheDocument();
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
