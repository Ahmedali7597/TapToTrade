import { useState } from "react";
import { Loader2, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardImage, ErrorAlert, Field, printingLabel } from "@/components/common";
import CardNameInput from "@/components/CardNameInput";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FINISH_LABELS } from "@shared/validation";

/**
 * Card name search plus every printing as a radio tile. Used by "Add a card" and the want list. Render it
 * outside the parent's <form> (it has its own search form, so Enter searches instead of submitting), and
 * give it a new `key` to clear it. `onChange(printing)` fires when a printing is picked. A second picker on
 * the same page needs its own `idPrefix`.
 */
export default function PrintingPicker({ value, onChange, error, idPrefix = "" }) {
  const [q, setQ] = useState("");
  const inputId = idPrefix ? `${idPrefix}-q` : "q";
  const [printings, setPrintings] = useState(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState(null);
  const [searchError, setSearchError] = useState(null);

  // Look the card up on Scryfall (through our API) and show every printing.
  const find = async (e) => {
    e.preventDefault();
    if (q.trim().length < 2) {
      setProblem("Type at least two characters.");
      return;
    }
    setSearching(true);
    setProblem(null);
    setSearchError(null);
    try {
      setPrintings((await api(`/cards/search?q=${encodeURIComponent(q.trim())}`)).printings);
    } catch (err) {
      setSearchError(err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="grid gap-5">
      <ErrorAlert error={searchError} title="Card search didn't work" />
      <form onSubmit={find} className="flex items-end gap-2" role="search">
        <Field id={inputId} label="Card name" className="flex-1" error={problem}>
          <CardNameInput id={inputId} value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={!!problem} aria-describedby={problem ? `${inputId}-error` : undefined} placeholder="e.g. Sol Ring" />
        </Field>
        <Button type="submit" variant="secondary" disabled={searching} className="gap-2">
          {searching ? <Loader2 className="animate-spin" aria-hidden="true" /> : <SearchIcon aria-hidden="true" />} Find
        </Button>
      </form>

      {/* Printings are radio buttons styled as tiles. The real radio is visually hidden but still keyboard-usable. */}
      {printings && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Choose a printing</legend>
          {printings.length === 0 && <p className="text-sm text-muted-foreground">No printings matched “{q}”.</p>}
          <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {printings.map((p) => (
              <label
                key={p.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border bg-background p-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                  value === p.id && "border-primary bg-accent/60",
                )}
              >
                <input type="radio" name={idPrefix ? `${idPrefix}-printing` : "printingId"} value={p.id} checked={value === p.id} onChange={() => onChange(p)} className="sr-only" />
                <CardImage name={p.name} setCode={p.setCode} imageUrl={p.imageUrl} className="w-10 shrink-0" />
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.setName} · {printingLabel(p)}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{p.finishes.map((x) => FINISH_LABELS[x]).join(" / ")}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
