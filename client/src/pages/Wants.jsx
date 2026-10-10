import { useState } from "react";
import { Link } from "react-router";
import { ArrowLeftRight, MapPin, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CardImage, EmptyState, ErrorAlert, Field, FinishBadge, FinishSelect, PageHeader, printingLabel, Reputation, Spinner, StoreBadge, SuccessMark, SuccessMessage, useApi } from "@/components/common";
import PrintingPicker from "@/components/PrintingPicker";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { distanceLabel } from "@/components/ListingCard";
import { RADII } from "@shared/cities";
import { FINISHES, parseQuantity } from "@shared/validation";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Pick a card, then whether any printing will do, the finish and how many. */
function AddWantForm({ onAdded }) {
  const [chosen, setChosen] = useState(null);
  const [round, setRound] = useState(0);
  const [form, setForm] = useState({ quantity: "1", finish: "any", anyPrinting: true });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(null);

  const add = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!chosen) errors.printingId = "Choose a card from the results.";
    if (parseQuantity(form.quantity) === null) errors.quantity = "Enter a whole number from 1 to 9999.";
    setFields(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const { want } = await api("/wants", { method: "POST", body: { ...form, printingId: chosen.id, quantity: parseQuantity(form.quantity) } });
      onAdded(want);
      setAdded(want.printing.name);
      setForm({ quantity: "1", finish: "any", anyPrinting: true });
      setChosen(null);
      setRound((n) => n + 1);
    } catch (err) {
      setFields(err.fields);
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a card you want</CardTitle>
        <CardDescription>Pick any printing. Unless you say otherwise, every printing of that card counts.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <ErrorAlert error={error} title="Card not added" />
        <PrintingPicker
          key={round}
          idPrefix="want"
          value={chosen?.id}
          error={fields.printingId}
          onChange={(p) => {
            setChosen(p);
            // An exact printing can only be wanted in a finish it was made in.
            setForm((f) => ({ ...f, finish: f.anyPrinting || f.finish === "any" || p.finishes.includes(f.finish) ? f.finish : "any" }));
          }}
        />
        <form onSubmit={add} noValidate className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="want-quantity"
              label="How many"
              type="number"
              min={1}
              max={9999}
              inputMode="numeric"
              value={form.quantity}
              error={fields.quantity}
              onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
            />
            <Field id="want-finish" label="Finish" error={fields.finish}>
              <FinishSelect anyLabel="Any finish"
                id="want-finish"
                value={form.finish}
                finishes={form.anyPrinting ? FINISHES : chosen?.finishes}
                onChange={(e) => setForm((f) => ({ ...f, finish: e.target.value }))}
              />
            </Field>
            <div className="flex items-center gap-3 sm:pt-6">
              <Switch
                id="want-any"
                checked={!form.anyPrinting}
                onCheckedChange={(exact) =>
                  setForm((f) => ({ ...f, anyPrinting: !exact, finish: exact && chosen && f.finish !== "any" && !chosen.finishes.includes(f.finish) ? "any" : f.finish }))
                }
              />
              <Label htmlFor="want-any">This printing only</Label>
            </div>
          </div>
          <Button type="submit" disabled={busy} className="sm:justify-self-start">
            {busy ? "Adding…" : "Add to want list"}
          </Button>
          {added && <SuccessMessage>Added {added} to your want list.</SuccessMessage>}
        </form>
      </CardContent>
    </Card>
  );
}

// One want with quick edits. `nearby` is how many players in range list it.
function WantRow({ want, nearby, onSaved, onDeleted }) {
  const [draft, setDraft] = useState({ quantity: String(want.quantity), finish: want.finish ?? "any" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const dirty = draft.quantity !== String(want.quantity) || draft.finish !== (want.finish ?? "any");
  const idp = `want-${want.id}`;

  const save = async () => {
    const quantity = parseQuantity(draft.quantity);
    if (quantity === null) return setError(new Error("Quantity must be a whole number from 1 to 9999."));
    setBusy(true);
    setError(null);
    try {
      onSaved((await api(`/wants/${want.id}`, { method: "PATCH", body: { quantity, finish: draft.finish } })).want);
      setSaved((n) => n + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api(`/wants/${want.id}`, { method: "DELETE" });
      onDeleted(want.id);
    } catch (err) {
      setError(err);
    }
  };

  return (
    <li className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-4">
        <CardImage
          name={want.printing.name}
          setCode={want.printing.setCode}
          imageUrl={want.printing.imageUrl}
          finish={want.finish}
          printingId={want.printing.id}
          className="w-14 shrink-0"
        />
        <div className="min-w-40 flex-1">
          <p className="font-semibold">{want.printing.name}</p>
          <p className="text-sm text-muted-foreground">
            {want.anyPrinting ? "Any printing" : `${want.printing.setName ?? ""} · ${printingLabel(want.printing)} only`}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <FinishBadge finish={want.finish} />
            {nearby > 0 && (
              <Badge variant="outline" className="border-primary/30 text-primary">
                {plural(nearby, "player")} nearby {nearby === 1 ? "has" : "have"} it
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor={`${idp}-qty`} className="text-xs">
              Qty
            </Label>
            <Input id={`${idp}-qty`} type="number" min={1} max={9999} className="w-20" value={draft.quantity} onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))} />
          </div>
          <div className="grid min-w-32 gap-1">
            <Label htmlFor={`${idp}-finish`} className="text-xs">
              Finish
            </Label>
            <FinishSelect anyLabel="Any finish"
              id={`${idp}-finish`}
              value={draft.finish}
              finishes={want.anyPrinting ? FINISHES : want.printing.finishes}
              onChange={(e) => setDraft((d) => ({ ...d, finish: e.target.value }))}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={!dirty || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {saved > 0 && !dirty && <SuccessMark key={saved} className="size-8 self-center p-1" />}
            <Button size="sm" variant="ghost" aria-label={`Remove ${want.printing.name} from your want list`} onClick={remove}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-sm font-medium text-destructive">{error.message}</p>}
    </li>
  );
}

// A row of small cards for one side of a match.
function MatchCards({ items }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((i) => (
        <li key={i.id} className="w-16">
          <CardImage
            name={i.printing.name}
            setCode={i.printing.setCode}
            imageUrl={i.printing.imageUrl}
            finish={i.finish}
            printingId={i.printing.id}
            siblings={items.map((x) => x.printing.id)}
            className="w-full"
          />
          <span className="sr-only">
            {i.quantity} × {i.printing.name}, {i.condition}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One nearby player: what they have that you want, what they want that you have, and a prefilled proposal. */
function MatchCard({ match }) {
  const { player, theyHave, theyWant } = match;
  // Start the proposal with one of each matching card; the composer lets you change quantities.
  const proposal = `/trades/new${qs({
    to: player.username,
    item: theyHave.map((i) => i.id).join(","),
    offer: theyWant.map((i) => i.id).join(","),
  })}`;
  return (
    <article className="pocket flex flex-col gap-4 p-5 pt-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to={`/u/${player.username}`} className="font-display text-lg font-semibold text-primary underline-offset-4 hover:underline">
          {player.username}
        </Link>
        <StoreBadge store={player.store} />
        {match.mutual && (
          <Badge variant="outline" className="gap-1 border-rare-ink/25 bg-rare text-rare-ink">
            <ArrowLeftRight aria-hidden="true" /> Trade both ways
          </Badge>
        )}
        <span className="flex w-full flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-0.5">
            <MapPin className="size-3.5" aria-hidden="true" /> {player.city}
          </span>
          {distanceLabel(match.distanceKm) && <span>{distanceLabel(match.distanceKm)}</span>}
          <Reputation reputation={player.reputation} />
        </span>
      </header>
      {theyHave.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Has {plural(theyHave.length, "card")} you want</h3>
          <MatchCards items={theyHave} />
        </section>
      )}
      {theyWant.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Wants {plural(theyWant.length, "card")} you have</h3>
          <MatchCards items={theyWant} />
        </section>
      )}
      {theyHave.length > 0 && (
        <Button asChild size="sm" className="mt-auto gap-2 self-start">
          <Link to={proposal}>
            <img src="/brand/curved-arrow.svg" alt="" className="size-4 brightness-0 invert dark:invert-0" />
            Propose a trade
          </Link>
        </Button>
      )}
    </article>
  );
}

/** Want list (Deckbox/Tradeit style): cards you're looking for, and who near you can trade them. */
export default function Wants() {
  const { user } = useAuth();
  const [radius, setRadius] = useState(RADII.includes(user.travelKm) ? user.travelKm : 100);
  const wants = useApi("/wants");
  const matches = useApi(`/wants/matches${qs({ radius })}`);
  const [list, setList] = useState(null);
  const items = list ?? wants.data?.wants ?? [];
  // Edits change the list locally and refresh the matches, which depend on it.
  const update = (fn) => {
    setList(fn(items));
    matches.reload();
  };

  // How many nearby players list each want.
  const nearby = new Map();
  for (const m of matches.data?.players ?? []) {
    for (const id of new Set(m.theyHave.map((i) => i.wantId))) nearby.set(id, (nearby.get(id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader
        title="Want list"
        description="The cards you're looking for. We match them against what players near you share, and show you who wants cards from your binder. Players who have a card you want can see that you want it."
      />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
        <div className="grid gap-6">
          <AddWantForm onAdded={(want) => update((l) => [...l, want].sort((a, b) => a.printing.name.localeCompare(b.printing.name)))} />
          <section aria-labelledby="wants-heading">
            <h2 id="wants-heading" className="mb-3 text-xl font-semibold">
              Your wants ({items.length})
            </h2>
            <ErrorAlert error={wants.error} onRetry={wants.reload} />
            {wants.loading ? (
              <Spinner label="Loading your want list" />
            ) : items.length === 0 ? (
              <EmptyState title="Nothing on your want list yet" body="Add the cards you're hunting for and we'll tell you who nearby has them." />
            ) : (
              <ul className="grid gap-3">
                {items.map((w) => (
                  <WantRow
                    key={w.id}
                    want={w}
                    nearby={nearby.get(w.id) ?? 0}
                    onSaved={(saved) => update((l) => l.map((x) => (x.id === saved.id ? saved : x)))}
                    onDeleted={(id) => update((l) => l.filter((x) => x.id !== id))}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <section aria-labelledby="matches-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <h2 id="matches-heading" className="text-xl font-semibold">
              Matches near you
            </h2>
            <div className="grid gap-1">
              <Label htmlFor="match-radius" className="text-xs">
                Within
              </Label>
              <NativeSelect id="match-radius" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
                {RADII.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {r} km of {user.city}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <ErrorAlert error={matches.error} onRetry={matches.reload} />
          {matches.loading && !matches.data && (
            <div className="grid gap-3" aria-busy="true" aria-label="Loading matches">
              {[0, 1].map((i) => (
                <Skeleton key={i} className="h-40 rounded-xl" />
              ))}
            </div>
          )}
          {matches.data &&
            (matches.data.players.length === 0 ? (
              <EmptyState
                title={`No matches within ${matches.data.radius} km yet`}
                body="Add more wants, share more of your binder, or look further away. New listings show up here as players add them."
              />
            ) : (
              <ul className="grid gap-4">
                {matches.data.players.map((m, i) => (
                  <li key={m.player.id} className="slide-in" style={{ "--i": Math.min(i, 10) }}>
                    <MatchCard match={m} />
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </div>
    </div>
  );
}
