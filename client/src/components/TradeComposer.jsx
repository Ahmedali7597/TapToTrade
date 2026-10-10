import { useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CardImage, ConditionBadge, EmptyState, ErrorAlert, FinishBadge, printingLabel, shake } from "@/components/common";
import { cn } from "@/lib/utils";

// The logo arrow, reused as the icon on the send button.
const TAP_ICON = "/brand/curved-arrow.svg";

/** Turns { itemId: qty } into API lines, dropping zeros. */
export const toLines = (picked) =>
  Object.entries(picked)
    .filter(([, q]) => q > 0)
    .map(([id, quantity]) => ({ inventoryItemId: Number(id), quantity }));

// Total number of cards picked on one side.
const total = (picked) => Object.values(picked).reduce((sum, q) => sum + q, 0);

// -/+ buttons around a number box. The value is clamped between 0 and what the owner has.
function Stepper({ item, value, onChange, verb }) {
  const set = (n) => onChange(Math.max(0, Math.min(item.quantity, Number.isFinite(n) ? n : 0)));
  const label = `${verb} quantity of ${item.printing.name}`;
  return (
    <div className="flex items-center gap-1">
      <Button type="button" variant="outline" size="icon-sm" onClick={() => set(value - 1)} disabled={value === 0} aria-label={`Decrease ${label}`}>
        <Minus />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={item.quantity}
        value={value}
        onChange={(e) => set(parseInt(e.target.value, 10))}
        aria-label={label}
        className="h-8 w-14 text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <Button type="button" variant="outline" size="icon-sm" onClick={() => set(value + 1)} disabled={value >= item.quantity} aria-label={`Increase ${label}`}>
        <Plus />
      </Button>
    </div>
  );
}

// One side of the trade: a scrollable list of listings, each with a quantity stepper.
// A filter box shows up once the list is long enough to need it.
function PickList({ title, description, items, picked, setPicked, verb, emptyText }) {
  const [filter, setFilter] = useState("");
  const shown = useMemo(
    () => items.filter((i) => i.printing.name.toLowerCase().includes(filter.trim().toLowerCase())),
    [items, filter],
  );
  const id = verb.toLowerCase();
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.length > 6 && (
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-filter`} className="sr-only">
              Filter {title}
            </Label>
            <Input id={`${id}-filter`} placeholder="Filter by card name" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        )}
        {items.length === 0 ? (
          <EmptyState title={emptyText} />
        ) : (
          <ul className="grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
            {shown.map((item) => {
              const value = picked[item.id] ?? 0;
              return (
                <li
                  key={item.id}
                  className={cn("flex items-center gap-3 rounded-lg border bg-background p-2 transition-colors", value > 0 && "border-primary bg-accent/50")}
                >
                  <CardImage
                    name={item.printing.name}
                    setCode={item.printing.setCode}
                    imageUrl={item.printing.imageUrl}
                    finish={item.finish}
                    printingId={item.printing.id}
                    siblings={shown.map((x) => x.printing.id)}
                    className="w-10 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.printing.name}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {printingLabel(item.printing)} <ConditionBadge condition={item.condition} /> <FinishBadge finish={item.finish} /> {item.quantity} available
                    </p>
                  </div>
                  <Stepper item={item} value={value} verb={verb} onChange={(q) => setPicked((p) => ({ ...p, [item.id]: q }))} />
                </li>
              );
            })}
            {shown.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">No cards match that filter.</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Builds a proposal with one owner at a time (mockup 6/7 direction): "You receive" from their shared
 * inventory, optional "You give" from yours. Entered values survive a failed submit (5.5.2).
 */
export default function TradeComposer({
  counterpart,
  theirItems,
  myItems,
  initialRequested = {},
  initialOffered = {},
  stores = [],
  initialMeetupStoreId = "",
  submitLabel = "Tap to trade",
  onSubmit,
}) {
  const [requested, setRequested] = useState(initialRequested);
  const [offered, setOffered] = useState(initialOffered);
  const [message, setMessage] = useState("");
  const [meetupStoreId, setMeetupStoreId] = useState(String(initialMeetupStoreId ?? ""));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // The send button shakes if there's nothing to send yet.
  const sendButton = useRef(null);

  // Catch the "nothing requested" case here; everything else is checked by the server.
  // On failure the picks stay as they were so the user can fix and resend.
  const submit = async (e) => {
    e.preventDefault();
    if (total(requested) === 0) {
      setError(new Error("Choose at least one card you want to receive."));
      shake(sendButton.current);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        requested: toLines(requested),
        offered: toLines(offered),
        message,
        ...(meetupStoreId && { meetupStoreId: Number(meetupStoreId) }),
      });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <ErrorAlert error={error} title="The proposal wasn't sent" />
      <div className="grid gap-6 lg:grid-cols-2">
        <PickList
          title={`You receive from ${counterpart.username}`}
          description={`Cards ${counterpart.username} has shared in ${counterpart.city}.`}
          items={theirItems}
          picked={requested}
          setPicked={setRequested}
          verb="Request"
          emptyText="This player has no shared cards right now."
        />
        <PickList
          title="You give (optional)"
          description="Offer cards from your own inventory in return. You can also send a request-only proposal."
          items={myItems}
          picked={offered}
          setPicked={setOffered}
          verb="Offer"
          emptyText="Your inventory is empty, so this will be a request-only proposal."
        />
      </div>

      {/* Sticky footer with the message box, running totals and the send button. */}
      <Card className="sticky bottom-3 mt-6 gap-4 border-primary/30 shadow-lg">
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div className="grid gap-3">
            {/* Partner game stores near you: official, public places to meet. Hidden when there are none nearby. */}
            {stores.length > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="meetup-spot">Meetup spot (optional)</Label>
                <NativeSelect id="meetup-spot" value={meetupStoreId} onChange={(e) => setMeetupStoreId(e.target.value)} className="w-full">
                  <NativeSelectOption value="">Decide in the message</NativeSelectOption>
                  {stores.map((s) => (
                    <NativeSelectOption key={s.id} value={String(s.id)}>
                      {s.name} · {s.city}
                      {s.distanceKm === 0 ? " (your city)" : s.distanceKm != null ? ` (${s.distanceKm} km)` : ""}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="trade-message">Message (optional, plain text)</Label>
              <Textarea
                id="trade-message"
                maxLength={500}
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="e.g. Happy to meet at the Hamilton library on Saturday afternoon."
              />
            </div>
          </div>
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="trade-summary">
              You receive <strong className="text-foreground">{total(requested)}</strong> · You give{" "}
              <strong className="text-foreground">{total(offered)}</strong>
              {total(offered) === 0 && " (request only)"}
            </p>
            <Button ref={sendButton} type="submit" size="lg" disabled={busy} className="gap-2">
              <img src={TAP_ICON} alt="" className="size-5 brightness-0 invert dark:invert-0" />
              {busy ? "Sending…" : submitLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
