import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CardImage, EmptyState, ErrorAlert, Field, FinishBadge, FinishSelect, PageHeader, printingLabel, Spinner, SuccessMark, SuccessMessage, useApi } from "@/components/common";
import { Switch } from "@/components/ui/switch";
import ImportCollection from "@/components/ImportCollection";
import PrintingPicker from "@/components/PrintingPicker";
import { api } from "@/lib/api";
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
    <Card>
      <CardHeader>
        <CardTitle>Add a card</CardTitle>
        <CardDescription>Search Scryfall for the exact printing you own.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
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
      </CardContent>
    </Card>
  );
}

// One listing with inline editing. Changes are only sent when the user presses Save.
function InventoryRow({ item, siblings, onSaved, onDeleted }) {
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
    <li className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-4">
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

export default function Inventory() {
  const { data, error, loading, reload } = useApi("/inventory");
  const [items, setItems] = useState(null);
  // After the first load we keep our own copy and edit it in place, instead of refetching after every change.
  const list = items ?? data?.items ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader title="Your inventory" description="Shared cards appear in search and on your public profile. Private cards are only visible to you.">
        <div className="flex flex-wrap gap-2">
          {/* After an import, drop our local copy and reload the list from the server. */}
          <ImportCollection
            onImported={() => {
              setItems(null);
              reload();
            }}
          />
          {list.length > 0 && (
            <Button asChild variant="outline" className="gap-2">
              <a href="/api/inventory/export" download>
                <Download className="size-4" aria-hidden="true" /> Export CSV
              </a>
            </Button>
          )}
        </div>
      </PageHeader>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_1fr] lg:items-start">
        <div className="lg:sticky lg:top-24">
          <AddCardForm onAdded={(item) => setItems([item, ...list])} />
        </div>
        <section aria-labelledby="listings-heading">
          <h2 id="listings-heading" className="mb-4 text-lg font-semibold">
            {list.length} listing{list.length === 1 ? "" : "s"}
          </h2>
          <ErrorAlert error={error} title="Couldn't load your inventory" onRetry={reload} />
          {loading && !items ? (
            <Spinner label="Loading your cards" />
          ) : list.length === 0 ? (
            <EmptyState title="Your inventory is empty" body="Add your first card to start trading." />
          ) : (
            <ul className="grid gap-3" data-testid="inventory-list">
              {list.map((item) => (
                <InventoryRow
                  key={item.id}
                  item={item}
                  siblings={list.map((x) => x.printing.id)}
                  onSaved={(saved) => setItems(list.map((x) => (x.id === saved.id ? saved : x)))}
                  onDeleted={(id) => setItems(list.filter((x) => x.id !== id))}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
