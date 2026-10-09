import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import CardNameInput from "@/components/CardNameInput";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CardImage, EmptyState, ErrorAlert, PageHeader, useApi } from "@/components/common";
import { qs } from "@/lib/api";
import { useShowcase } from "@/lib/showcase";

/**
 * Public card browser: look up any Magic card, tap it for its rules text, rulings and legality, and see how
 * many players have it shared for trade. No account needed (Wizards' Fan Content Policy asks for that).
 */
export default function Cards() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const { data, error, loading, reload } = useApi(q.trim().length >= 2 ? `/cards/browse${qs({ q })}` : null);
  // Before the first search: a few random cards to tap on.
  const { cards: ideas } = useShowcase(12);
  const results = data?.cards ?? [];
  const ids = (q ? results : ideas ?? []).map((c) => c.id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader title="Card browser" description="Look up any Magic card. Tap a card to read its rules, rulings and format legality, then find who's trading it." />
      <form
        role="search"
        className="pocket mb-8 flex flex-col gap-3 p-5 pt-7 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(qs({ q: text.trim() }).slice(1));
        }}
      >
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="card-q">Card name</Label>
          <CardNameInput id="card-q" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Sol Ring" />
        </div>
        <Button type="submit" size="lg" className="gap-2" disabled={text.trim().length < 2}>
          <SearchIcon aria-hidden="true" /> Look up
        </Button>
      </form>

      <ErrorAlert error={error} title="Card search is unavailable" onRetry={reload} />

      {!q && (
        <>
          <h2 className="mb-4 text-xl font-semibold">Need ideas? Tap any of these</h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {(ideas ?? Array(12).fill(null)).map((c, i) => (
              <li key={c?.imageUrl ?? i} className="slide-in" style={{ "--i": i }}>
                {c ? (
                  <CardImage name={c.name} setCode={c.setCode} imageUrl={c.imageUrl} printingId={c.id} siblings={ids} className="w-full" />
                ) : (
                  <Skeleton className="aspect-[488/680] w-full rounded-[4.5%/3.25%]" />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {q && loading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-busy="true" aria-label="Looking up cards">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[488/680] w-full rounded-[4.5%/3.25%]" />
          ))}
        </div>
      )}

      {q && data && (
        <>
          <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
            {results.length === 0 ? `No cards match “${q}”.` : `${results.length} card${results.length === 1 ? "" : "s"} match “${q}”.`}
          </p>
          {results.length === 0 ? (
            <EmptyState title="No cards found" body="Check the spelling, or try part of the name." />
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {results.map((c, i) => (
                <li key={c.id} className="slide-in pocket group flex flex-col p-3 pt-5" style={{ "--i": Math.min(i, 12) }}>
                  <CardImage name={c.name} setCode={c.setCode} imageUrl={c.imageUrl} printingId={c.id} siblings={ids} className="w-full" />
                  <p className="mt-3 font-display leading-snug font-semibold">{c.name}</p>
                  <p className="mt-auto pt-1 text-sm">
                    {c.players > 0 ? (
                      <Link to={`/search${qs({ name: c.name })}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {c.players} player{c.players === 1 ? "" : "s"} trading it
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">No one has listed it yet</span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
