import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi } from "@/test/render";
import CardNameInput from "./CardNameInput";

// A form like the search pages': it records what was submitted.
function SearchForm({ onSearch }) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(name);
      }}
    >
      <label htmlFor="card">Card name</label>
      <CardNameInput id="card" value={name} onChange={(e) => setName(e.target.value)} />
    </form>
  );
}

// The typed part is in bold, which splits each option's text, so find options by their full text.
const option = (name) => screen.getAllByRole("option").find((o) => o.textContent === name);

test("suggests names as you type; arrow keys and Enter pick one and search for it", async () => {
  const fetch = mockApi({ "GET /api/cards/autocomplete": { names: ["Lightning Bolt", "Lightning Helix", "Lightning Greaves"] } });
  const onSearch = jest.fn();
  render(<SearchForm onSearch={onSearch} />);
  const box = screen.getByRole("combobox", { name: "Card name" });

  await userEvent.type(box, "l");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument(); // one letter: no request
  await userEvent.type(box, "ig");
  expect(await screen.findAllByRole("option")).toHaveLength(3);
  expect(fetch.mock.calls.at(-1)[0]).toBe("/api/cards/autocomplete?q=lig");
  expect(box).toHaveAttribute("aria-expanded", "true");

  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(option("Lightning Helix")).toHaveAttribute("aria-selected", "true");
  expect(box).toHaveAttribute("aria-activedescendant", option("Lightning Helix").id);
  await userEvent.keyboard("{Enter}");
  expect(box).toHaveValue("Lightning Helix");
  expect(onSearch).toHaveBeenCalledWith("Lightning Helix");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("clicking a suggestion searches for it; Escape closes the list and Enter searches the typed text", async () => {
  mockApi({ "GET /api/cards/autocomplete": { names: ["Sol Ring", "Solemn Simulacrum"] } });
  const onSearch = jest.fn();
  render(<SearchForm onSearch={onSearch} />);
  const box = screen.getByRole("combobox", { name: "Card name" });

  await userEvent.type(box, "sol");
  await screen.findAllByRole("option");
  await userEvent.click(option("Solemn Simulacrum"));
  expect(onSearch).toHaveBeenLastCalledWith("Solemn Simulacrum");

  await userEvent.clear(box);
  await userEvent.type(box, "sol r");
  await screen.findAllByRole("option");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  expect(onSearch).toHaveBeenLastCalledWith("sol r");
});
