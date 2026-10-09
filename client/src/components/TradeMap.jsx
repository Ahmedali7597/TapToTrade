import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { cityCoords, distanceKm } from "@shared/cities";

// Map of matches per city, partner stores, suggested meetup spots and (only in this browser) the viewer's own
// position. Players are only ever drawn at their city's centre, like Marketplace's approximate areas, so the map
// never reveals more than the city they chose.
//
// Google Maps draws it when the server sends a Maps key (GOOGLE_MAPS_API_KEY, written into the page as a meta
// tag); otherwise, or if Google refuses the key, OpenStreetMap does. Both draw the same markers (styled in
// index.css under "Map markers"). Suggested spots are game stores found by Google Places, so they only appear on
// the Google map (Google's terms keep Places results on Google maps).
const CANADA = [56.1, -96.3];
const NONE = []; // stable default, so a missing list doesn't count as new data on every render

// Popups are built with DOM nodes and textContent, so names can never inject HTML.
function popup(title, lines, { action, link } = {}) {
  const box = document.createElement("div");
  box.className = "ttt-popup";
  const h = document.createElement("strong");
  h.textContent = title;
  box.append(h);
  for (const line of lines.filter(Boolean)) {
    const p = document.createElement("div");
    p.textContent = line;
    box.append(p);
  }
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    box.append(btn);
  }
  if (link) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = link.label;
    box.append(a);
  }
  return box;
}

// Marker artwork. Only fixed strings go into innerHTML; names and counts are set with textContent.
const PIN = '<svg viewBox="0 0 32 42" aria-hidden="true"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z"/></svg>';
const GLYPHS = {
  // A storefront awning for partner stores, a card for suggested spots.
  store: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1.5-4h-13zM5 10v9h14v-9M10 19v-5h4v5"/></svg>',
  spot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3.5" width="12" height="17" rx="2"/><path d="M9.5 9.5l2.5-2.5 2.5 2.5-2.5 2.5z"/></svg>',
};

/**
 * The HTML element for one marker. Pins point at their spot with their tip; bubbles and dots sit centred on it.
 * Leaflet places the element's top-left corner on the point and Google its bottom centre, so `provider` decides
 * the shift.
 */
function markerElement(p, provider) {
  const el = document.createElement("div");
  el.className = `ttt-marker ttt-marker--${p.kind}`;
  if (p.kind === "store" || p.kind === "spot") {
    el.innerHTML = PIN + GLYPHS[p.kind];
  } else if (p.kind === "city" || p.kind === "person") {
    el.textContent = p.text;
    if (p.size) el.style.setProperty("--size", `${p.size}px`);
  }
  const tip = p.kind === "store" || p.kind === "spot";
  el.style.transform = provider === "leaflet" ? (tip ? "translate(-50%, -100%)" : "translate(-50%, -50%)") : tip ? "" : "translateY(50%)";
  return el;
}

/** Everything to draw, the same for both map providers: an optional search ring and a list of markers. */
function features({ cities, people, origin, radiusKm, stores, spots, myPoint, onCityClick }) {
  const center = origin && cityCoords(origin);
  const points = [];
  for (const c of cities) {
    const at = cityCoords(c.city);
    if (!at) continue;
    points.push({
      kind: "city",
      at,
      text: String(c.listings),
      size: 30 + Math.min(22, Math.sqrt(c.players) * 5),
      title: `${c.city}: ${c.listings} listing${c.listings === 1 ? "" : "s"}`,
      popup: () =>
        popup(c.city, [`${c.players} player${c.players === 1 ? "" : "s"}`, `${c.listings} matching listing${c.listings === 1 ? "" : "s"}`], {
          action: onCityClick && { label: "Show only this city", onClick: () => onCityClick(c.city) },
        }),
    });
  }
  // People on a trade page: "You" and the other player, each at their city's centre.
  for (const person of people) {
    const at = cityCoords(person.city);
    if (at) points.push({ kind: "person", at, text: person.label, title: `${person.label}: ${person.city}`, popup: () => popup(person.label, [person.city]) });
  }
  for (const s of stores) {
    const at = s.lat != null ? [s.lat, s.lng] : cityCoords(s.city);
    if (!at) continue;
    points.push({ kind: "store", at, title: `${s.name} (partner store)`, popup: () => popup(s.name, ["Partner store, official meetup spot", s.address, s.city, s.website]) });
  }
  for (const s of spots) {
    points.push({
      kind: "spot",
      at: s.at,
      title: `${s.name} (suggested spot)`,
      popup: () => popup(s.name, ["Game store nearby, a public place to meet", s.address], { link: s.url && { href: s.url, label: "Directions in Google Maps" } }),
    });
  }
  if (myPoint) points.push({ kind: "me", at: myPoint, title: "You (only shown on your device)" });
  return { ring: center && radiusKm ? { center, radiusKm } : null, center, points };
}

/** Under the map: what each kind of marker means, for the kinds actually shown. */
function Legend({ points }) {
  const kinds = new Set(points.map((p) => p.kind));
  const items = [
    ["city", "Players with matching cards (number of listings)"],
    ["person", "You and the other player, at your cities' centres"],
    ["store", "Partner game store, official meetup spot"],
    ["spot", "Other game store nearby, a public place to meet"],
    ["me", "You, from your browser (never sent to us)"],
  ].filter(([kind]) => kinds.has(kind));
  if (!items.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
      {items.map(([kind, text]) => (
        <li key={kind} className="flex items-center gap-2">
          <span className={`ttt-legend ttt-legend--${kind}`} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  );
}

// ---------- OpenStreetMap (Leaflet) ----------

function LeafletMap({ data, singleZoom, className, label }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  // Create the map once.
  useEffect(() => {
    map.current = L.map(el.current, { scrollWheelZoom: false }).setView(CANADA, 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      // OpenStreetMap's tile policy requires a Referer; send just our origin.
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    // Leaflet measures its box once; if the page layout settles afterwards, tiles would stop short of the edge.
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.current.invalidateSize());
    resize?.observe(el.current);
    return () => {
      resize?.disconnect();
      map.current.remove();
    };
  }, []);

  // Redraw everything when the data changes, then fit the view to what's shown.
  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const bounds = [];
    if (data.ring) {
      const ring = L.circle(data.ring.center, { radius: data.ring.radiusKm * 1000, className: "ttt-ring", weight: 1.5, dashArray: "6 6" }).addTo(g);
      bounds.push(...[ring.getBounds().getNorthWest(), ring.getBounds().getSouthEast()].map((p) => [p.lat, p.lng]));
    } else if (data.center) {
      bounds.push(data.center);
    }
    for (const p of data.points) {
      bounds.push(p.at);
      // A zero-size icon box: the marker element positions itself from the point (see markerElement).
      const icon = L.divIcon({ html: markerElement(p, "leaflet"), className: "ttt-leaflet-icon", iconSize: [0, 0] });
      // Leaflet stacks markers by latitude; lift people and cities above stores, like on the Google map.
      const zIndexOffset = { me: 4000, person: 3000, city: 2000 }[p.kind] ?? 0;
      const m = L.marker(p.at, { icon, title: p.title, keyboard: Boolean(p.popup), zIndexOffset }).bindTooltip(p.title, { offset: [0, -8] });
      if (p.popup) m.bindPopup(p.popup());
      m.addTo(g);
    }
    if (bounds.length > 1) map.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    else if (bounds.length === 1) map.current.setView(bounds[0], singleZoom);
  }, [data, singleZoom]);

  return <div ref={el} className={`z-0 w-full overflow-hidden rounded-xl border ${className}`} role="region" aria-label={label} />;
}

// ---------- Google Maps ----------

const meta = (name) => (typeof document === "undefined" ? null : document.querySelector(`meta[name="${name}"]`)?.content || null);

// One script load per page, shared by every map. Rejects if the script can't load or Google refuses the key.
let googleLoad;
function loadGoogle(key) {
  googleLoad ??= new Promise((resolve, reject) => {
    window.__tttMapsReady = () => resolve(window.google.maps);
    // Google calls this when the key is wrong or not allowed on this address.
    window.gm_authFailure = () => reject(new Error("Google Maps refused the key"));
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, v: "weekly", loading: "async", libraries: "marker", callback: "__tttMapsReady", region: "CA", language: "en" })}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps didn't load"));
    document.head.append(script);
  });
  return googleLoad;
}

// Places searches already made on this page, so moving between list and map doesn't search (and bill) again.
const spotSearches = new Map();

/**
 * Game stores within `radiusKm` of `center`, from Google Places text search (one request, at most 8 results).
 * Google treats the area as a hint, so results further out are dropped here. Places that are closed, or that are
 * already partner stores (within 150 m of one), are left out too.
 * The project's daily Places quota caps the cost; when it's used up, this just finds nothing.
 */
function findSpots(apiKey, { center, radiusKm }, partners) {
  const key = `${center[0].toFixed(3)},${center[1].toFixed(3)},${radiusKm}`;
  if (!spotSearches.has(key)) {
    spotSearches.set(
      key,
      loadGoogle(apiKey)
        .then((maps) => maps.importLibrary("places"))
        .then(({ Place }) =>
          Place.searchByText({
            textQuery: "trading card game store",
            fields: ["displayName", "formattedAddress", "location", "googleMapsURI", "businessStatus"],
            locationBias: { center: { lat: center[0], lng: center[1] }, radius: Math.min(50, radiusKm) * 1000 },
            maxResultCount: 8,
            region: "ca",
            language: "en",
          }),
        )
        .then(({ places }) =>
          places
            .filter((p) => p.location && (p.businessStatus ?? "OPERATIONAL") === "OPERATIONAL")
            .map((p) => ({ name: p.displayName, address: p.formattedAddress, url: p.googleMapsURI, at: [p.location.lat(), p.location.lng()] }))
            .filter((spot) => distanceKm(center, spot.at) <= radiusKm),
        )
        .catch(() => []),
    );
  }
  const isPartner = (spot) => partners.some((p) => p.lat != null && distanceKm([p.lat, p.lng], spot.at) < 0.15);
  return spotSearches.get(key).then((spots) => spots.filter((spot) => !isPartner(spot)));
}

function GoogleMap({ data, singleZoom, className, label, apiKey, dark, onFail }) {
  const el = useRef(null);
  const state = useRef(null); // { maps, map, Marker, info, drawn: [] }
  const [ready, setReady] = useState(false);

  // Load the API and create the map once.
  useEffect(() => {
    let live = true;
    loadGoogle(apiKey)
      .then(async (maps) => {
        const [{ Map, InfoWindow }, { AdvancedMarkerElement }] = await Promise.all([maps.importLibrary("maps"), maps.importLibrary("marker")]);
        if (!live) return;
        const map = new Map(el.current, {
          center: { lat: CANADA[0], lng: CANADA[1] },
          zoom: 4,
          mapId: meta("google-maps-map-id") ?? "DEMO_MAP_ID",
          // Picks the Map ID's light or dark style (set up in Google Cloud). Google only reads this when the map is
          // created, so TradeMap rebuilds the map when the theme changes.
          colorScheme: dark ? "DARK" : "LIGHT",
          gestureHandling: "cooperative", // page scrolls normally; two fingers (or Ctrl + scroll) move the map
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          clickableIcons: false,
        });
        state.current = { maps, map, Marker: AdvancedMarkerElement, info: new InfoWindow(), drawn: [] };
        setReady(true);
      })
      .catch(() => live && onFail());
    return () => {
      live = false;
    };
  }, [apiKey, dark, onFail]);

  // Redraw when the data changes, then fit the view to what's shown. If Google throws while drawing (it does
  // when it refuses the key just after loading), switch to OpenStreetMap like any other Google failure.
  useEffect(() => {
    const s = state.current;
    if (!ready || !s) return;
    try {
      draw(s, data, singleZoom);
    } catch {
      onFail();
    }
  }, [ready, data, singleZoom, onFail]);

  return <div ref={el} className={`z-0 w-full overflow-hidden rounded-xl border bg-muted ${className}`} role="region" aria-label={label} />;
}

/** Clears the Google map `s` and draws `data` on it (see GoogleMap). */
function draw(s, data, singleZoom) {
  // Circles come off with setMap(null); advanced markers by clearing their map.
  for (const d of s.drawn) {
    if (d.setMap) d.setMap(null);
    else d.map = null;
  }
  s.drawn = [];
  s.info.close();
  const bounds = new s.maps.LatLngBounds();
  const ll = ([lat, lng]) => ({ lat, lng });
  const teal = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#006b61";
  let count = 0;
  if (data.ring) {
    const ring = new s.maps.Circle({ map: s.map, center: ll(data.ring.center), radius: data.ring.radiusKm * 1000, strokeColor: teal, strokeWeight: 1.5, fillColor: teal, fillOpacity: 0.06, clickable: false });
    s.drawn.push(ring);
    bounds.union(ring.getBounds());
    count += 2;
  } else if (data.center) {
    bounds.extend(ll(data.center));
    count++;
  }
  for (const p of data.points) {
    // People and cities sit above stores, and "you" above everything, when they overlap.
    const zIndex = { me: 4, person: 3, city: 2 }[p.kind] ?? 1;
    const marker = new s.Marker({ map: s.map, position: ll(p.at), content: markerElement(p, "google"), title: p.title, zIndex, gmpClickable: Boolean(p.popup) });
    if (p.popup) {
      marker.addEventListener("gmp-click", () => {
        s.info.setContent(p.popup());
        s.info.open({ map: s.map, anchor: marker });
      });
    }
    s.drawn.push(marker);
    bounds.extend(ll(p.at));
    count++;
  }
  if (count > 1) {
    s.map.fitBounds(bounds, 40);
    // Don't zoom in past neighbourhood level when everything is close together.
    s.maps.event.addListenerOnce(s.map, "idle", () => s.map.getZoom() > 12 && s.map.setZoom(12));
  } else if (count === 1) {
    s.map.setCenter(bounds.getCenter());
    s.map.setZoom(singleZoom);
  }
}

/**
 * Whether the page is dark right now. /theme-init.js sets <html data-theme> and fires "ttt:display" whenever it
 * changes: from the header's theme button, Settings, or the device switching while the choice is "system".
 */
function useDarkTheme() {
  const isDark = () => document.documentElement.dataset.theme === "dark";
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const update = () => setDark(isDark());
    window.addEventListener("ttt:display", update);
    return () => window.removeEventListener("ttt:display", update);
  }, []);
  return dark;
}

/**
 * @param cities    [{ city, listings, players }] from /api/search/cities
 * @param people    [{ city, label }] players to show at their city's centre (the trade page)
 * @param origin    "City, PROV" the search is centred on (optional)
 * @param radiusKm  search radius drawn around the origin (optional)
 * @param stores    [{ id, name, address, city, lat, lng, website }] partner meetup spots
 * @param spotsNear { center: [lat, lng], radiusKm } to also show other game stores nearby (Google map only)
 * @param myPoint   [lat, lng] from the browser's geolocation; drawn locally, never sent to the server
 * @param onCityClick called with a city name to narrow the search to it
 * @param singleZoom  zoom level when there's only one thing on the map (a store page zooms in close)
 */
export default function TradeMap({
  cities = NONE,
  people = NONE,
  origin,
  radiusKm,
  stores = NONE,
  spotsNear,
  myPoint,
  onCityClick,
  singleZoom = 10,
  className = "h-[28rem]",
  label = "Map of matching players by city and meetup spots",
}) {
  const [apiKey] = useState(() => meta("google-maps-key"));
  const [failed, setFailed] = useState(false);
  const [onFail] = useState(() => () => setFailed(true));
  const google = Boolean(apiKey) && !failed;
  // The OpenStreetMap tiles and the markers follow the theme through CSS; the Google map needs rebuilding.
  const dark = useDarkTheme();

  // Other game stores nearby, looked up once per area. Only with the Google map, per Google's terms.
  const [spots, setSpots] = useState(NONE);
  const area = spotsNear && `${spotsNear.center.join(",")},${spotsNear.radiusKm}`;
  useEffect(() => {
    if (!google || !spotsNear) return setSpots(NONE);
    let live = true;
    findSpots(apiKey, spotsNear, stores).then((found) => live && setSpots(found));
    return () => {
      live = false;
    };
    // `area` stands in for spotsNear, which is a new object on every render.
  }, [google, apiKey, area, stores]);

  // Kept in a ref so a new handler on each parent render doesn't redraw (and re-zoom) the map.
  const onClick = useRef(onCityClick);
  onClick.current = onCityClick;
  const clickable = Boolean(onCityClick);
  const data = useMemo(
    () => features({ cities, people, origin, radiusKm, stores, spots, myPoint, onCityClick: clickable && ((city) => onClick.current?.(city)) }),
    [cities, people, origin, radiusKm, stores, spots, myPoint, clickable],
  );
  const props = { data, singleZoom, className, label };
  return (
    <div>
      {google ? <GoogleMap key={dark ? "dark" : "light"} {...props} apiKey={apiKey} dark={dark} onFail={onFail} /> : <LeafletMap {...props} />}
      <Legend points={data.points} />
    </div>
  );
}
