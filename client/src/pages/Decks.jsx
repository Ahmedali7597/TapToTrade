import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorAlert, Field, PageHeader, Spinner, useApi } from "@/components/common";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { FORMAT_LABELS, FORMATS, VISIBILITY } from "@shared/decks";
import { PUBLIC_PAGES } from "@shared/pages";

// Colour identity as mana-colour dots, WUBRG order.
const PIP = { W: "#f8f3d4", U: "#a8d5f2", B: "#a69f9d", R: "#f3a48a", G: "#9bd3ae" };
export function ColourDots({ colors = [] }) {
  const order = ["W", "U", "B", "R", "G"].filter((c) => colors.includes(c));
  if (!order.length) return null;
  return (
    <span className="inline-flex gap-0.5" aria-label={`Colours: ${order.join("")}`}>
      {order.map((c) => (
        <span key={c} className="size-3 rounded-full ring-1 ring-black/25" style={{ background: PIP[c] }} aria-hidden="true" />
      ))}
    </span>
  );
}

/** Name, format, description and who can see it. Used to create a deck and to edit one. */
export function DeckForm({ initial = {}, submitLabel, onSaved, deckId }) {
  const [form, setForm] = useState({ name: initial.name ?? "", format: initial.format ?? "commander", description: initial.description ?? "", visibility: initial.visibility ?? "private" });
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setFields({ name: "Give the deck a name." });
    setBusy(true);
    setError(null);
    try {
      const { deck } = await api(deckId ? `/decks/${deckId}` : "/decks", { method: deckId ? "PATCH" : "POST", body: form });
      onSaved(deck);
    } catch (err) {
      setFields(err.fields ?? {});
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} noValidate className="grid gap-4">
      <ErrorAlert error={error} title="Deck not saved" />
      <Field id="deck-name" label="Name" value={form.name} onChange={set("name")} error={fields.name} maxLength={100} autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="deck-format" label="Format" error={fields.format}>
          <NativeSelect id="deck-format" value={form.format} onChange={set("format")} className="w-full">
            {FORMATS.map(([v, label]) => (
              <NativeSelectOption key={v} value={v}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field id="deck-visibility" label="Who can see it" error={fields.visibility}>
          <NativeSelect id="deck-visibility" value={form.visibility} onChange={set("visibility")} className="w-full">
            {VISIBILITY.map(([v, label]) => (
              <NativeSelectOption key={v} value={v}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field id="deck-description" label="Description (optional)" error={fields.description}>
        <Textarea id="deck-description" rows={3} maxLength={2000} value={form.description} onChange={set("description")} />
      </Field>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** One deck as a tile: the cover card's art, name, format, colours and size. `showOwner` for other players' decks. */
function DeckTile({ deck: d, showOwner = false }) {
  return (
    <li>
      <Link to={`/decks/${d.id}`} className="group block overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
        <div className="relative h-36 overflow-hidden bg-muted">
          {d.cover && (
            // The card's art, cropped like Moxfield's deck tiles.
            <img src={d.cover} alt="" loading="lazy" className="absolute inset-x-0 -top-[18%] w-full scale-110 object-cover transition-transform duration-500 group-hover:scale-125" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          <p className="absolute inset-x-3 bottom-2 truncate text-lg font-bold text-white">{d.name}</p>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Badge variant="outline">{FORMAT_LABELS[d.format]}</Badge>
            <ColourDots colors={d.colors} />
          </span>
          <span className="min-w-0 truncate text-muted-foreground tabular-nums">
            {showOwner ? `by ${d.owner.username}` : `${d.cards} card${d.cards === 1 ? "" : "s"}`}
            {!showOwner && d.visibility !== "private" && ` · ${d.visibility === "public" ? "Public" : "Unlisted"}`}
          </span>
        </div>
      </Link>
    </li>
  );
}

const grid = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

function NewDeckButton() {
  const navigate = useNavigate();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="size-4" aria-hidden="true" /> New deck
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New deck</DialogTitle>
          <DialogDescription>You can paste a decklist from Moxfield, Archidekt or Arena once it's made.</DialogDescription>
        </DialogHeader>
        <DeckForm submitLabel="Create deck" onSaved={(deck) => navigate(`/decks/${deck.id}`)} />
      </DialogContent>
    </Dialog>
  );
}

function MyDecks() {
  const { data, error, loading, reload } = useApi("/decks");
  const decks = data?.decks ?? [];
  return (
    <>
      <PageHeader title="Your decks" description="Build decks, check them against a format's rules, and see which cards you still need to trade for.">
        <NewDeckButton />
      </PageHeader>
      <ErrorAlert error={error} title="Couldn't load your decks" onRetry={reload} />
      {loading ? (
        <Spinner label="Loading your decks" />
      ) : !decks.length ? (
        <EmptyState title="No decks yet" body="Make your first deck, then add cards by name or paste a decklist.">
          <NewDeckButton />
        </EmptyState>
      ) : (
        <ul className={grid} data-testid="deck-list">
          {decks.map((d) => (
            <DeckTile key={d.id} deck={d} />
          ))}
        </ul>
      )}
    </>
  );
}

const FEATURES = [
  ["Build by name or paste a list", "Type a card with suggestions as you go, or paste a list from Moxfield, Archidekt or Arena, with commander, sideboard and maybeboard."],
  ["Check it against the format", "Commander, Standard, Pioneer, Modern, Legacy, Vintage and Pauper: deck size, copies, bans and your commander's colour identity."],
  ["Suggestions from EDHREC", "Cards players often run with your commander, ready to add in one click."],
  ["See what you're missing", "Which cards you already own, and the rest on your want list, so you can find players nearby who have them."],
];

/** What the deck builder does, for visitors (this page is public and in search). */
function DeckBuilderIntro() {
  const page = PUBLIC_PAGES["/decks"];
  return (
    <>
      <PageHeader title={page.heading} description={page.text}>
        <Button asChild>
          <Link to="/register?next=/decks">Start a deck, free</Link>
        </Button>
      </PageHeader>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(([title, body]) => (
          <li key={title} className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Recently updated public decks from other players. Hidden when there aren't any yet. */
function PublicDecks() {
  const { data } = useApi("/decks/public");
  const decks = data?.decks ?? [];
  if (!decks.length) return null;
  return (
    <section aria-labelledby="public-decks-heading" className="mt-12">
      <h2 id="public-decks-heading" className="mb-4 text-xl font-semibold">
        Recent public decks
      </h2>
      <ul className={grid}>
        {decks.map((d) => (
          <DeckTile key={d.id} deck={d} showOwner />
        ))}
      </ul>
    </section>
  );
}

export default function Decks() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {user ? <MyDecks /> : user === null ? <DeckBuilderIntro /> : <Spinner label="Loading" />}
      <PublicDecks />
    </div>
  );
}
