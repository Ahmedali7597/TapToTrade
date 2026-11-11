import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import ReportDialog from "./ReportDialog";

const bob = { id: 2, username: "bob" };
const listing = { id: 11, printing: { name: "Black Lotus" } };
const sentBody = (fetch) => JSON.parse(fetch.mock.calls.find(([url]) => url === "/api/reports")[1].body);

describe("reporting (4.6.1)", () => {
  test("report a listing: sends only the listing id and the reason, then thanks the player", async () => {
    const fetch = mockApi({ "POST /api/reports": { report: { id: 1 } } });
    renderAt(<ReportDialog user={bob} item={listing} />);
    await userEvent.click(screen.getByRole("button", { name: "Report listing" }));
    expect(screen.getByRole("dialog", { name: "Report Black Lotus listed by bob" })).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send report" });
    await userEvent.type(screen.getByLabelText("Reason"), "fake");
    expect(send).toBeDisabled(); // under 5 characters
    await userEvent.type(screen.getByLabelText("Reason"), " card");
    await userEvent.click(send);
    expect(await screen.findByText(/Your report was sent to the moderators/)).toBeInTheDocument();
    expect(sentBody(fetch)).toEqual({ inventoryItemId: 11, reason: "fake card" });
  });

  test("report a player: sends the player's id", async () => {
    const fetch = mockApi({ "POST /api/reports": { report: { id: 2 } } });
    renderAt(<ReportDialog user={bob} />);
    await userEvent.click(screen.getByRole("button", { name: "Report player" }));
    await userEvent.type(screen.getByLabelText("Reason"), "Rude in messages");
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText(/Your report was sent/);
    expect(sentBody(fetch)).toEqual({ reportedUserId: 2, reason: "Rude in messages" });
  });

  test("a refused report shows the server's message and keeps the text", async () => {
    mockApi({ "POST /api/reports": { __status: 400, error: "You can't report yourself." } });
    renderAt(<ReportDialog user={bob} />);
    await userEvent.click(screen.getByRole("button", { name: "Report player" }));
    await userEvent.type(screen.getByLabelText("Reason"), "testing self");
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("You can't report yourself.")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).toHaveValue("testing self");
  });
});
