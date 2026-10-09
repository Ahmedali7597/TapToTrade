import { useCallback, useState } from "react";
import { Link } from "react-router";
import { Ban, ChevronLeft, ChevronRight, CircleCheck, ExternalLink, RefreshCw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CardViewerContext, ErrorAlert, RetryImage, useApi } from "@/components/common";
import { cn } from "@/lib/utils";

// Formats in the order Moxfield lists them. Scryfall's key -> label.
const FORMATS = [
  ["alchemy", "Alchemy"], ["brawl", "Brawl"], ["commander", "Commander"],
  ["duel", "Duel"], ["future", "Future"], ["gladiator", "Gladiator"],
  ["historic", "Historic"], ["legacy", "Legacy"], ["modern", "Modern"],
  ["oathbreaker", "Oathbreaker"], ["oldschool", "Old School"], ["pauper", "Pauper"],
  ["paupercommander", "Pauper EDH"], ["penny", "Penny"], ["pioneer", "Pioneer"],
  ["predh", "PreDH"], ["premodern", "Premodern"], ["standard", "Standard"],
  ["standardbrawl", "Standard Brawl"], ["timeless", "Timeless"], ["vintage", "Vintage"],
];
const COLOURS = { W: "white", U: "blue", B: "black", R: "red", G: "green", C: "colorless", S: "snow" };

/** Spoken name for a mana or card symbol such as {2}, {U}, {W/U}, {G/P} or {T}. */
export function symbolName(code) {
  if (code === "T") return "tap";
  if (code === "Q") return "untap";
  if (code === "E") return "energy";
  if (/^\d+$/.test(code) || code === "X" || code === "Y") return `${code} generic mana`;
  const parts = code.split("/");
  if (parts.includes("P")) return `Phyrexian ${COLOURS[parts[0]] ?? parts[0]} mana`;
  return `${parts.map((p) => COLOURS[p] ?? p).join(" or ")} mana`;
}

// One {symbol} as Scryfall's symbol image, with a spoken name for screen readers.
function Symbol({ code }) {
  return (
    <RetryImage
      src={`https://svgs.scryfall.io/card-symbols/${code.replace(/\//g, "").replace("½", "HALF")}.svg`}
      alt={symbolName(code)}
      title={symbolName(code)}
      className="mx-px inline-block size-[1.05em] align-[-0.15em]"
    />
  );
}

// Plain text with its {symbols} drawn.
const withSymbols = (text) =>
  text.split(/(\{[^}]+\})/).map((part, i) => {
    const symbol = /^\{([^}]+)\}$/.exec(part);
    return symbol ? <Symbol key={i} code={symbol[1].toUpperCase()} /> : part;
  });

/** Card text with {symbols} drawn as Scryfall's symbol images and (reminder text) in italics. */
export function CardText({ text, className }) {
  return (
    <span className={className}>
      {text.split(/(\([^)]*\))/).map((part, i) => (part.startsWith("(") ? <i key={i}>{withSymbols(part)}</i> : <span key={i}>{withSymbols(part)}</span>))}
    </span>
  );
}

/** One legality: green check, a muted "not legal" mark, or a red ban for banned and restricted. */
function Legality({ label, status }) {
  const legal = status === "legal";
  const limited = status === "banned" || status === "restricted";
  return (
    <li className={cn("flex items-center gap-1.5", label === "Commander" && "font-semibold")}>
      {legal ? (
        <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
      ) : (
        <Ban className={cn("size-4 shrink-0", limited ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />
      )}
      <span className={legal ? undefined : "text-muted-foreground"}>{label}</span>
      <span className="sr-only">: {status.replace("_", " ")}</span>
      {status === "restricted" && <span className="text-xs text-destructive">(restricted)</span>}
      {status === "banned" && <span className="text-xs text-destructive">(banned)</span>}
    </li>
  );
}

const money = (value, symbol) => (value ? `${symbol}${value}` : null);

/** The zoomed-in card: big image, rules text, printing, rulings, legalities and links to Scryfall. */
function CardDetailsDialog({ ids, index, onIndex, onClose }) {
  const id = ids[index];
  const { data, error, loading, reload } = useApi(`/cards/${id}`);
  const [back, setBack] = useState(false);
  const card = data?.card;
  const hasPrev = index > 0;
  const hasNext = index < ids.length - 1;
  const go = (step) => {
    setBack(false);
    onIndex(index + step);
  };
  const keys = (e) => {
    if (e.key === "ArrowLeft" && hasPrev) go(-1);
    if (e.key === "ArrowRight" && hasNext) go(1);
  };
  const image = back ? card?.faces[1]?.imageUrl : card?.imageUrl;
  const prices = card && [money(card.prices.usd, "US$"), card.prices.usdFoil && `foil US$${card.prices.usdFoil}`, money(card.prices.eur, "€")].filter(Boolean);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton={false} onKeyDown={keys} className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-4xl" data-testid="card-details">
        {/* Previous, Next and Close, like Moxfield's card view. Arrow keys work too. */}
        <div className="sticky top-0 z-10 flex justify-end gap-2 border-b bg-background/90 px-4 py-3 backdrop-blur sm:px-6">
          {ids.length > 1 && (
            <>
              <Button variant="outline" size="sm" onClick={() => go(-1)} disabled={!hasPrev}>
                <ChevronLeft aria-hidden="true" /> Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => go(1)} disabled={!hasNext}>
                Next <ChevronRight aria-hidden="true" />
              </Button>
            </>
          )}
          <Button size="sm" onClick={onClose}>
            <X aria-hidden="true" /> Close
          </Button>
        </div>

        <div key={id} className="page-in grid gap-6 p-4 sm:p-6 md:grid-cols-[minmax(0,19rem)_1fr] md:gap-8">
          {/* Left: the card itself, its price guide and the links out. */}
          <div className="mx-auto grid w-full max-w-xs content-start gap-3">
            {loading || !card ? (
              <Skeleton className="aspect-[488/680] w-full rounded-[4.5%/3.25%]" />
            ) : (
              <div className="sleeve aspect-[488/680] w-full bg-muted shadow-[0_24px_50px_-28px_rgb(var(--shadow)/0.8)]">
                {image && <RetryImage key={image} src={image} alt={`${card.name} card image`} className="size-full object-cover" />}
              </div>
            )}
            {card?.faces[1]?.imageUrl && (
              <Button variant="outline" size="sm" onClick={() => setBack((b) => !b)} className="justify-self-center">
                <RefreshCw aria-hidden="true" /> Show the {back ? "front" : "back"}
              </Button>
            )}
            {card && (
              <>
                {prices.length > 0 && (
                  <p className="text-center text-sm text-muted-foreground">
                    Market price {prices.join(" · ")} <span className="block text-xs">via Scryfall, for reference only</span>
                  </p>
                )}
                <Button asChild>
                  <Link to={`/search?name=${encodeURIComponent(card.name)}`} onClick={onClose}>
                    <Search aria-hidden="true" /> Find players trading it
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <a href={card.scryfallUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" /> View on Scryfall
                  </a>
                </Button>
              </>
            )}
          </div>

          {/* Right: the rules text, printing, rulings and legalities. */}
          <div className="min-w-0">
            {/* Dialogs need a title for screen readers even before the card has loaded. */}
            {!card && (
              <>
                <DialogTitle className="sr-only">Card details</DialogTitle>
                <DialogDescription className="sr-only">Loading the card's text, rulings and legality.</DialogDescription>
              </>
            )}
            <ErrorAlert error={error} title="Couldn't load this card" onRetry={reload} />
            {loading && (
              <div className="grid gap-3" aria-busy="true">
                <Skeleton className="h-9 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-4 h-24 w-full" />
              </div>
            )}
            {card && (
              <>
                {card.faces.map((face, i) => (
                  <section key={face.name} className={cn(i > 0 && "mt-6 border-t pt-6")}>
                    <div className="flex items-start justify-between gap-4">
                      {i === 0 ? (
                        <DialogTitle className="font-display text-3xl leading-tight font-bold text-primary sm:text-4xl">{face.name}</DialogTitle>
                      ) : (
                        <h3 className="font-display text-2xl font-bold text-primary">{face.name}</h3>
                      )}
                      {face.manaCost && <CardText text={face.manaCost} className="shrink-0 pt-2 text-xl whitespace-nowrap" />}
                    </div>
                    {i === 0 ? (
                      <DialogDescription className="mt-1 text-base">{face.typeLine}</DialogDescription>
                    ) : (
                      <p className="mt-1 text-muted-foreground">{face.typeLine}</p>
                    )}
                    <div className="mt-4 grid gap-3 text-lg leading-relaxed">
                      {face.oracleText.split("\n").map((line, j) => (
                        <p key={j}>
                          <CardText text={line} />
                        </p>
                      ))}
                      {face.flavorText && <p className="text-base text-muted-foreground italic">{face.flavorText}</p>}
                    </div>
                    {face.stats && <p className="mt-3 text-right text-xl font-semibold tabular-nums">{face.stats}</p>}
                  </section>
                ))}

                <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t pt-5 text-sm">
                  <dt className="text-muted-foreground">Printing</dt>
                  <dd>
                    {card.setName} ({card.setCode.toUpperCase()}) #{card.collectorNumber}, <span className="capitalize">{card.rarity}</span>
                  </dd>
                  {card.artist && (
                    <>
                      <dt className="text-muted-foreground">Artist</dt>
                      <dd>{card.artist}</dd>
                    </>
                  )}
                </dl>

                <section className="mt-6 border-t pt-5" aria-labelledby="rulings-heading">
                  <h3 id="rulings-heading" className="text-lg font-semibold">
                    Rulings
                  </h3>
                  {card.rulings.length === 0 ? (
                    <p className="mt-1 text-sm text-muted-foreground">No official rulings for this card.</p>
                  ) : (
                    <ul className="mt-2 grid max-h-64 gap-3 overflow-y-auto pr-1 text-sm">
                      {card.rulings.map((r, i) => (
                        <li key={i}>
                          <time className="text-xs text-muted-foreground" dateTime={r.date}>
                            {new Date(`${r.date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "medium" })}
                          </time>
                          <p>
                            <CardText text={r.text} />
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <a className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline" href={`${card.scryfallUrl.split("?")[0]}#rulings`} target="_blank" rel="noopener noreferrer">
                    Rulings and full rules on Scryfall <ExternalLink className="size-3.5" aria-hidden="true" />
                  </a>
                </section>

                <section className="mt-6 border-t pt-5" aria-labelledby="legal-heading">
                  <h3 id="legal-heading" className="text-lg font-semibold">
                    Format legality
                  </h3>
                  <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
                    {FORMATS.filter(([key]) => card.legalities[key]).map(([key, label]) => (
                      <Legality key={key} label={label} status={card.legalities[key]} />
                    ))}
                  </ul>
                </section>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Lets any CardImage with a printingId open the card view. Lives in the layout, inside the router. */
export function CardViewerProvider({ children }) {
  const [view, setView] = useState(null);
  const open = useCallback((id, siblings) => {
    const ids = [...new Set((siblings ?? []).filter(Boolean))];
    setView(ids.includes(id) ? { ids, index: ids.indexOf(id) } : { ids: [id], index: 0 });
  }, []);
  return (
    <CardViewerContext value={open}>
      {children}
      {view && <CardDetailsDialog ids={view.ids} index={view.index} onIndex={(index) => setView((v) => ({ ...v, index }))} onClose={() => setView(null)} />}
    </CardViewerContext>
  );
}
