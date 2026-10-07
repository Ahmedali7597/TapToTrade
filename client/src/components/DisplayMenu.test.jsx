import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderAt } from "@/test/render";
import { DisplaySettings, ThemeToggle } from "./DisplayMenu";

// A stand-in for /theme-init.js, which keeps the choices and applies them to <html>.
beforeEach(() => {
  let saved = { text: "default", motion: "device", contrast: "default", links: "default" };
  let theme = "system";
  window.tttDisplay = { get: () => ({ ...saved }), set: jest.fn((k, v) => (saved = { ...saved, [k]: v })) };
  window.tttTheme = { get: () => theme, set: jest.fn((v) => (theme = v)) };
});

test("Settings: text size, theme and the on/off options are saved through theme-init", async () => {
  renderAt(<DisplaySettings />);
  await userEvent.click(screen.getByRole("button", { name: "Larger" }));
  expect(window.tttDisplay.set).toHaveBeenCalledWith("text", "larger");
  expect(screen.getByRole("button", { name: "Larger" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Dark" }));
  expect(window.tttTheme.set).toHaveBeenCalledWith("dark");
  await userEvent.click(screen.getByRole("switch", { name: /Reduce motion/ }));
  expect(window.tttDisplay.set).toHaveBeenCalledWith("motion", "reduce");
  expect(screen.getByRole("switch", { name: /Reduce motion/ })).toBeChecked();
  await userEvent.click(screen.getByRole("switch", { name: /Reduce motion/ }));
  expect(window.tttDisplay.set).toHaveBeenLastCalledWith("motion", "default");
});

test("the header button switches between light and dark and says what it will do", async () => {
  document.documentElement.dataset.theme = "light";
  renderAt(<ThemeToggle />, { user: null });
  await userEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  expect(window.tttTheme.set).toHaveBeenCalledWith("dark");
  document.documentElement.dataset.theme = "dark";
  // theme-init announces the change; the button then offers the way back.
  act(() => window.dispatchEvent(new Event("ttt:display")));
  await userEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(window.tttTheme.set).toHaveBeenLastCalledWith("light");
});
