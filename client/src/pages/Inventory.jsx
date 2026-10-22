import { useRef, useState } from "react";
import { BookOpen, Download, Eye, EyeOff, Layers, LayoutGrid, List, Plus, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CardImage, EmptyState, ErrorAlert, Field, FinishBadge, FinishSelect, PageHeader, printingLabel, Spinner, SuccessMark, SuccessMessage, useApi } from "@/components/common";
import { Switch } from "@/components/ui/switch";
import BinderView from "@/components/BinderView";
import { GridView, StacksView } from "@/components/CollectionViews";
import ImportCollection from "@/components/ImportCollection";
import PrintingPicker from "@/components/PrintingPicker";
import { api } from "@/lib/api";
import { filterItems, GROUP_OPTIONS, groupItems, SORT_OPTIONS, sortItems, summarize } from "@/lib/collection";
import { cad } from "@/lib/prices";
import { cn } from "@/lib/utils";
import { CONDITION_LABELS, CONDITIONS, parseQuantity } from "@shared/validation";

// Dropdown of card conditions, shared by the add form and each inventory row.
function ConditionSelect({ id, value, onChange, className }) {
  return (
    <NativeSelect id={id} value={value} onChange={onChange} className={cn("w-full", className)}>
      {CONDITIONS.map((c) => (
        <NativeSelectOption key={c} value={c}>
          {CONDITION_LABELS[c]} ({c})
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Mockup 3 direction: choose a specific printing, then quantity, condition and availability. */
function AddCardForm({ onAdded }) {
  const [chosen, setChosen] = useState(null);
  // Bumped after each add so the picker starts fresh for the next card.
  const [round, setRound] = useState(0);
  const [form, setForm] = useState({ quantity: "1", condition: "NM", finish: "nonfoil", available: true });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Name of the last card added, for the green check under the button.
  const [added, setAdded] = useState(null);

  // Add the chosen printing. Quick checks happen here; the server checks everything again.
  const add = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!chosen) errors.printingId = "Choose a printing from the results.";
    if (parseQuantity(form.quantity) === null) errors.quantity = "Enter a whole number from 1 to 9999.";
    setFields(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const { item } = await api("/inventory", { method: "POST", body: { ...form, printingId: chosen.id, quantity: parseQuantity(form.quantity) } });
      onAdded(item);
      setAdded(`${item.quantity} × ${item.printing.name}`);
      // Reset for the next card, but keep condition and sharing since people often add several alike.
      setForm((f) => ({ ...f, quantity: "1", finish: "nonfoil" }));
      setChosen(null);
      setRound((n) => n + 1);
    } catch (err) {
      setFields(err.fields);
      setError(err); // entered values stay in place (5.5.2)
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5">
      <ErrorAlert error={error} title="Card not added" />
      <PrintingPicker
        key={round}
        value={chosen?.id}
        error={fields.printingId}
        onChange={(p) => {
          setChosen(p);
          setForm((f) => ({ ...f, finish: p.finishes.includes(f.finish) ? f.finish : p.finishes[0] }));
        }}
      />

      <form onSubmit={add} noValidate className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="quantity"
            label="Quantity"
            type="number"
            min={1}
            max={9999}
            inputMode="numeric"
            value={form.quantity}
            error={fields.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
          />
          <Field id="add-condition" label="Condition" error={fields.condition}>
            <ConditionSelect id="add-condition" value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))} />
          </Field>
          {/* The choices follow the selected printing; before one is picked it's just the full list. */}
          <Field id="add-finish" label="Finish" error={fields.finish}>
            <FinishSelect
              id="add-finish"
              value={form.finish}
              finishes={chosen?.finishes}
              onChange={(e) => setForm((f) => ({ ...f, finish: e.target.value }))}
            />
          </Field>
          <div className="flex items-center gap-3 sm:pt-6">
            <Switch id="available" checked={form.available} onCheckedChange={(available) => setForm((f) => ({ ...f, available }))} />
            <Label htmlFor="available">Share for trade</Label>
          </div>
        </div>
        <Button type="submit" disabled={busy} className="sm:justify-self-start">
          {busy ? "Adding…" : "Add to inventory"}
        </Button>
        {added && <SuccessMessage>Added {added} to your inventory.</SuccessMessage>}
      </form>
    </div>
  );
}

// One listing with inline editing. Changes are only sent when the user presses Save.
function InventoryRow({ item, siblings, onSaved, onDeleted, selecting, selected, onToggle }) {
  const [draft, setDraft] = useState({ quantity: String(item.quantity), condition: item.condition, finish: item.finish, available: item.available });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Shows a green check beside Save for a moment after a save goes through.
  const [saved, setSaved] = useState(0);
  // Save is only enabled when something actually changed.
  const dirty =
    draft.quantity !== String(item.quantity) ||
    draft.condition !== item.condition ||
    draft.finish !== item.finish ||
    draft.available !== item.available;
  const idp = `item-${item.id}`;

  const save = async () => {
    const quantity = parseQuantity(draft.quantity);
    if (quantity === null) return setError(new Error("Quantity must be a whole number from 1 to 9999."));
    setBusy(true);
    setError(null);
    try {
      onSaved((await api(`/inventory/${item.id}`, { method: "PATCH", body: { ...draft, quantity } })).item);
      setSaved((n) => n + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // Called from the confirm dialog below.
  const remove = async () => {
    try {
      await api(`/inventory/${item.id}`, { method: "DELETE" });
      onDeleted(item.id);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <li className={cn("rounded-xl border bg-card p-4 shadow-xs", selected && "border-primary ring-2 ring-primary/40")}>
      <div className="flex flex-wrap items-center gap-4">
        {selecting && (
          <input type="checkbox" checked={selected} onChange={() => onToggle(item.id)} aria-label={`Select ${item.printing.name}`} className="size-5 shrink-0 accent-primary" />
        )}
        <CardImage
          name={item.printing.name}
          setCode={item.printing.setCode}
          imageUrl={item.printing.imageUrl}
          finish={item.finish}
          printingId={item.printing.id}
          siblings={siblings}
          className="w-14 shrink-0"
        />
        <div className="min-w-40 flex-1">
          <p className="font-semibold">{item.printing.name}</p>
          <p className="text-sm text-muted-foreground">
            {item.printing.setName} · {printingLabel(item.printing)}
          </p>
          <div className="mt-1 flex gap-1.5">
            <FinishBadge finish={item.finish} />
            {!item.available && <Badge variant="outline">Private</Badge>}
          </div>
        </div>
        <div className="grid grid-cols-2 items-end gap-3 sm:flex">
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-qty`} className="text-xs">
              Qty
            </Label>
            <Input
              id={`${idp}-qty`}
              type="number"
              min={1}
              max={9999}
              className="w-20"
              value={draft.quantity}
              onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-cond`} className="text-xs">
              Condition
            </Label>
            <ConditionSelect id={`${idp}-cond`} value={draft.condition} onChange={(e) => setDraft((d) => ({ ...d, condition: e.target.value }))} />
          </div>
          <div className="grid min-w-28 gap-1">
            <Label htmlFor={`${idp}-finish`} className="text-xs">
              Finish
            </Label>
            <FinishSelect
              id={`${idp}-finish`}
              value={draft.finish}
              finishes={item.printing.finishes}
              onChange={(e) => setDraft((d) => ({ ...d, finish: e.target.value }))}
            />
          </div>
          <div className="flex h-9 items-center gap-2">
            <Switch id={`${idp}-avail`} checked={draft.available} onCheckedChange={(available) => setDraft((d) => ({ ...d, available }))} />
            <Label htmlFor={`${idp}-avail`} className="text-sm">
              Shared
            </Label>
          </div>
          <div className="col-span-2 flex gap-2">
            <Button size="sm" onClick={save} disabled={!dirty || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {saved > 0 && !dirty && <SuccessMark key={saved} className="size-8 self-center p-1" />}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" aria-label={`Delete ${item.printing.name}`}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {item.printing.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes the listing from your inventory. Proposals that already include it keep a snapshot of what was offered.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-destructive">{error.message}</p>}
    </li>
  );
}

// The four ways to look at a collection. Grid and Stacks follow Moxfield and Archidekt; Binder is a page-turning
// 9-pocket binder; List is the editable rows.
const VIEWS = [
  ["grid", "Grid", LayoutGrid],
  ["stacks", "Stacks", Layers],
  ["binder", "Binder", BookOpen],
  ["list", "List", List],
];
// Grid and stacks start with this many cards and add more on request, so a big import doesn't load every image.
const PAGE = 120;

/** A display choice remembered on this device (view, sort, grouping, card size). `initial` can be a function. */
function useChoice(key, initial, allowed) {
  const [value, setValue] = useState(() => {
    const fallback = typeof initial === "function" ? initial() : initial;
    try {
      const saved = localStorage.getItem(`ttt-inventory-${key}`);
      return allowed.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v) => {
    setValue(v);
    try {
      localStorage.setItem(`ttt-inventory-${key}`, v);
    } catch {
      /* not remembered, but still applied */
    }
  };
  return [value, set];
}

function Choice({ id, label, value, onChange, options, className }) {
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} className="w-full">
        {options.map(([v, text]) => (
          <NativeSelectOption key={v} value={v}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

/** Moxfield-style totals: cards, listings, shared, market value and the rarity mix. */
function Totals({ summary, pricesReady }) {
  const r = summary.rarity;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card px-4 py-2.5 text-sm shadow-xs" data-testid="inventory-totals">
      <span>
        <strong className="tabular-nums">{summary.cards.toLocaleString("en-CA")}</strong> card{summary.cards === 1 ? "" : "s"}
      </span>
      <span className="text-muted-foreground">
        {summary.listings.toLocaleString("en-CA")} listing{summary.listings === 1 ? "" : "s"} · {summary.shared.toLocaleString("en-CA")} shared
      </span>
      <span title="TCGplayer market price via Scryfall, converted at the Bank of Canada's daily rate. For reference only.">
        {pricesReady ? (
          <>
            Value ≈ <strong className="tabular-nums">{cad(summary.value)}</strong>
            {summary.unpriced > 0 && <span className="text-muted-foreground"> ({summary.unpriced} without a price)</span>}
          </>
        ) : (
          <span className="text-muted-foreground">Working out the value…</span>
        )}
      </span>
      {r.mythic + r.rare + r.uncommon + r.common > 0 && (
        <span className="text-muted-foreground">
          {r.mythic} mythic · {r.rare} rare · {r.uncommon} uncommon · {r.common} common
        </span>
      )}
    </p>
  );
}

/** "Delete collection": empties the inventory after the player types "delete". Offers the CSV export first. */
function DeleteCollection({ count, onDeleted }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/inventory", { method: "DELETE", body: { confirm: "delete" } });
      setOpen(false);
      onDeleted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setTyped("");
        setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="gap-2 text-destructive">
          <Trash2 className="size-4" aria-hidden="true" /> Delete collection
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete your whole collection?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes all {count.toLocaleString("en-CA")} listings from your inventory and can't be undone. Proposals that already include them keep a
            snapshot. You may want to{" "}
            <a href="/api/inventory/export" download className="font-medium text-primary underline underline-offset-4">
              download a CSV copy
            </a>{" "}
            first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-delete-all">Type delete to confirm</Label>
          <Input id="confirm-delete-all" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
        {error && <p className="text-sm font-medium text-destructive">{error.message}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy || typed.trim().toLowerCase() !== "delete"} onClick={remove}>
            {busy ? "Deleting…" : "Delete everything"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function Inventory() {
  const { data, error, loading, reload } = useApi("/inventory");
  const [items, setItems] = useState(null);
  // After the first load we keep our own copy and edit it in place, instead of refetching after every change.
  const list = items ?? data?.items ?? [];

  // Prices for the whole collection; asked again when cards are added or a finish changes. The last answer stays
  // on screen while a new one loads.
  const [priceRound, setPriceRound] = useState(0);
  const priced = useApi(list.length ? `/inventory/prices?round=${priceRound}` : null).data;
  const lastPrices = useRef(null);
  if (priced) lastPrices.current = priced;
  const prices = lastPrices.current;

  // The binder opens first, except on phones, where a single binder page is small and the grid reads better.
  const [view, setView] = useChoice("view", () => (window.matchMedia?.("(max-width: 639px)").matches ? "grid" : "binder"), VIEWS.map(([v]) => v));
  const [sort, setSort] = useChoice("sort", "name", SORT_OPTIONS.map(([v]) => v));
  const [group, setGroup] = useChoice("group", "type", GROUP_OPTIONS.map(([v]) => v));
  const [size, setSize] = useChoice("size", "m", ["s", "m", "l"]);
  const [q, setQ] = useState("");
  const [show, setShow] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [bulkError, setBulkError] = useState(null);

  const shown = sortItems(filterItems(list, { q, show }), sort, prices);
  // Stacks always need groups; the binder and the other views follow the chosen grouping.
  const groups = groupItems(view === "binder" ? shown : shown.slice(0, limit), view === "stacks" && group === "none" ? "type" : group);
  const siblings = shown.map((x) => x.printing.id);
  const summary = summarize(list, prices);

  const replace = (saved) => setItems(list.map((x) => (x.id === saved.id ? saved : x)));
  const toggle = (id) =>
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelection(new Set());
    setBulkError(null);
  };

  // The + and − buttons on a card.
  const changeQuantity = async (item, delta) => {
    setBusyIds((s) => new Set(s).add(item.id));
    try {
      replace((await api(`/inventory/${item.id}`, { method: "PATCH", body: { quantity: item.quantity + delta } })).item);
    } catch (err) {
      setBulkError(err);
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(item.id);
        return next;
      });
    }
  };

  // Share, hide or delete everything selected.
  const bulk = async (action) => {
    const ids = [...selection];
    setBulkError(null);
    try {
      await api("/inventory/bulk", { method: "POST", body: { ids, action } });
      const chosen = new Set(ids);
      setItems(action === "delete" ? list.filter((x) => !chosen.has(x.id)) : list.map((x) => (chosen.has(x.id) ? { ...x, available: action === "share" } : x)));
      setSelection(new Set());
    } catch (err) {
      setBulkError(err);
    }
  };

  const tileProps = { prices, siblings, selecting, selection, onToggle: toggle, onEdit: setEditing, onQuantity: changeQuantity, busyIds };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Your inventory" description="Shared cards appear in search and on your public profile. Private cards are only visible to you.">
        <div className="flex flex-wrap gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="size-4" aria-hidden="true" /> Add a card
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Add a card</DialogTitle>
                <DialogDescription>Search Scryfall for the exact printing you own.</DialogDescription>
              </DialogHeader>
              <AddCardForm
                onAdded={(item) => {
                  setItems([item, ...list]);
                  setPriceRound((n) => n + 1);
                }}
              />
            </DialogContent>
          </Dialog>
          {/* After an import, drop our local copy and reload the list from the server. */}
          <ImportCollection
            onImported={() => {
              setItems(null);
              reload();
              setPriceRound((n) => n + 1);
            }}
          />
          {list.length > 0 && (
            <Button asChild variant="outline" className="gap-2">
              <a href="/api/inventory/export" download>
                <Download className="size-4" aria-hidden="true" /> Export CSV
              </a>
            </Button>
          )}
          {list.length > 0 && (
            <DeleteCollection
              count={list.length}
              onDeleted={() => {
                setItems([]);
                stopSelecting();
              }}
            />
          )}
        </div>
      </PageHeader>

      <ErrorAlert error={error} title="Couldn't load your inventory" onRetry={reload} />
      {loading && !items ? (
        <Spinner label="Loading your cards" />
      ) : list.length === 0 ? (
        <EmptyState title="Your inventory is empty" body="Add your first card, or import your collection from Moxfield, Archidekt or another site, to start trading." />
      ) : (
        <div className="grid gap-5">
          <Card className="py-4">
            <CardContent className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="View" className="grid w-full grid-cols-4 rounded-lg border bg-muted/40 p-1 sm:inline-flex sm:w-auto">
                  {VIEWS.map(([v, text, Icon]) => (
                    <Button
                      key={v}
                      size="sm"
                      variant={view === v ? "default" : "ghost"}
                      aria-pressed={view === v}
                      onClick={() => {
                        setView(v);
                        if (v === "binder") stopSelecting();
                      }}
                      className="gap-1 px-1.5 max-sm:text-xs sm:gap-1.5 sm:px-3"
                    >
                      <Icon aria-hidden="true" /> {text}
                    </Button>
                  ))}
                </div>
                {view !== "binder" && (
                  <Button variant={selecting ? "secondary" : "outline"} size="sm" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}>
                    {selecting ? "Done selecting" : "Select cards"}
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
                <div className="col-span-2 grid gap-1 lg:col-span-1">
                  <Label htmlFor="collection-q" className="text-xs text-muted-foreground">
                    Filter
                  </Label>
                  <Input id="collection-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, set or type, e.g. goblin" />
                </div>
                <Choice
                  id="collection-show"
                  label="Show"
                  value={show}
                  onChange={setShow}
                  options={[
                    ["all", "All cards"],
                    ["shared", "Shared only"],
                    ["private", "Private only"],
                  ]}
                />
                <Choice id="collection-sort" label="Sort by" value={sort} onChange={setSort} options={SORT_OPTIONS} />
                <Choice id="collection-group" label={view === "binder" ? "Pages by" : "Group by"} value={group} onChange={setGroup} options={GROUP_OPTIONS} />
                <Choice
                  id="collection-size"
                  label="Card size"
                  value={size}
                  onChange={setSize}
                  options={[
                    ["s", "Small"],
                    ["m", "Medium"],
                    ["l", "Large"],
                  ]}
                  className={cn(!["grid", "stacks"].includes(view) && "invisible")}
                />
              </div>
            </CardContent>
          </Card>

          <Totals summary={summary} pricesReady={Boolean(prices)} />

          {selecting && (
            <div className="sticky top-20 z-40 flex flex-wrap items-center gap-2 rounded-xl border bg-card/95 px-4 py-2.5 shadow-md backdrop-blur" role="toolbar" aria-label="Selected cards">
              <span className="mr-auto text-sm font-medium">{selection.size} selected</span>
              <Button size="sm" variant="ghost" onClick={() => setSelection(new Set(shown.map((x) => x.id)))}>
                Select all {shown.length} shown
              </Button>
              <Button size="sm" variant="outline" disabled={!selection.size} onClick={() => bulk("share")} className="gap-1.5">
                <Eye aria-hidden="true" /> Share
              </Button>
              <Button size="sm" variant="outline" disabled={!selection.size} onClick={() => bulk("hide")} className="gap-1.5">
                <EyeOff aria-hidden="true" /> Make private
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={!selection.size} className="gap-1.5 text-destructive">
                    <Trash2 aria-hidden="true" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Delete {selection.size} listing{selection.size === 1 ? "" : "s"}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>This removes them from your inventory. Proposals that already include them keep a snapshot of what was offered.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => bulk("delete")}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
          <ErrorAlert error={bulkError} title="That didn't go through" />

          <section aria-labelledby="listings-heading">
            <h2 id="listings-heading" className="sr-only">
              {shown.length} listing{shown.length === 1 ? "" : "s"}
            </h2>
            {shown.length === 0 ? (
              <EmptyState title="No cards match" body="Try a different filter, or show all cards." />
            ) : view === "binder" ? (
              <BinderView key={`${q}|${show}|${sort}|${group}`} groups={groups} siblings={siblings} />
            ) : view === "stacks" ? (
              <StacksView groups={groups} size={size} {...tileProps} />
            ) : view === "grid" ? (
              <GridView groups={groups} size={size} {...tileProps} />
            ) : (
              <div className="grid gap-6">
                {groups.map((g) => (
                  <section key={g.label} aria-label={g.label}>
                    {groups.length > 1 && <h3 className="mb-2 text-sm font-semibold">{g.label}</h3>}
                    <ul className="grid gap-3" data-testid="inventory-list">
                      {g.items.map((item) => (
                        <InventoryRow
                          key={item.id}
                          item={item}
                          siblings={siblings}
                          selecting={selecting}
                          selected={selection.has(item.id)}
                          onToggle={toggle}
                          onSaved={(saved) => {
                            replace(saved);
                            setPriceRound((n) => n + 1);
                          }}
                          onDeleted={(id) => setItems(list.filter((x) => x.id !== id))}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {view !== "binder" && shown.length > limit && (
              <div className="mt-6 flex justify-center">
                <Button variant="outline" onClick={() => setLimit((n) => n + PAGE)}>
                  Show more ({shown.length - limit} left)
                </Button>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Editing from the picture views: the same fields as a list row. */}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {editing?.printing.name}</DialogTitle>
            <DialogDescription>Change the quantity, condition, finish or whether it's shared, then press Save.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ul>
              <InventoryRow
                item={list.find((x) => x.id === editing.id) ?? editing}
                siblings={[]}
                onSaved={(saved) => {
                  replace(saved);
                  setPriceRound((n) => n + 1);
                }}
                onDeleted={(id) => {
                  setItems(list.filter((x) => x.id !== id));
                  setEditing(null);
                }}
              />
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
