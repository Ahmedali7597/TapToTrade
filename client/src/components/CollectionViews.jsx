import { EyeOff, Minus, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardImage, FinishBadge, printingLabel } from "@/components/common";
import { cad } from "@/lib/prices";
import { cn } from "@/lib/utils";

// The picture views for the inventory and deck pages, after Moxfield and Archidekt: a grid of card images, and
// "stacks", where each group is a column of overlapping cards showing just their title bars, the way deck sites show
// a Commander deck. Leave out onQuantity / onEdit for a read-only view. Badges sit on the card's outside corner or
// below it, so they never cover its name or mana cost.

const priceFor = (prices, item) => prices?.prices[`${item.printing.id}:${item.finish}`]?.cad ?? null;
const countOf = (items) => items.reduce((n, i) => n + i.quantity, 0);
function valueOf(prices, items) {
  let sum = 0;
  for (const i of items) sum += (priceFor(prices, i) ?? 0) * i.quantity;
  return Math.round(sum * 100) / 100;
}

/** Group heading: "Creatures  12 · CA$40.10". Hidden when the collection isn't grouped. */
function GroupHeading({ group, prices, grouped }) {
  if (!grouped) return null;
  const value = valueOf(prices, group.items);
  return (
    <h3 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
      <span className="truncate">{group.label}</span>
      <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
        {countOf(group.items)}
        {value > 0 && ` · ${cad(value)}`}
      </span>
    </h3>
  );
}

/** "×3" on the card's top-left outside corner, clear of the name. */
function CountBadge({ n, inline = false }) {
  return (
    <span className={cn("pointer-events-none z-10 rounded-full bg-black/80 px-1.5 text-xs leading-5 font-bold text-white ring-2 ring-background tabular-nums", !inline && "absolute -top-1.5 -left-2")}>
      ×{n}
    </span>
  );
}

// Tile widths for the S / M / L card size switch.
const GRID_MIN = { s: "7.5rem", m: "10rem", l: "13.5rem" };
const STACK_W = { s: "9rem", m: "11.5rem", l: "14.5rem" };

/** A selection checkbox laid over a card in select mode. */
function SelectBox({ item, selected, onToggle }) {
  return (
    <label className={cn("absolute inset-0 z-20 cursor-pointer rounded-[4.5%/3.25%]", selected && "ring-4 ring-primary")}>
      <input type="checkbox" checked={selected} onChange={() => onToggle(item.id)} className="absolute top-2 right-2 size-5 accent-primary" />
      <span className="sr-only">Select {item.printing.name}</span>
    </label>
  );
}

function CardTile({ item, prices, siblings, selecting, selected, onToggle, onEdit, onQuantity, busy }) {
  const p = item.printing;
  const price = priceFor(prices, item);
  return (
    <li className="group grid min-w-0 content-start gap-1.5">
      <div className="relative">
        <CardImage name={p.name} setCode={p.setCode} imageUrl={p.imageUrl} finish={item.finish} printingId={p.id} siblings={siblings} className="w-full" />
        {item.quantity > 1 && <CountBadge n={item.quantity} />}
        {selecting && <SelectBox item={item} selected={selected} onToggle={onToggle} />}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-semibold" title={p.name}>
          {p.name}
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate" title={p.setName}>
            {printingLabel(p)}
          </span>
          <span>{item.condition}</span>
          <FinishBadge finish={item.finish} />
          {item.available === false && (
            <span className="inline-flex items-center gap-0.5">
              <EyeOff className="size-3" aria-hidden="true" /> Private
            </span>
          )}
        </p>
        <div className="mt-1 flex items-center justify-between gap-1">
          <span className="text-sm whitespace-nowrap tabular-nums">{price != null ? cad(price) : <span className="text-muted-foreground">No price</span>}</span>
          {!selecting && (onQuantity || onEdit) && (
            <span className="flex items-center">
              <Button size="icon" variant="ghost" className="size-7" disabled={busy || item.quantity <= 1} onClick={() => onQuantity(item, -1)} aria-label={`One fewer ${p.name}`}>
                <Minus aria-hidden="true" />
              </Button>
              <Button size="icon" variant="ghost" className="size-7" disabled={busy || item.quantity >= 9999} onClick={() => onQuantity(item, 1)} aria-label={`One more ${p.name}`}>
                <Plus aria-hidden="true" />
              </Button>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => onEdit(item)} aria-label={`Edit ${p.name}`}>
                <Pencil aria-hidden="true" />
              </Button>
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/** Card images in a grid, a section per group. */
export function GridView({ groups, size = "m", ...tile }) {
  const grouped = groups.length > 1 || groups[0]?.label !== "All cards";
  return (
    <div className="grid gap-8" data-testid="inventory-list">
      {groups.map((g) => (
        <section key={g.label} aria-label={grouped ? g.label : undefined}>
          <GroupHeading group={g} prices={tile.prices} grouped={grouped} />
          <ul className="grid gap-x-3 gap-y-5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(${GRID_MIN[size]}, 100%), 1fr))` }}>
            {g.items.map((item) => (
              <CardTile key={item.id} item={item} selected={tile.selection?.has(item.id)} busy={tile.busyIds?.has(item.id)} {...tile} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Deck-style stacks: a column per group with the cards overlapped so only each title bar shows. Hovering or
 * focusing a card brings the whole card to the front; clicking zooms in, the pencil edits.
 */
export function StacksView({ groups, size = "m", prices, siblings, selecting, selection, onToggle, onEdit }) {
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-8" data-testid="inventory-list">
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label} className="max-w-full shrink-0" style={{ width: STACK_W[size] }}>
          <GroupHeading group={g} prices={prices} grouped />
          <ul>
            {g.items.map((item, n) => (
              <li key={item.id} className="group relative hover:z-30 focus-within:z-30" style={{ marginTop: n ? "-122%" : 0 }}>
                <CardImage
                  name={item.printing.name}
                  setCode={item.printing.setCode}
                  imageUrl={item.printing.imageUrl}
                  finish={item.finish}
                  printingId={item.printing.id}
                  siblings={siblings}
                  className="w-full"
                />
                <span className="pointer-events-none absolute -top-1.5 -left-2 z-10 flex gap-0.5">
                  {item.quantity > 1 && <CountBadge n={item.quantity} inline />}
                  {item.available === false && (
                    <span className="inline-flex items-center rounded-full bg-black/80 px-1.5 leading-5 text-white ring-2 ring-background" title="Private">
                      <EyeOff className="size-3" aria-hidden="true" />
                      <span className="sr-only">Private</span>
                    </span>
                  )}
                </span>
                {selecting ? (
                  <SelectBox item={item} selected={selection.has(item.id)} onToggle={onToggle} />
                ) : (
                  onEdit && (
                  <Button
                    size="icon"
                    variant="secondary"
                    className="absolute top-[1.5%] right-[2%] z-10 size-7 opacity-0 shadow group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    onClick={() => onEdit(item)}
                    aria-label={`Edit ${item.printing.name}`}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  )
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
