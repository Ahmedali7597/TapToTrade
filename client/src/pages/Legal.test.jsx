import { screen } from "@testing-library/react";
import { renderAt } from "@/test/render";
import { Terms } from "./Legal";

test("the terms have a Safety section about meeting other users", () => {
  renderAt(<Terms />);
  expect(screen.getByRole("heading", { level: 2, name: "Safety" })).toHaveAttribute("id", "safety");
  expect(
    screen.getByText(
      "Meeting other users: Tap to Trade helps you arrange in-person trades, but any meetup is entirely your own responsibility. Meet in a public place such as a partner game store, and users under 18 should bring a parent or guardian.",
    ),
  ).toBeInTheDocument();
});
