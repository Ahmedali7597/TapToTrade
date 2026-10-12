import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { CalendarDays, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorAlert, PageMessage, Spinner, useApi } from "@/components/common";
import { eventWhen } from "@/components/StoreEvents";
import { qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cityHeading, citySummary, cityTitle, SITE_NAME } from "@shared/pages";
import { tagLabel } from "@shared/stores";

/**
 * A city's landing page (/trade/hamilton-on): how much is being traded nearby, the partner stores and their next
 * events, and the cards most players there have shared. Counts and card names only, never usernames.
 */
export default function CityPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi(`/cities/${encodeURIComponent(slug)}`);
  useEffect(() => {
    if (data) document.title = cityTitle(data.city);
  }, [data]);

  if (loading && !data) return <Spinner label="Loading city" />;
  if (error?.status === 404)
    return <PageMessage title="City not found" body="We don't have a page for that city yet." action={<Button asChild><Link to="/search">Search cards anywhere</Link></Button>} />;
  if (error) return <div className="mx-auto max-w-5xl px-4 py-10"><ErrorAlert error={error} onRetry={reload} /></div>;

  const { city, radiusKm, stores, events, cards } = data;
  const near = { city, radius: radiusKm };
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <MapPin className="size-4" aria-hidden="true" /> {city}
          </p>
          <h1 className="text-3xl font-bold sm:text-4xl">{cityHeading(city)}</h1>
          <p className="max-w-[65ch] text-lg text-muted-foreground">{citySummary(data)}</p>
        </div>
        <Button asChild size="lg">
          <Link to={`/search${qs(near)}`}>
            <Search aria-hidden="true" /> Find cards near {city.split(", ")[0]}
          </Link>
        </Button>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid content-start gap-10">
          {cards.length > 0 && (
            <section aria-labelledby="cards-heading" className="grid gap-3">
              <h2 id="cards-heading" className="text-xl font-semibold">
                Cards players near {city} have shared
              </h2>
              <ul className="flex flex-wrap gap-2">
                {cards.map((c) => (
                  <li key={c.name}>
                    <Link
                      to={`/search${qs({ name: c.name, ...near })}`}
                      className="inline-flex rounded-full border bg-card px-3 py-1 text-sm font-medium underline-offset-4 hover:border-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="how-heading" className="grid gap-3">
            <h2 id="how-heading" className="text-xl font-semibold">
              How local MTG trading works
            </h2>
            <ol className="grid list-decimal gap-2 pl-5 text-muted-foreground">
              <li>List the exact printings you own and share the ones you'd trade. Only your username and city are public.</li>
              <li>Search cards players within {radiusKm} km of {city} have shared, by name, condition and finish.</li>
              <li>Send a trade request, agree on the cards, and meet somewhere public, like a partner game store.</li>
            </ol>
            <p className="text-sm text-muted-foreground">{SITE_NAME} is free and never handles money or shipping.</p>
            {!user && (
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link to="/register">Create a free account</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/login">Log in</Link>
                </Button>
              </div>
            )}
          </section>
        </div>

        <div className="grid content-start gap-10">
          <section aria-labelledby="stores-heading" className="grid gap-3">
            <h2 id="stores-heading" className="text-xl font-semibold">
              Partner game stores near {city}
            </h2>
            {stores.length > 0 ? (
              <ul className="grid gap-3">
                {stores.map((s) => (
                  <li key={s.id} className="rounded-xl border bg-card p-4">
                    <Link to={s.path} className="font-semibold underline-offset-4 hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {s.address}, {s.city}
                      {s.distanceKm > 0 && ` · ${s.distanceKm} km`}
                    </p>
                    {s.tags.length > 0 && <p className="mt-1 text-sm">{s.tags.slice(0, 3).map(tagLabel).join(" · ")}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                No partner store near {city} yet. Meet somewhere public, like a library or a café.{" "}
                <Link to="/stores#partner" className="font-medium text-primary underline-offset-4 hover:underline">
                  Run a game store here?
                </Link>
              </p>
            )}
          </section>

          {events.length > 0 && (
            <section aria-labelledby="events-heading" className="grid gap-3">
              <h2 id="events-heading" className="text-xl font-semibold">
                Coming up
              </h2>
              <ul className="grid gap-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start gap-2">
                    <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <span>
                      <span className="font-medium">{e.title}</span> at{" "}
                      <Link to={e.store.path} className="underline-offset-4 hover:underline">
                        {e.store.name}
                      </Link>{" "}
                      <span className="text-muted-foreground tabular-nums">· {eventWhen(e)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
