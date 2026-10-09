import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Input } from "@/components/ui/input";
import { api, qs } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The name with the part the player typed in bold, like Moxfield's suggestions. */
function Highlight({ name, typed }) {
  const at = name.toLowerCase().indexOf(typed.trim().toLowerCase());
  if (at < 0 || !typed.trim()) return name;
  const end = at + typed.trim().length;
  return (
    <>
      {name.slice(0, at)}
      <strong className="font-semibold text-foreground">{name.slice(at, end)}</strong>
      {name.slice(end)}
    </>
  );
}

/**
 * A card-name text box that suggests names as you type, from Scryfall's autocomplete through /api/cards/autocomplete.
 * It follows the ARIA combobox pattern: arrow keys move through the list, Enter picks, Escape closes it.
 * Picking a name fills the box and submits its form, so each page keeps its usual search code. Takes the same
 * props as Input (`value` and `onChange` are required).
 */
export default function CardNameInput({ value, onChange, onKeyDown, onBlur, className, ...props }) {
  const listId = useId();
  const input = useRef(null);
  const [names, setNames] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef(false); // only suggest after the player types, not when a page fills the box itself

  // Ask for suggestions after a short pause in typing. Replies to older text are ignored.
  useEffect(() => {
    const q = value.trim();
    if (!typed.current || q.length < 2) return setNames([]);
    let live = true;
    const wait = setTimeout(() => {
      api(`/cards/autocomplete${qs({ q })}`)
        .then(({ names }) => {
          if (!live) return;
          setNames(names);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => {}); // suggestions are optional; the search itself still works
    }, 150);
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [value]);

  // Keep the highlighted name visible when the arrow keys move past the bottom of the list.
  useEffect(() => {
    if (active >= 0) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const pick = (name) => {
    typed.current = false;
    setOpen(false);
    // Commit the new value before submitting, so the form's submit handler sees it.
    flushSync(() => onChange({ target: { value: name } }));
    input.current?.form?.requestSubmit();
  };

  const shown = open && names.length > 0;
  const keys = (e) => {
    onKeyDown?.(e);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!names.length) return;
      e.preventDefault();
      setOpen(true);
      // -1 means "back in the text box": Down from the last name, or Up from the first, returns there.
      if (e.key === "ArrowDown") setActive((i) => (i === names.length - 1 ? -1 : i + 1));
      else setActive((i) => (i === -1 ? names.length - 1 : i - 1));
    } else if (e.key === "Enter" && shown && active >= 0) {
      e.preventDefault();
      pick(names[active]);
    } else if (e.key === "Escape" && shown) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => {
          typed.current = true;
          onChange(e);
        }}
        onKeyDown={keys}
        onBlur={(e) => {
          setOpen(false);
          onBlur?.(e);
        }}
        {...props}
      />
      {shown && (
        <ul id={listId} role="listbox" aria-label="Card name suggestions" className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
          {names.map((name, i) => (
            <li
              key={name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              aria-label={name} // the bold part splits the text; this keeps the name whole for screen readers
              // Keep focus in the box, so the list doesn't close before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(name)}
              className={cn("cursor-pointer truncate rounded-md px-3 py-2 text-sm text-muted-foreground", i === active && "bg-accent text-accent-foreground")}
            >
              <Highlight name={name} typed={value} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
