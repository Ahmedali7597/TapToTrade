import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { BadgeCheck, CalendarClock, ExternalLink, Gift, MapPin, Navigation, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { EmptyState, ErrorAlert, PageHeader, PageMessage, Spinner, useApi } from "@/components/common";
import LazyMap from "@/components/LazyMap";
import { NextEvents, StoreEvents } from "@/components/StoreEvents";
import { qs } from "@/lib/api";
import { EMAILS, SITE_NAME, storeTitle } from "@shared/pages";
import { directionsUrl, STORE_TAGS, tagLabel } from "@shared/stores";

const Tags = ({ tags }) =>
  tags.length > 0 && (
    <ul className="flex flex-wrap gap-1.5" aria-label="What this store offers">
      {tags.map((t) => (
        <li key={t}>
          <Badge variant="secondary">{tagLabel(t)}</Badge>
        </li>
      ))}
    </ul>
  );

/** Directions (Google Maps) and the store's own website. */
function StoreLinks({ store, size = "sm" }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size={size} variant="outline">
        <a href={directionsUrl(store)} target="_blank" rel="noopener noreferrer">
          <Navigation aria-hidden="true" /> Directions
        </a>
      </Button>
      {store.website && (
        <Button asChild size={size} variant="ghost">
          <a href={store.website} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" /> Website
          </a>
        </Button>
      )}
    </div>
  );
}

// What partnering means, for store owners reading the directory.
const PARTNER_PERKS = [
  "An official meetup spot on every player's map and in trade requests",
  "A store page with your trade nights, events, hours and directions",
  "A spot in the featured partners on the home page",
  "A verified badge on your store's own listings and profile",
];

function PartnerPitch() {
  const mail = `mailto:${EMAILS.hello}?subject=${encodeURIComponent("Partner store")}`;
  return (
    <section className="mt-14 grid gap-6 border-t pt-10 md:grid-cols-[1fr_1.4fr]" aria-labelledby="partner-heading" id="partner">
      <div>
        <h2 id="partner-heading" className="text-2xl font-bold">
          Run a game store?
        </h2>
        <p className="mt-2 text-muted-foreground">
          Partnering is free. Players who trade at your store browse your singles, join your events and come back. You promote {SITE_NAME} at your trade
          nights, and we send local players your way.
        </p>
        <Button asChild className="mt-5">
          <a href={mail}>Become a partner store</a>
        </Button>
        {/* One string (a single text node), so the space before the address can't be dropped ("write tohello@"). */}
        <p className="mt-2 text-xs text-muted-foreground">{`Or write to ${EMAILS.hello}.`}</p>
      </div>
      <ul className="grid gap-3 self-center">
        {PARTNER_PERKS.map((perk) => (
          <li key={perk} className="flex gap-3">
            <BadgeCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** One store in the directory. */
function StoreRow({ store }) {
  return (
    <li className="grid gap-3 border-t py-6 first:border-t-0 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold">
            <Link to={store.path} className="underline-offset-4 hover:underline">
              {store.name}
            </Link>
          </h2>
          {store.featured && <Badge>Featured partner</Badge>}
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4" aria-hidden="true" /> {store.address}, {store.city}
          {store.distanceKm != null && <span>· {store.distanceKm === 0 ? "In your city" : `${store.distanceKm} km away`}</span>}
        </p>
        <Tags tags={store.tags} />
        {store.perk && (
          <p className="flex items-start gap-2 text-sm">
            <Gift className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              <span className="font-semibold">Member perk:</span> {store.perk}
            </span>
          </p>
        )}
        {store.hours && (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {store.hours}
          </p>
        )}
        <NextEvents events={store.nextEvents} />
      </div>
      <StoreLinks store={store} />
    </li>
  );
}

/** Public directory of partner game stores, with a tag filter, a map, and the pitch for store owners. */
export function Stores() {
  const { data, error, loading, reload } = useApi("/stores");
  const [tag, setTag] = useState("");
  const stores = useMemo(() => data?.stores ?? [], [data]);
  const shown = useMemo(() => (tag ? stores.filter((s) => s.tags.includes(tag)) : stores), [stores, tag]);
  // Only offer the tags some store actually has.
  const tags = STORE_TAGS.filter((t) => stores.some((s) => s.tags.includes(t.value)));
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <PageHeader
        title="Partner game stores"
        description="Local game stores that welcome Tap to Trade players. Meet at one for a public, friendly place to trade, and see what each store hosts."
      />
      <ErrorAlert error={error} onRetry={reload} />
      {/* The list's space is reserved while it loads, so the section below doesn't jump down when it arrives. */}
      <div className="min-h-64">
        {loading && <Spinner label="Loading stores" />}
        {data && stores.length === 0 && (
          <EmptyState title="No partner stores yet" body="We're talking with local game stores now. Know a great one? Tell them about us.">
            <Button asChild variant="outline">
              <a href="#partner">How partnering works</a>
            </Button>
          </EmptyState>
        )}
        {stores.length > 0 && (
          <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-start">
            <div>
              {tags.length > 1 && (
                <div className="mb-2 flex items-center gap-3">
                  <Label htmlFor="store-tag" className="shrink-0">
                    Show
                  </Label>
                  <div className="w-full sm:w-64">
                    <NativeSelect id="store-tag" value={tag} onChange={(e) => setTag(e.target.value)} className="w-full">
                    <NativeSelectOption value="">All partner stores</NativeSelectOption>
                    {tags.map((t) => (
                      <NativeSelectOption key={t.value} value={t.value}>
                        {t.label}
                      </NativeSelectOption>
                    ))}
                    </NativeSelect>
                  </div>
                </div>
              )}
              {shown.length === 0 ? (
                <EmptyState title="No stores with that tag yet" />
              ) : (
                <ul aria-label="Partner stores">
                  {shown.map((s) => (
                    <StoreRow key={s.id} store={s} />
                  ))}
                </ul>
              )}
            </div>
            {/* Sticky on a wrapper: Google Maps sets position: relative on its own element. */}
            <div className="lg:sticky lg:top-24">
              <LazyMap stores={shown} className="h-80 lg:h-[30rem]" label="Map of partner game stores" />
            </div>
          </div>
        )}
      </div>
      <PartnerPitch />
    </div>
  );
}

/** One partner store's page: what it offers, upcoming events, the member perk, its map, and cards shared nearby. */
export function StorePage() {
  const { slug } = useParams();
  const { data, error, loading, reload } = useApi(`/stores/${encodeURIComponent(slug)}`);
  const store = data?.store;
  const pin = useMemo(() => (store ? [store] : []), [store]);
  useEffect(() => {
    if (store) document.title = storeTitle(store);
  }, [store]);

  // After an event change the page reloads in place, so only the first load shows a spinner.
  if (loading && !data) return <Spinner label="Loading store" />;
  if (error?.status === 404) return <PageMessage title="Store not found" body="This store isn't a partner any more, or the link is wrong." action={<Button asChild><Link to="/stores">See partner stores</Link></Button>} />;
  if (error) return <div className="mx-auto max-w-5xl px-4 py-10"><ErrorAlert error={error} onRetry={reload} /></div>;

  const { nearby, events = [], canManage = false } = data;
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="mb-3 text-sm">
        <Link to="/stores" className="font-medium text-primary underline-offset-4 hover:underline">
          Partner game stores
        </Link>
      </p>
      <div className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold sm:text-4xl">{store.name}</h1>
            {store.featured && <Badge>Featured partner</Badge>}
          </div>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="size-4" aria-hidden="true" /> {store.address}, {store.city}
          </p>
        </div>
        <StoreLinks store={store} size="default" />
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        <div className="grid content-start gap-8">
          <p className="max-w-[65ch] text-lg">
            {store.notes ?? `${store.name} is a ${SITE_NAME} partner store and an official meetup spot for trading Magic: The Gathering cards.`}
          </p>
          {store.tags.length > 0 && (
            <section aria-labelledby="offers-heading" className="grid gap-3">
              <h2 id="offers-heading" className="font-semibold">
                What's on
              </h2>
              <Tags tags={store.tags} />
            </section>
          )}
          <StoreEvents store={store} events={events} canManage={canManage} onChange={reload} />
          {store.hours && (
            <section aria-labelledby="hours-heading" className="grid gap-1">
              <h2 id="hours-heading" className="font-semibold">
                Hours and events
              </h2>
              <p className="whitespace-pre-line text-muted-foreground">{store.hours}</p>
            </section>
          )}
          {store.perk && (
            <section aria-labelledby="perk-heading" className="rounded-xl border border-primary/25 bg-accent/50 p-5">
              <h2 id="perk-heading" className="flex items-center gap-2 font-semibold">
                <Gift className="size-5 text-primary" aria-hidden="true" /> Member perk
              </h2>
              <p className="mt-1">{store.perk}</p>
              <p className="mt-2 text-sm text-muted-foreground">Show your {SITE_NAME} profile at the counter.</p>
            </section>
          )}
          <section aria-labelledby="nearby-heading" className="grid gap-3 border-t pt-6">
            <h2 id="nearby-heading" className="font-semibold">
              Trading near {store.name}
            </h2>
            <p className="text-muted-foreground">
              {nearby.listings > 0
                ? `${nearby.listings} card listings shared by ${nearby.players} player${nearby.players === 1 ? "" : "s"} within ${nearby.radiusKm} km.`
                : `No one within ${nearby.radiusKm} km has shared cards yet. List yours and be the first.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={`/search${qs({ city: store.city, radius: nearby.radiusKm })}`}>Find cards near this store</Link>
              </Button>
              {store.account && (
                <Button asChild variant="outline">
                  <Link to={`/u/${store.account}`}>
                    <Store aria-hidden="true" /> The store's own binder
                  </Link>
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Pick {store.name} as the meetup spot when you send a trade request. Meet during open hours and be kind to the store's space.
            </p>
          </section>
        </div>
        <LazyMap stores={pin} singleZoom={store.lat != null ? 15 : 11} className="h-80 lg:h-[26rem]" label={`Map showing ${store.name}`} />
      </div>
    </div>
  );
}
