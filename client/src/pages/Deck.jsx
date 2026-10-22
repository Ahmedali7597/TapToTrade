import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AlertTriangle, Check, Copy, Download, Layers, LayoutGrid, Pencil, Search, Shuffle, Trash2, Type, Upload } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CardImage, ErrorAlert, PageMessage, SegmentedControl, Spinner, SuccessMessage, useApi } from "@/components/common";
import CardNameInput from "@/components/CardNameInput";
import { GridView, StacksView } from "@/components/CollectionViews";
import { ColourDots, DeckForm } from "@/pages/Decks";
import { api, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { groupItems, sortItems } from "@/lib/collection";
import { cad, priceOf, usePrices } from "@/lib/prices";
import { cn } from "@/lib/utils";
import { BOARD_LABELS, BOARDS, colourPips, countOn, deckProblems, deckText, FORMAT_LABELS, manaCurve } from "@shared/decks";
import { SITE_NAME } from "@shared/pages";

// One deck, after Moxfield: the cards as deck-style stacks (or a grid, or the text list), with the commander
// first and the sideboard and maybeboard after; a stats panel (size, value, mana curve, colours, format
// problems); and, for a signed-in viewer, which cards they own and which they'd still need to trade for.

const isBasic = (p) => /\bBasic\b/.test(p.typeLine ?? "");
const GROUPS = [
  ["type", "Card type"],
  ["cmc", "Mana value"],
  ["colour", "Colour"],
  ["rarity", "Rarity"],
  ["none", "No grouping"],
];

/** The main deck in groups; "cmc" groups by mana value with lands on their own, like Moxfield. */
function groupMain(items, by) {
  if (by !== "cmc") return groupItems(items, by);
  const groups = new Map();
  for (const c of items) {
    const label = /\bLand\b/.test(c.printing.typeLine ?? "") ? "Lands" : `Mana value ${Math.min(7, Math.floor(c.printing.manaValue ?? 0))}${(c.printing.manaValue ?? 0) >= 7 ? "+" : ""}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(c);
  }
  return [...groups].map(([label, list]) => ({ label, items: list })).sort((a, b) => (a.label === "Lands") - (b.label === "Lands") || a.label.localeCompare(b.label));
}

function useChoice(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(`ttt-deck-${key}`) ?? initial;
    } catch {
      return initial;
    }
  });
  return [
    value,
    (v) => {
      setValue(v);
      try {
        localStorage.setItem(`ttt-deck-${key}`, v);
      } catch {
        /* not remembered */
      }
    },
  ];
}

/** Add a card by name (with suggestions as you type) to a board. */
function AddCard({ deckId, onAdded }) {
  const [name, setName] = useState("");
  const [board, setBoard] = useState("main");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    setAdded(null);
    try {
      const { card } = await api(`/decks/${deckId}/cards`, { method: "POST", body: { name, board, quantity: Number(quantity) || 1 } });
      onAdded(card);
      setAdded(`${card.printing.name} → ${BOARD_LABELS[card.board]}`);
      setName("");
      setQuantity("1");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={add} className="grid gap-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_5rem_auto] sm:items-end">
        <div className="grid gap-1">
          <Label htmlFor="deck-add" className="text-xs text-muted-foreground">
            Add a card
          </Label>
          <CardNameInput id="deck-add" placeholder="Card name, e.g. Sol Ring" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="deck-add-board" className="text-xs text-muted-foreground">
            To
          </Label>
          <NativeSelect id="deck-add-board" value={board} onChange={(e) => setBoard(e.target.value)} className="w-full">
            {BOARDS.map(([v, label]) => (
              <NativeSelectOption key={v} value={v}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="deck-add-qty" className="text-xs text-muted-foreground">
            Copies
          </Label>
          <Input id="deck-add-qty" type="number" min={1} max={99} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>
          {busy ? "Adding…" : "Add"}
        </Button>
      </div>
      {error && <p className="text-sm font-medium text-destructive">{error.message}</p>}
      {added && <SuccessMessage>Added {added}.</SuccessMessage>}
    </form>
  );
}

function ImportDeck({ deckId, onImported }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await api(`/decks/${deckId}/import`, { method: "POST", body: { text, replace } }));
      onImported();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setResult(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Upload aria-hidden="true" /> Paste a list
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Paste a decklist</DialogTitle>
          <DialogDescription>
            From Moxfield, Archidekt, Arena or MTGO: lines like <code>1 Sol Ring (C21) 263</code>, with Commander, Deck, Sideboard and Maybeboard headings.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="grid gap-3" role="status">
            <SuccessMessage>
              Added {result.added} card{result.added === 1 ? "" : "s"}.
            </SuccessMessage>
            {result.skippedCount > 0 && (
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  {result.skippedCount} line{result.skippedCount === 1 ? "" : "s"} skipped
                </summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                  {result.skipped.map((s) => (
                    <li key={`${s.line}-${s.name}`}>
                      Line {s.line} · {s.name}: {s.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <ErrorAlert error={error} title="Import didn't work" />
            <Label htmlFor="deck-import" className="sr-only">
              Decklist
            </Label>
            <Textarea id="deck-import" rows={10} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder={"Commander\n1 Krenko, Mob Boss (DDT) 52\n\nDeck\n1 Sol Ring (C21) 263\n30 Mountain"} />
            <div className="flex items-center gap-3 text-sm">
              <Switch id="deck-import-replace" checked={replace} onCheckedChange={setReplace} />
              <Label htmlFor="deck-import-replace">Replace the whole deck (off: add these cards to it)</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy || !text.trim()}>
                {busy ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A sample opening hand: seven cards from the shuffled main deck, then draw more or shuffle again. */
function SampleHand({ cards }) {
  const library = cards.filter((c) => c.board === "main").flatMap((c) => Array.from({ length: c.quantity }, (_, i) => ({ ...c, key: `${c.id}-${i}` })));
  const shuffle = () => {
    const a = [...library];
    for (let i = a.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const [deck, setDeck] = useState(null);
  const [drawn, setDrawn] = useState(7);
  const start = () => {
    setDeck(shuffle());
    setDrawn(7);
  };
  return (
    <Dialog onOpenChange={(o) => o && start()}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={library.length < 7}>
          <Shuffle aria-hidden="true" /> Sample hand
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Sample hand</DialogTitle>
          <DialogDescription>
            {Math.min(drawn, deck?.length ?? 0)} card{drawn === 1 ? "" : "s"} drawn from {library.length}. {drawn > 7 && `Turn ${drawn - 7} on the draw.`}
          </DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
          {deck?.slice(0, drawn).map((c) => (
            <li key={c.key}>
              <CardImage name={c.printing.name} setCode={c.printing.setCode} imageUrl={c.printing.imageUrl} className="w-full" />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={start}>
            New hand
          </Button>
          <Button onClick={() => setDrawn((n) => n + 1)} disabled={!deck || drawn >= deck.length}>
            Draw a card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Quantity, board and removal for one card (the pencil on a card). */
function CardEditor({ deckId, card, onSaved, onRemoved, onClose }) {
  const [quantity, setQuantity] = useState(String(card.quantity));
  const [board, setBoard] = useState(card.board);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSaved((await api(`/decks/${deckId}/cards/${card.id}`, { method: "PATCH", body: { quantity: Number(quantity), board } })).card, card.id);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await api(`/decks/${deckId}/cards/${card.id}`, { method: "DELETE" });
      onRemoved(card.id);
      onClose();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-[10rem_1fr]">
      <CardImage name={card.printing.name} setCode={card.printing.setCode} imageUrl={card.printing.imageUrl} className="mx-auto w-40" />
      <div className="grid content-start gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1">
            <Label htmlFor="edit-qty">Copies</Label>
            <Input id="edit-qty" type="number" min={1} max={99} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="edit-board">Board</Label>
            <NativeSelect id="edit-board" value={board} onChange={(e) => setBoard(e.target.value)} className="w-full">
              {BOARDS.map(([v, label]) => (
                <NativeSelectOption key={v} value={v}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
        {error && <p className="text-sm font-medium text-destructive">{error.message}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" className="gap-1.5 text-destructive" onClick={remove}>
            <Trash2 aria-hidden="true" /> Remove from deck
          </Button>
          <Button asChild variant="ghost" className="gap-1.5">
            <Link to={`/search${qs({ name: card.printing.name })}`}>
              <Search aria-hidden="true" /> Find it nearby
            </Link>
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Bars for the mana curve, tallest bar full height. */
function Curve({ cards }) {
  const bins = manaCurve(cards);
  const top = Math.max(1, ...bins.map((b) => b.count));
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Mana curve</p>
      <div className="flex h-28 items-end gap-1.5" role="img" aria-label={`Mana curve: ${bins.map((b) => `${b.count} at ${b.value}`).join(", ")}`}>
        {bins.map((b) => (
          <div key={b.value} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-xs text-muted-foreground tabular-nums">{b.count || ""}</span>
            <div className="w-full rounded-t-sm bg-primary/80" style={{ height: `${(b.count / top) * 72}px`, minHeight: b.count ? 3 : 0 }} />
            <span className="text-xs font-medium tabular-nums">{b.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PIP_COLOURS = { W: ["White", "#efe6b8"], U: ["Blue", "#7fb9e6"], B: ["Black", "#8a8180"], R: ["Red", "#e98466"], G: ["Green", "#6fbf8c"], C: ["Colourless", "#c8ccd0"] };
function Pips({ cards }) {
  const pips = colourPips(cards);
  const total = Object.values(pips).reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Colours in mana costs</p>
      <div className="flex h-3 overflow-hidden rounded-full ring-1 ring-border">
        {Object.entries(pips)
          .filter(([, n]) => n)
          .map(([k, n]) => (
            <span key={k} title={`${PIP_COLOURS[k][0]}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: PIP_COLOURS[k][1] }} />
          ))}
      </div>
      <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {Object.entries(pips)
          .filter(([, n]) => n)
          .map(([k, n]) => (
            <span key={k}>
              {PIP_COLOURS[k][0]} {Math.round((n / total) * 100)}%
            </span>
          ))}
      </p>
    </div>
  );
}

const pct = (n) => `${Math.round(n * 100)}%`;

/**
 * Card ideas from EDHREC for the deck's commander: one of their lists at a time (High synergy, Top cards,
 * Creatures...), without cards already in the deck. The owner can add a card with one click.
 */
function Suggestions({ deckId, commanders, inDeck, mine, onAdded }) {
  const [list, setList] = useState("");
  const [added, setAdded] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const { data, error: loadError, loading, reload } = useApi(`/decks/${deckId}/suggestions${qs({ list, c: commanders })}`);
  const add = async (card) => {
    setBusy(card.name);
    setError(null);
    try {
      const res = await api(`/decks/${deckId}/cards`, { method: "POST", body: { printingId: card.printing.id } });
      onAdded(res.card);
      setAdded((s) => new Set(s).add(card.name));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  // Also drop cards added since the list loaded (here or with the add box above).
  const cards = (data?.list?.cards ?? []).filter((c) => !added.has(c.name) && !inDeck.has(c.name));
  return (
    <section aria-labelledby="edhrec-heading" className="mt-10 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="edhrec-heading" className="text-lg font-bold">
            Suggestions from EDHREC
          </h2>
          <p className="text-sm text-muted-foreground">
            Cards players often run with {commanders.split("|").join(" and ")}, from{" "}
            <a href={data?.url ?? "https://edhrec.com"} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
              EDHREC
            </a>
            . Synergy is how much more often a card shows up with this commander than in other decks.
          </p>
        </div>
        {data?.lists?.length > 0 && (
          <label className="flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
            List
            <NativeSelect value={data.list?.tag ?? ""} onChange={(e) => setList(e.target.value)} aria-label="Suggestion list">
              {data.lists.map((l) => (
                <NativeSelectOption key={l.tag} value={l.tag}>
                  {l.header} ({l.count})
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        )}
      </div>
      <ErrorAlert error={loadError} title="Couldn't load suggestions" onRetry={reload} />
      {error && <p className="mb-3 text-sm font-medium text-destructive">{error.message}</p>}
      {loading && !data ? (
        <Spinner label="Asking EDHREC" />
      ) : data && !data.url ? (
        <p className="text-sm text-muted-foreground">EDHREC doesn't have a page for this commander yet.</p>
      ) : (
        <ul className={cn("grid grid-cols-[repeat(auto-fill,minmax(min(9rem,100%),1fr))] gap-x-3 gap-y-4", loading && "opacity-60")} data-testid="edhrec-cards">
          {cards.map((c) => (
            <li key={c.name} className="grid content-start gap-1">
              <CardImage name={c.name} setCode={c.printing.setCode} imageUrl={c.printing.imageUrl} printingId={c.printing.id} siblings={cards.map((x) => x.printing.id)} className="w-full" />
              <p className="truncate text-sm font-semibold" title={c.name}>
                {c.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {c.synergy != null && `${c.synergy >= 0 ? "+" : ""}${pct(c.synergy)} synergy`}
                {c.synergy != null && c.inclusion != null && " · "}
                {c.inclusion != null && `in ${pct(c.inclusion)} of decks`}
              </p>
              {mine && (
                <Button size="sm" variant="outline" className="mt-0.5" disabled={busy === c.name} onClick={() => add(c)}>
                  {busy === c.name ? "Adding…" : "Add to deck"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function Deck() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(`/decks/${id}`);
  const [cards, setCards] = useState(null);
  const [deckInfo, setDeckInfo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [view, setView] = useChoice("view", "stacks");
  const [group, setGroup] = useChoice("group", "type");
  const [copied, setCopied] = useState(false);
  const [wantResult, setWantResult] = useState(null);
  const list = cards ?? data?.cards ?? [];
  const deck = deckInfo ?? data?.deck;
  const mine = Boolean(data?.mine);
  const owned = data?.owned;
  const prices = usePrices(list.map((c) => ({ printingId: c.printing.id, finish: "nonfoil" })));

  useEffect(() => {
    if (deck) document.title = `${deck.name} · ${FORMAT_LABELS[deck.format]} deck · ${SITE_NAME}`;
  }, [deck]);

  if (loading && !data) return <Spinner label="Loading the deck" />;
  if (error?.status === 404 || (!loading && !data && !error)) return <PageMessage code="404" title="Deck not found" body="It may be private, or it was deleted." action={user && <Button asChild><Link to="/decks">Your decks</Link></Button>} />;
  if (error) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorAlert error={error} title="Couldn't load this deck" onRetry={reload} /></div>;

  // Cards as the views expect them (no finish or condition in a deck).
  const asItems = (rows) => sortItems(rows.map((c) => ({ ...c, finish: "nonfoil", condition: "" })), "name");
  const on = (board) => asItems(list.filter((c) => c.board === board));
  const groups = [
    ...(on("commander").length ? [{ label: "Commander", items: on("commander") }] : []),
    ...groupMain(on("main"), group),
    ...(on("side").length ? [{ label: "Sideboard", items: on("side") }] : []),
    ...(on("maybe").length ? [{ label: "Maybeboard", items: on("maybe") }] : []),
  ];
  const siblings = list.map((c) => c.printing.id);

  // What a signed-in viewer has: copies needed per name (commander, main and side) against copies owned.
  const need = new Map();
  for (const c of list) if (c.board !== "maybe" && !isBasic(c.printing)) need.set(c.printing.name, (need.get(c.printing.name) ?? 0) + c.quantity);
  const short = owned ? [...need].filter(([name, n]) => (owned[name] ?? 0) < n).map(([name, n]) => ({ name, missing: n - (owned[name] ?? 0) })) : [];
  const totalNeeded = [...need.values()].reduce((a, b) => a + b, 0);
  const totalShort = short.reduce((a, b) => a + b.missing, 0);

  const playing = countOn(list, "commander", "main");
  const target = deck.format === "commander" ? 100 : deck.format === "casual" ? null : 60;
  let value = 0;
  let unpriced = 0;
  for (const c of list) {
    if (c.board === "maybe") continue;
    const p = priceOf(prices, { printingId: c.printing.id, finish: "nonfoil" })?.cad;
    if (p == null) unpriced += 1;
    else value += p * c.quantity;
  }
  const problems = deckProblems(deck.format, list);
  const text = deckText(list);

  const replaceCard = (card, oldId) => setCards([...list.filter((c) => c.id !== card.id && c.id !== oldId), card]);
  const changeQuantity = async (item, delta) => {
    try {
      replaceCard((await api(`/decks/${deck.id}/cards/${item.id}`, { method: "PATCH", body: { quantity: item.quantity + delta } })).card);
    } catch {
      /* the editor shows errors; a failed quick change just leaves the count as it was */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the text view lets people select it themselves */
    }
  };
  const wantMissing = async () => {
    try {
      setWantResult(await api(`/decks/${deck.id}/want-missing`, { method: "POST" }));
    } catch (err) {
      setWantResult({ error: err.message });
    }
  };
  const viewProps = { prices, siblings, onEdit: mine ? setEditing : undefined, onQuantity: mine ? changeQuantity : undefined };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="mb-6 flex flex-col gap-4 border-b border-border/80 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mb-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{FORMAT_LABELS[deck.format]}</Badge>
            <ColourDots colors={[...new Set(list.filter((c) => c.board === "commander").flatMap((c) => c.printing.colorIdentity ?? []))]} />
            <span>
              by <Link to={`/u/${deck.owner.username}`} className="font-medium text-primary underline-offset-4 hover:underline">{deck.owner.username}</Link>
            </span>
            {mine && <Badge variant="secondary">{deck.visibility === "private" ? "Private" : deck.visibility === "public" ? "Public" : "Unlisted"}</Badge>}
          </p>
          <h1 className="text-3xl font-bold break-words sm:text-4xl">{deck.name}</h1>
          {deck.description && <p className="mt-2 max-w-[70ch] whitespace-pre-line text-muted-foreground">{deck.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <SampleHand cards={list} />
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`/api/decks/${deck.id}/export`} download>
              <Download aria-hidden="true" /> Export
            </a>
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copy}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? "Copied" : "Copy list"}
          </Button>
          {mine && (
            <>
              <ImportDeck
                deckId={deck.id}
                onImported={() => {
                  setCards(null);
                  reload();
                }}
              />
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Pencil aria-hidden="true" /> Edit details
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Deck details</DialogTitle>
                    <DialogDescription>Change the name, format, description or who can see it.</DialogDescription>
                  </DialogHeader>
                  <DeckForm deckId={deck.id} initial={deck} submitLabel="Save" onSaved={setDeckInfo} />
                </DialogContent>
              </Dialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive">
                    <Trash2 aria-hidden="true" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {deck.name}?</AlertDialogTitle>
                    <AlertDialogDescription>The deck and its card list are removed for good. Your inventory isn't touched.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={async () => {
                        await api(`/decks/${deck.id}`, { method: "DELETE" });
                        navigate("/decks");
                      }}
                    >
                      Delete deck
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="grid min-w-0 gap-5">
          {mine && (
            <Card className="py-4">
              <CardContent>
                <AddCard deckId={deck.id} onAdded={replaceCard} />
              </CardContent>
            </Card>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: "stacks", label: "Stacks", icon: Layers },
                { value: "grid", label: "Grid", icon: LayoutGrid },
                { value: "text", label: "Text", icon: Type },
              ]}
            />
            {view !== "text" && (
              <label className="flex items-center gap-2 text-sm whitespace-nowrap text-muted-foreground">
                Group by
                <NativeSelect value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group by">
                  {GROUPS.map(([v, label]) => (
                    <NativeSelectOption key={v} value={v}>
                      {label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
            )}
          </div>
          {!list.length ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
              {mine ? "No cards yet. Add one above, or paste a decklist." : "This deck has no cards yet."}
            </p>
          ) : view === "text" ? (
            <pre className="overflow-x-auto rounded-xl border bg-card p-4 text-sm leading-6" data-testid="deck-text">
              {text}
            </pre>
          ) : view === "grid" ? (
            <GridView groups={groups} size="m" {...viewProps} />
          ) : (
            <StacksView groups={groups} size="m" {...viewProps} />
          )}
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-24" aria-label="Deck stats">
          <Card className="gap-4 py-5">
            <CardHeader>
              <CardTitle className="flex items-baseline justify-between gap-2">
                <span>
                  {playing}
                  {target && <span className="text-muted-foreground"> / {target}</span>} cards
                </span>
                {value > 0 && (
                  <span className="text-base font-semibold tabular-nums" title="TCGplayer market prices via Scryfall, in CAD. For reference only.">
                    ≈ {cad(Math.round(value * 100) / 100)}
                  </span>
                )}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {countOn(list, "side") > 0 && `Sideboard ${countOn(list, "side")} · `}
                {countOn(list, "maybe") > 0 && `Maybeboard ${countOn(list, "maybe")} · `}
                {unpriced > 0 ? `${unpriced} card${unpriced === 1 ? "" : "s"} without a price` : "Market value, not counting the maybeboard"}
              </p>
            </CardHeader>
            <CardContent className="grid gap-5">
              <Curve cards={list} />
              <Pips cards={list} />
            </CardContent>
          </Card>

          {list.length > 0 && (
            <Card className={cn("gap-3 py-5", problems.length && "border-amber-500/50")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {problems.length ? <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" /> : <Check className="size-4 text-emerald-600" aria-hidden="true" />}
                  {problems.length ? `${problems.length} thing${problems.length === 1 ? "" : "s"} to check for ${FORMAT_LABELS[deck.format]}` : `Looks legal for ${FORMAT_LABELS[deck.format]}`}
                </CardTitle>
              </CardHeader>
              {problems.length > 0 && (
                <CardContent>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {problems.slice(0, 15).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                    {problems.length > 15 && <li>…and {problems.length - 15} more.</li>}
                  </ul>
                </CardContent>
              )}
            </Card>
          )}

          {owned && list.length > 0 && (
            <Card className="gap-3 py-5" data-testid="deck-owned">
              <CardHeader>
                <CardTitle className="text-base">
                  You own {totalNeeded - totalShort} of {totalNeeded} cards
                </CardTitle>
                <p className="text-xs text-muted-foreground">From your inventory, any printing. Basic lands and the maybeboard aren't counted.</p>
              </CardHeader>
              {short.length > 0 && (
                <CardContent className="grid gap-3">
                  <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
                    {short.map((s) => (
                      <li key={s.name} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">
                          {s.missing > 1 && `${s.missing}× `}
                          {s.name}
                        </span>
                        <Link to={`/search${qs({ name: s.name })}`} className="shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline">
                          Find nearby
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Button variant="outline" size="sm" onClick={wantMissing}>
                    Add the missing cards to my want list
                  </Button>
                  {wantResult &&
                    (wantResult.error ? (
                      <p className="text-sm font-medium text-destructive">{wantResult.error}</p>
                    ) : (
                      <SuccessMessage>
                        {wantResult.added ? `Added ${wantResult.added} card${wantResult.added === 1 ? "" : "s"} to your want list.` : "They're all on your want list already."}
                        {wantResult.full && " Your want list is full, so some weren't added."} <Link to="/wants" className="underline">See matches</Link>
                      </SuccessMessage>
                    ))}
                </CardContent>
              )}
            </Card>
          )}
        </aside>
      </div>

      {list.some((c) => c.board === "commander") && (
        <Suggestions
          deckId={deck.id}
          // Part of the request, so changing the commander asks EDHREC about the new one.
          commanders={list
            .filter((c) => c.board === "commander")
            .map((c) => c.printing.name)
            .sort()
            .join("|")}
          inDeck={new Set(list.map((c) => c.printing.name))}
          mine={mine}
          onAdded={replaceCard}
        />
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing?.printing.name}</DialogTitle>
            <DialogDescription>Change how many copies, move it to another board, or remove it.</DialogDescription>
          </DialogHeader>
          {editing && (
            <CardEditor
              deckId={deck.id}
              card={list.find((c) => c.id === editing.id) ?? editing}
              onSaved={replaceCard}
              onRemoved={(cardId) => setCards(list.filter((c) => c.id !== cardId))}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
