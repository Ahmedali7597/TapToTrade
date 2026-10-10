import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import TradeSentDialog from "./TradeSentDialog";
import TapToTradeLogo from "./TapToTradeLogo";

const trade = { id: 42, receiver: { id: 2, username: "bob", city: "Burlington, ON" } };

const renderDialog = (props = {}) =>
  render(
    <MemoryRouter>
      <TradeSentDialog trade={trade} onClose={jest.fn()} {...props} />
    </MemoryRouter>,
  );

describe("tap-to-trade animation", () => {
  test("plays the logo animation when a request is sent", () => {
    renderDialog();
    const logo = screen.getByRole("img", { name: "Tap to Trade" });
    expect(logo).toHaveClass("ttt-logo--animated");
    expect(logo).not.toHaveClass("ttt-logo--replay");
    expect(screen.getByRole("heading", { name: "Trade request sent" })).toBeInTheDocument();
    expect(screen.getByText(/not that the trade is complete/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View proposal" })).toHaveAttribute("href", "/trades/42");
  });

  test("Replay remounts the logo as an explicit replay (plays even with reduced motion)", async () => {
    renderDialog();
    const first = screen.getByRole("img", { name: "Tap to Trade" });
    await userEvent.click(screen.getByRole("button", { name: /Replay animation/ }));
    const second = screen.getByRole("img", { name: "Tap to Trade" });
    expect(second).not.toBe(first);
    expect(second).toHaveClass("ttt-logo--replay");
  });

  test("counter-offers get their own title and nothing renders without a trade", () => {
    const { unmount } = renderDialog({ counter: true });
    expect(screen.getByRole("heading", { name: "Counter-offer sent" })).toBeInTheDocument();
    unmount();
    const { container } = render(<TradeSentDialog trade={null} onClose={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("clicking any logo replays it, even a static one", async () => {
    render(<TapToTradeLogo animate={false} />);
    const logo = screen.getByRole("img", { name: "Tap to Trade" });
    const row = logo.firstElementChild;
    await userEvent.click(logo);
    expect(logo).toHaveClass("ttt-logo--animated", "ttt-logo--replay");
    expect(logo.firstElementChild).not.toBe(row); // remounted, so the CSS animation restarts
  });

  test("the static logo keeps its accessible name and skips motion", () => {
    render(<TapToTradeLogo animate={false} />);
    expect(screen.getByRole("img", { name: "Tap to Trade" })).toHaveClass("ttt-logo--still");
  });
});
