import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import CardNameInput from "@/components/CardNameInput";
import { Label } from "@/components/ui/label";
import { EmptyState, ErrorAlert, useApi } from "@/components/common";
import { qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ListingCard, RequestTradeButton } from "@/components/ListingCard";
import { TradeSummary } from "@/components/TradeSummary";
import { RADII } from "@shared/cities";

/** Mockup 2 direction: card-and-city search first, then pending trade actions and nearby listings. */
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  // Nearby means within the player's meetup range, or 100 km when they haven't set one.
  const radius = RADII.includes(user.travelKm) ? user.travelKm : 100;
  // Three independent requests; each section shows its own loading state or error.
  const trades = useApi("/trades");
  const nearby = useApi(`/search${qs({ city: user.city, radius, sort: "newest" })}`);
  const inventory = useApi("/inventory");
  const matches = useApi(`/wants/matches${qs({ radius })}`);

  const pending = trades.data?.received.filter((t) => t.status === "pending") ?? [];
  // Accepted trades stay "to arrange" until this player says whether they happened.
  const accepted = trades.data ? [...trades.data.received, ...trades.data.sent].filter((t) => t.status === "accepted" && !t.feedbackGiven).length : 0;
  // Nearby players who list a card on your want list.
  const haveYourWants = matches.data?.players.filter((m) => m.theyHave.length > 0).length ?? 0;
  const listings = inventory.data?.items.length;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <section className="grid gap-8 border-b border-border/80 pb-10 lg:grid-cols-[1.25fr_1fr] lg:items-end">
        <div>
          <h1 className="text-4xl font-bold sm:text-5xl">Hi, {user.username}</h1>
          {/* One plain sentence instead of stat tiles: what needs doing, linked to where you do it. */}
          <p className="mt-4 max-w-[60ch] text-lg text-muted-foreground" aria-live="polite">
            {trades.loading || inventory.loading ? (
              "Checking your trades and binder…"
            ) : (
              <>
                {pending.length > 0 ? (
                  <Link to="/trades" className="font-semibold text-rare-ink underline decoration-2 underline-offset-4">
                    {plural(pending.length, "proposal")} {pending.length === 1 ? "needs" : "need"} your response
                  </Link>
                ) : (
                  "Nothing is waiting on you"
                )}
                {accepted > 0 && (
                  <>
                    {", "}
                    <Link to="/trades" className="font-semibold text-foreground underline underline-offset-4">
                      {plural(accepted, "accepted offer")}
                    </Link>{" "}
                    to arrange and rate
                  </>
                )}
                {haveYourWants > 0 && (
                  <>
                    {". "}
                    <Link to="/wants" className="font-semibold text-foreground underline underline-offset-4">
                      {plural(haveYourWants, "player")} near you {haveYourWants === 1 ? "has" : "have"} cards you want
                    </Link>
                  </>
                )}
                {listings != null && (
                  <>
                    {". Your binder has "}
                    <Link to="/inventory" className="font-semibold text-foreground underline underline-offset-4">
                      {plural(listings, "listing")}
                    </Link>
                  </>
                )}
                .
              </>
            )}
          </p>
        </div>

        {/* Quick search jumps to the full search page, around the player's city and range. */}
        <form
          role="search"
          className="pocket flex flex-col gap-3 p-5 pt-7 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(`/search${qs({ name, city: user.city, radius })}`);
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="quick-search">Find a card within {radius} km of {user.city}</Label>
            <CardNameInput id="quick-search" placeholder="e.g. Counterspell" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" size="lg" className="gap-2">
            <SearchIcon aria-hidden="true" /> Search
          </Button>
        </form>
      </section>

      <section className="mt-10" aria-labelledby="pending-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="pending-heading" className="text-2xl font-semibold">
            Needs your response
          </h2>
          <Button asChild variant="link" className="px-0">
            <Link to="/trades">All trades</Link>
          </Button>
        </div>
        <ErrorAlert error={trades.error} onRetry={trades.reload} />
        {trades.loading ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Loading trades">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <EmptyState title="Nothing waiting on you right now" body="When someone sends you a proposal, it shows up here first." />
        ) : (
          <ul className="grid gap-3">
            {pending.slice(0, 5).map((t, i) => (
              <li key={t.id} className="slide-in" style={{ "--i": i }}>
                <TradeSummary trade={t} viewerId={user.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Latest shared cards from other players within the player's range. */}
      <section className="mt-12" aria-labelledby="nearby-heading">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="nearby-heading" className="text-2xl font-semibold">
            New near you
          </h2>
          <Button asChild variant="link" className="px-0">
            <Link to={`/search${qs({ city: user.city, radius, sort: "newest" })}`}>See all</Link>
          </Button>
        </div>
        <ErrorAlert error={nearby.error} onRetry={nearby.reload} />
        {nearby.loading && (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4" aria-busy="true" aria-label="Loading nearby listings">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="aspect-[488/760] rounded-xl" />
            ))}
          </div>
        )}
        {nearby.data &&
          (nearby.data.results.length === 0 ? (
            <EmptyState title={`No one within ${radius} km has shared cards yet`} body="Try a wider distance on the search page, or invite a friend to list their binder.">
              <Button asChild variant="outline">
                <Link to="/search">Open search</Link>
              </Button>
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
              {nearby.data.results.slice(0, 8).map((r, i) => (
                <li key={r.id} className="slide-in" style={{ "--i": i }}>
                  <ListingCard
                    item={r}
                    owner={r.owner}
                    distanceKm={r.distanceKm}
                    siblings={nearby.data.results.slice(0, 8).map((x) => x.printing.id)}
                    action={<RequestTradeButton owner={r.owner} item={r} />}
                  />
                </li>
              ))}
            </ul>
          ))}
      </section>
    </div>
  );
}
