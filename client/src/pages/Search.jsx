import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { List, LocateFixed, Map as MapIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorAlert, Field, PageHeader, SegmentedControl, useApi } from "@/components/common";
import { qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { CitySelect } from "@/components/AccountFields";
import CardNameInput from "@/components/CardNameInput";
import LazyMap from "@/components/LazyMap";
import { ListingCard, RequestTradeButton } from "@/components/ListingCard";
import { CONDITION_LABELS, CONDITIONS, FINISH_LABELS, FINISHES } from "@shared/validation";
import { cityCoords, nearestCity, RADII } from "@shared/cities";

// First, last, and the pages either side of the current one. Gaps get an ellipsis below.
function pagesToShow(page, totalPages) {
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  return [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
}

export default function Search() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  // Filters live in the URL, so results can be bookmarked or shared and the back button works.
  // The form keeps its own copy until the user presses Search.
  // A fresh visit starts like Marketplace: around your own city, within your meetup range (or 100 km).
  const fresh = params.size === 0;
  const defaultRadius = RADII.includes(user?.travelKm) ? String(user.travelKm) : "100";
  const current = fresh && user ? { city: user.city, radius: defaultRadius } : Object.fromEntries(params);
  const [form, setForm] = useState({ name: "", city: "", radius: "", minQty: "1", condition: "", finish: "", sort: "name", ...current });
  const { data, error, loading, reload } = useApi(`/search${qs(current)}`);
  const [view, setView] = useState("list");
  // The map shows every matching city, not just this page, so it has its own lighter query.
  const { page: _page, sort: _sort, ...mapFilters } = current;
  const cityCounts = useApi(view === "map" ? `/search/cities${qs(mapFilters)}` : null);
  const stores = useApi(view === "map" ? `/stores${qs({ city: current.city, radius: current.radius })}` : null);
  // Browser location: used only to pick the nearest listed city and to draw a dot on this device's map.
  const [myPoint, setMyPoint] = useState(null);
  const [locating, setLocating] = useState(null);

  // set("city") returns an onChange handler for that field.
  const set = (name) => (e) => setForm((f) => ({ ...f, [name]: e.target.value }));
  const useMyLocation = () => {
    if (!navigator.geolocation) return setLocating("Your browser can't share its location.");
    setLocating("Finding you…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setMyPoint([coords.latitude, coords.longitude]);
        setForm((f) => ({ ...f, city: nearestCity(coords.latitude, coords.longitude), radius: f.radius || defaultRadius }));
        setLocating(null);
      },
      () => setLocating("Location is off. Choose your city instead."),
      { maximumAge: 600000, timeout: 10000 },
    );
  };
  // Clicking a city on the map narrows the search to exactly that city.
  const showCity = useCallback((city) => setParams(qs({ ...current, city, radius: "", page: "" }).slice(1)), [current, setParams]);
  const submit = (e) => {
    e.preventDefault();
    setParams(qs({ ...form, page: "" }).slice(1)); // new filters start from page 1
  };
  // Pagination links are real hrefs (so middle-click works) but normal clicks stay in the app.
  const goTo = (page) => (e) => {
    e.preventDefault();
    setParams(qs({ ...current, page }).slice(1));
    window.scrollTo({ top: 0 });
  };
  const hrefFor = (page) => `/search${qs({ ...current, page })}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader title="Search cards" description="Find players near you who have the card you need.">
        <Button asChild variant="outline">
          <Link to="/cards">Look up any card</Link>
        </Button>
      </PageHeader>
      {/* Visitors can look around; trading needs an account. */}
      {!user && (
        <p className="pocket mb-6 px-4 pt-5 pb-3 text-sm">
          You're browsing as a guest. <Link to="/register" className="font-semibold text-primary underline-offset-4 hover:underline">Create a free account</Link> or{" "}
          <Link to="/login?next=/search" className="font-semibold text-primary underline-offset-4 hover:underline">log in</Link> to send trade requests.
        </p>
      )}

      <Card className="mb-8">
        <CardContent>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-12 md:items-end" role="search">
            <Field id="name" label="Card name" className="md:col-span-5">
              <CardNameInput id="name" placeholder="e.g. Lightning Bolt" value={form.name} onChange={set("name")} />
            </Field>
            <div className="relative md:col-span-3">
              <CitySelect id="city-filter" label="Near" value={form.city} onChange={set("city")} includeAny />
              {/* Shortcuts sit on the label's line, so every field in the row lines up. */}
              <div className="absolute top-0 right-0 flex gap-x-3 text-xs">
                {user && form.city !== user.city && (
                  <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setForm((f) => ({ ...f, city: user.city }))}>
                    Use my city
                  </button>
                )}
                <button type="button" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline" onClick={useMyLocation}>
                  <LocateFixed className="size-3" aria-hidden="true" /> My location
                </button>
              </div>
              {locating && <p className="absolute -bottom-5 left-0 text-xs text-muted-foreground" role="status">{locating}</p>}
            </div>
            <Field id="radius" label="Within" className="md:col-span-2">
              <NativeSelect id="radius" value={form.city ? form.radius : ""} onChange={set("radius")} disabled={!form.city} className="w-full">
                <NativeSelectOption value="">This city only</NativeSelectOption>
                {RADII.map((km) => (
                  <NativeSelectOption key={km} value={String(km)}>
                    {km} km
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id="minQty" label="Min. qty" type="number" min={1} max={9999} className="md:col-span-2" value={form.minQty} onChange={set("minQty")} />
            <Field id="condition" label="Condition" className="md:col-span-3">
              <NativeSelect id="condition" value={form.condition} onChange={set("condition")} className="w-full">
                <NativeSelectOption value="">Any</NativeSelectOption>
                {CONDITIONS.map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {CONDITION_LABELS[c]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id="sort" label="Sort by" className="md:col-span-3">
              <NativeSelect id="sort" value={form.sort} onChange={set("sort")} className="w-full">
                <NativeSelectOption value="name">Card name</NativeSelectOption>
                <NativeSelectOption value="quantity">Most available</NativeSelectOption>
                <NativeSelectOption value="newest">Newest listings</NativeSelectOption>
                <NativeSelectOption value="distance">Nearest first</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field id="finish" label="Finish" className="md:col-span-3">
              <NativeSelect id="finish" value={form.finish} onChange={set("finish")} className="w-full">
                <NativeSelectOption value="">Any</NativeSelectOption>
                {FINISHES.map((f) => (
                  <NativeSelectOption key={f} value={f}>
                    {FINISH_LABELS[f]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" size="lg" className="gap-2 md:col-span-3 md:h-10">
              <SearchIcon aria-hidden="true" /> Search
            </Button>
          </form>
        </CardContent>
      </Card>

      <ErrorAlert error={error} title="Search is unavailable" onRetry={reload} />

      <SegmentedControl
        label="Show results as"
        value={view}
        onChange={setView}
        className="mb-4"
        options={[
          { value: "list", label: "List", icon: List },
          { value: "map", label: "Map", icon: MapIcon },
        ]}
      />

      {view === "map" && (
        <div className="mb-8">
          <ErrorAlert error={cityCounts.error} title="The map is unavailable" onRetry={cityCounts.reload} />
          <LazyMap
            cities={cityCounts.data?.cities}
            origin={current.city}
            radiusKm={Number(current.radius) || null}
            stores={stores.data?.stores}
            // Other game stores around the searched city, as places to meet (up to 50 km out).
            spotsNear={cityCoords(current.city) && { center: cityCoords(current.city), radiusKm: Math.min(Number(current.radius) || 25, 50) }}
            myPoint={myPoint}
            onCityClick={showCity}
          />
          <p className="mt-2 text-xs text-muted-foreground">Players appear at their city's centre, never their address.</p>
        </div>
      )}

      {/* Grey placeholder cards while results load. */}
      {view === "list" && loading && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading results">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="pocket p-3 pt-5">
              <Skeleton className="aspect-[488/680] w-full rounded-[4.5%/3.25%]" />
              <Skeleton className="mt-3 h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/2" />
            </div>
          ))}
        </div>
      )}

      {view === "list" && data && (
        <>
          {/* Screen-reader users jump between headings; this one sits between the page title and the cards' own headings. */}
          <h2 className="sr-only">Results</h2>
          <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
            {data.total === 0 ? "No listings found." : `${data.total} listing${data.total === 1 ? "" : "s"} · page ${data.page} of ${data.totalPages}`}
          </p>
          {data.total === 0 ? (
            <EmptyState title="No one nearby has shared that card yet" body="Try a wider distance, another city, a lower minimum quantity or a partial card name." />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" data-testid="search-results">
              {data.results.map((r, i) => (
                <li key={r.id} className="slide-in" style={{ "--i": Math.min(i, 12) }}>
                  <ListingCard item={r} owner={r.owner} distanceKm={r.distanceKm} siblings={data.results.map((x) => x.printing.id)} action={<RequestTradeButton owner={r.owner} item={r} />} />
                </li>
              ))}
            </ul>
          )}
          {data.totalPages > 1 && (
            <Pagination className="mt-8">
              <PaginationContent>
                {data.page > 1 && (
                  <PaginationItem>
                    <PaginationPrevious href={hrefFor(data.page - 1)} onClick={goTo(data.page - 1)} />
                  </PaginationItem>
                )}
                {pagesToShow(data.page, data.totalPages).map((p, i, all) => (
                  <PaginationItem key={p}>
                    {i > 0 && p - all[i - 1] > 1 && <PaginationEllipsis />}
                    <PaginationLink href={hrefFor(p)} onClick={goTo(p)} isActive={p === data.page}>
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                {data.page < data.totalPages && (
                  <PaginationItem>
                    <PaginationNext href={hrefFor(data.page + 1)} onClick={goTo(data.page + 1)} />
                  </PaginationItem>
                )}
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}
    </div>
  );
}
