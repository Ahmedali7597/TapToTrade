import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import Suggestions from "./Suggestions";

test("a too-short suggestion is caught before sending; a good one shows a green check and joins the list", async () => {
  const sent = [];
  const fetch = mockApi({
    "GET /api/suggestions/mine": () => ({ suggestions: sent }),
    "POST /api/suggestions": (body) => {
      sent.unshift({ id: 1, ...body, status: "new", createdAt: "2026-10-01T12:00:00Z" });
      return { suggestion: sent[0], __status: 201 };
    },
  });
  renderAt(<Suggestions />);
  expect(await screen.findByText("Nothing sent yet")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Your suggestion"), "short");
  await userEvent.click(screen.getByRole("button", { name: "Send suggestion" }));
  expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

  await userEvent.click(screen.getByRole("button", { name: "Card data" }));
  await userEvent.type(screen.getByLabelText("Your suggestion"), " please, Doctor Doom is missing a printing.");
  await userEvent.click(screen.getByRole("button", { name: "Send suggestion" }));
  expect(await screen.findByText("Thanks! Your suggestion is on its way to the moderators.")).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "POST")[1].body)).toMatchObject({ topic: "cards" });
  expect(await screen.findByText("Waiting to be read")).toBeInTheDocument();
  expect(screen.getByLabelText("Your suggestion")).toHaveValue("");
});
