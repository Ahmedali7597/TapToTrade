import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderAt } from "@/test/render";
import EmailEditor from "./EmailEditor";

const admin = { id: 9, username: "boss", email: "boss@example.test", city: "Hamilton, ON", role: "admin" };

test("admins see a live preview of their text in the email, save it, and send themselves a test", async () => {
  const fetch = mockApi({
    "GET /api/admin/emails": { texts: { footer: { body: "Proud partner of The Mana Vault.", updatedAt: "2026-10-01T12:00:00Z", updatedBy: "boss" } }, site: "https://taptotrade.ca" },
    "PUT /api/admin/emails/welcome": { ok: true },
    "POST /api/admin/emails/welcome/test": { message: "Test sent to boss@example.test." },
  });
  renderAt(<EmailEditor />, { user: admin });
  expect(await screen.findByText("Welcome to Tap to Trade, boss")).toBeInTheDocument(); // the subject line
  const preview = () => screen.getByTitle("Preview of the Welcome email").getAttribute("srcdoc");
  expect(preview()).toContain("Proud partner of The Mana Vault.");

  await userEvent.type(screen.getByLabelText(/Your text/), "Thanks {{username}!");
  expect(preview()).toContain("Thanks boss!");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved. New emails include this text.")).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls.find(([url, init]) => init?.method === "PUT")[1].body)).toEqual({ body: "Thanks {username}!" });

  await userEvent.click(screen.getByRole("button", { name: "Send me a test" }));
  expect(await screen.findByText("Test sent to boss@example.test.")).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText("Email"), "Footer on every email (customized)");
  expect(screen.getByLabelText("Footer text")).toHaveValue("Proud partner of The Mana Vault.");
});
