import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { alice, mockApi, renderAt } from "@/test/render";
import { safeNext } from "@shared/validation";
import { Login, Register, VerifyEmail } from "./Auth";

describe("Register (4.1.2)", () => {
  test("FE-01 renders every required field with a label", () => {
    renderAt(<Register />, { user: null });
    for (const label of ["Email", "Username", "Password", "City"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  test("shows validation errors without calling the API", async () => {
    const fetch = mockApi({});
    renderAt(<Register />, { user: null });
    await userEvent.type(screen.getByLabelText("Password"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("City is required.")).toBeInTheDocument();
    expect(screen.getByText(/Password needs/)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    // Only the random showcase cards were fetched; nothing was submitted.
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  test("FE-02 a valid registration redirects to the dashboard", async () => {
    mockApi({ "POST /api/auth/register": (body) => ({ user: { id: 9, ...body }, csrfToken: "t" }) });
    renderAt(<Register />, { user: null, route: "/register", path: "/register" });
    await userEvent.type(screen.getByLabelText("Email"), "new@example.test");
    await userEvent.type(screen.getByLabelText("Username"), "new_player");
    await userEvent.type(screen.getByLabelText("Password"), "Secure@1");
    await userEvent.selectOptions(screen.getByLabelText("City"), "Guelph, ON");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/dashboard"));
  });

  test("shows the server's duplicate-email error next to the field", async () => {
    mockApi({ "POST /api/auth/register": { __status: 409, error: "An account with this email already exists.", fields: { email: "An account with this email already exists." } } });
    renderAt(<Register />, { user: null });
    await userEvent.type(screen.getByLabelText("Email"), "taken@example.test");
    await userEvent.type(screen.getByLabelText("Username"), "someone");
    await userEvent.type(screen.getByLabelText("Password"), "Secure@1");
    await userEvent.selectOptions(screen.getByLabelText("City"), "Hamilton, ON");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findAllByText("An account with this email already exists.")).toHaveLength(2);
    expect(screen.getByLabelText("Email")).toHaveValue("taken@example.test"); // 5.5.2 values kept
  });
});

describe("Login (4.1.4)", () => {
  test("FE-03 rejects an empty form with visible errors", async () => {
    const fetch = mockApi({});
    renderAt(<Login />, { user: null });
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByText("Enter your email.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    // Only the random showcase cards were fetched; nothing was submitted.
    expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  test("keeps the email but clears the password after a failed login", async () => {
    mockApi({ "POST /api/auth/login": { __status: 401, error: "Email or password is incorrect." } });
    renderAt(<Login />, { user: null });
    await userEvent.type(screen.getByLabelText("Email"), "alice@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "Wrong@123");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Email or password is incorrect.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("alice@example.test");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  test("returns to the page that asked for login", async () => {
    mockApi({ "POST /api/auth/login": { user: { id: 1, username: "alice" }, csrfToken: "t" } });
    renderAt(<Login />, { user: null, route: "/login?next=%2Ftrades", path: "/login" });
    await userEvent.type(screen.getByLabelText("Email"), "alice@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "Secure@1");
    await userEvent.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/trades"));
  });

  test("never redirects off-site after login", () => {
    expect(safeNext("/search?name=x")).toBe("/search?name=x");
    expect(safeNext("//evil.example")).toBe("/dashboard");
    expect(safeNext("/\\evil.example")).toBe("/dashboard"); // browsers read "/\" like "//"
    expect(safeNext("https://evil.example")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
  });
});

describe("confirming an email address", () => {
  test("the link from the email confirms it and refreshes the signed-in player", async () => {
    const fetch = mockApi({
      "POST /api/auth/verify-email": { message: "Email confirmed. You can send trade requests now." },
      "GET /api/auth/me": { user: { ...alice, emailVerified: true } },
    });
    renderAt(<VerifyEmail />, { route: "/verify-email?token=abc" });
    expect(await screen.findByText("Email confirmed. You can send trade requests now.")).toBeInTheDocument();
    const posts = fetch.mock.calls.filter(([url]) => url === "/api/auth/verify-email");
    expect(posts).toHaveLength(1); // the link is single use, so it's sent exactly once
    expect(JSON.parse(posts[0][1].body)).toEqual({ token: "abc" });
    expect(screen.getByRole("link", { name: "Find cards near you" })).toBeInTheDocument();
  });

  test("an expired link offers a new one (or a log-in first for visitors)", async () => {
    mockApi({
      "POST /api/auth/verify-email": { error: "This confirmation link is invalid or has expired.", __status: 400 },
      "POST /api/account/verify-email": { message: "We sent a new link to alice@example.test." },
    });
    renderAt(<VerifyEmail />, { route: "/verify-email?token=old" });
    await userEvent.click(await screen.findByRole("button", { name: "Send a new link" }));
    expect(await screen.findByText("We sent a new link to alice@example.test.")).toBeInTheDocument();

    renderAt(<VerifyEmail />, { route: "/verify-email?token=old", user: null });
    expect(await screen.findByRole("link", { name: "Log in to send a new link" })).toBeInTheDocument();
  });
});
