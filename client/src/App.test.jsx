import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import { NotFound, ScrollToTop } from "./App";

function GoTo({ to }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>go {to}</button>;
}

// Regression: current Chromium's window.scrollTo returns a Promise. Returning it from an effect made
// React call it as a cleanup ("destroy is not a function") and blanked the app after login.
test("ScrollToTop survives navigation when scrollTo returns a Promise", async () => {
  window.scrollTo = jest.fn(() => Promise.resolve());
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <ScrollToTop />
      <GoTo to="/dashboard" />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button"));
  expect(window.scrollTo).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button")).toBeInTheDocument();
});

test("the 404 page says the trade failed to happen, and screen readers hear 'Page not found' first", () => {
  render(
    <MemoryRouter>
      <NotFound />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Page not found. I guess the trade failed to happen");
  expect(screen.getByText("404")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("link", { name: "Search cards" })).toHaveAttribute("href", "/search");
  expect(document.title).toBe("Page not found · Tap to Trade"); // the browser tab says so too
});
