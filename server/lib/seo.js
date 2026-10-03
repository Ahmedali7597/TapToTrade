// Search engine basics for a single-page app: every page the server sends gets its own title, description,
// canonical link, share tags and robots rule, plus a little real HTML for crawlers that don't run JavaScript.
// React replaces that HTML as soon as the app starts. robots.txt, sitemap.xml and llms.txt are built here too.

import { escape } from "../../shared/html.js";
import { EMAILS, NOT_FOUND_TITLE, profileTitle, PUBLIC_PAGES as PUBLIC, SITE_NAME as NAME, storeTitle } from "../../shared/pages.js";
import { storeIdFromSlug, storePath, tagLabel } from "../../shared/stores.js";
import { eventKindLabel, timeZoneFor } from "../../shared/events.js";
import { isoWithOffset } from "./events.js";

/** The public address of the site, e.g. https://taptotrade.ca (APP_BASE_URL in Render). */
export const siteUrl = () => (process.env.APP_BASE_URL ?? "http://localhost:5173").replace(/\/+$/, "");


// Links every crawlable page carries, so the public pages are all one click apart.
const NAV = [
  ["/", "Home"],
  ["/search", "Find cards near you"],
  ["/cards", "Card browser"],
  ["/stores", "Partner game stores"],
  ["/register", "Create a free account"],
  ["/privacy", "Privacy policy"],
  ["/terms", "Terms and trading rules"],
];

// Pages that exist but don't belong in search results: sign-in steps and everything behind a login.
const PRIVATE = /^\/(login|forgot-password|reset-password|verify-email|register\/google|dashboard|inventory|wants|settings|suggestions|moderation|admin|trades(\/new|\/\d+(\/counter)?)?)$/;

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * How the server should present `path`: { status, title, description, robots, canonical, heading, text, home, jsonLd }.
 * `query` is the parsed query string. `find.profile(username)` says whether a public profile exists, and
 * `find.store(id)` returns an active partner store's row (or null), and `find.events(id)` its upcoming events.
 */
export async function pageMeta(path, query = {}, find = {}) {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const page = PUBLIC[clean];
  if (page) {
    // Search results and card lookups with a query are endless variations of one page: crawl, don't index.
    const filtered = (clean === "/search" || clean === "/cards") && Object.keys(query).length > 0;
    return { status: 200, ...page, robots: filtered ? "noindex, follow" : "index, follow", canonical: clean, home: clean === "/" };
  }
  const profile = /^\/u\/([A-Za-z0-9_]{3,24})$/.exec(clean);
  if (profile) {
    // Profiles are public on the site but kept out of search engines, so players' names and cities aren't indexed.
    const found = (await find.profile?.(profile[1])) ?? false;
    return found
      ? { status: 200, title: profileTitle(profile[1]), description: `Cards ${profile[1]} has shared for trade on Tap to Trade.`, robots: "noindex, follow", canonical: clean }
      : notFound();
  }
  const storeSlug = /^\/stores\/([a-z0-9-]{1,80})$/.exec(clean);
  if (storeSlug) {
    // Partner store pages are public business listings, so they're indexed, with LocalBusiness data.
    const id = storeIdFromSlug(storeSlug[1]);
    const store = id && (await find.store?.(id));
    if (!store) return notFound();
    const offers = (store.tags ?? []).map(tagLabel).join(", ").toLowerCase();
    return {
      status: 200,
      title: storeTitle(store),
      description: clip(`${store.name} at ${store.address}, ${store.city} is a Tap to Trade partner store${offers ? `: ${offers}` : ""}. Meet local players there to trade Magic cards.`, 160),
      robots: "index, follow",
      canonical: storePath(store),
      heading: store.name,
      text: `${store.address}, ${store.city}. ${store.notes ?? "A Tap to Trade partner store and official meetup spot for trading Magic: The Gathering cards."}`,
      jsonLd: storeData(siteUrl(), store, (await find.events?.(store.id)) ?? []),
    };
  }
  if (PRIVATE.test(clean)) return { status: 200, title: NAME, description: PUBLIC["/"].description, robots: "noindex, nofollow", canonical: clean };
  return notFound();
}

const notFound = () => ({ status: 404, title: NOT_FOUND_TITLE, description: PUBLIC["/"].description, robots: "noindex, follow", canonical: null });

/** Writes `meta` into the built index.html: head tags, and crawlable text inside #root that React replaces. */
export function renderPage(template, meta) {
  const site = siteUrl();
  const url = meta.canonical ? `${site}${meta.canonical === "/" ? "/" : meta.canonical}` : null;
  // schema.org data: who runs the site on the home page, the business on a store page. "<" is escaped so text
  // from the database can never close the script tag.
  const ld = meta.home ? structuredData(site) : meta.jsonLd;
  const head = [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}" />`,
    `<meta name="robots" content="${meta.robots}" />`,
    url && `<link rel="canonical" href="${url}" />`,
    `<meta property="og:site_name" content="${NAME}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escape(meta.title)}" />`,
    `<meta property="og:description" content="${escape(meta.description)}" />`,
    url && `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${site}/og-image.jpg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:locale" content="en_CA" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    // The scroll film's first frame is only worth preloading on the home page.
    meta.home && `<link rel="preload" as="image" href="/hero/frames/frame_001.webp" fetchpriority="high" />`,
    // Google Maps browser key: public by design (Google only accepts it from this site's address, set in the
    // Cloud console). Without one the app's maps use OpenStreetMap.
    process.env.GOOGLE_MAPS_API_KEY && `<meta name="google-maps-key" content="${escape(process.env.GOOGLE_MAPS_API_KEY)}" />`,
    process.env.GOOGLE_MAPS_API_KEY && `<meta name="google-maps-map-id" content="${escape(process.env.GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID")}" />`,
    ld && `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`,
  ].filter(Boolean);
  const body = meta.heading
    ? `<main class="seo-shell"><h1>${escape(meta.heading)}</h1><p>${escape(meta.text)}</p><nav><ul>${NAV.map(
        ([href, label]) => `<li><a href="${href}">${escape(label)}</a></li>`,
      ).join("")}</ul></nav></main>`
    : "";
  return template
    .replace(/<title>[^<]*<\/title>/, "")
    .replace(/<meta name="description"[^>]*>/, "")
    .replace("</head>", `${head.join("\n    ")}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}

/** schema.org data for the home page: the site's name (for the name Google shows) and who runs it. */
export const structuredData = (site) => ({
  "@context": "https://schema.org",
  "@graph": [
    // Every way people write the name, so search engines tie "taptotrade" searches to this site.
    {
      "@type": "WebSite",
      "@id": `${site}/#website`,
      name: NAME,
      alternateName: ["TapToTrade", "TapToTrade.ca", "Tap to Trade Canada"],
      url: `${site}/`,
      inLanguage: "en-CA",
      publisher: { "@id": `${site}/#org` },
    },
    {
      "@type": "Organization",
      "@id": `${site}/#org`,
      name: NAME,
      alternateName: ["TapToTrade", "TapToTrade.ca"],
      url: `${site}/`,
      logo: `${site}/brand/icon-512.png`,
      description: "A free website for trading Magic: The Gathering cards in person with players nearby, across Canada.",
      areaServed: { "@type": "Country", name: "Canada" },
      email: EMAILS.hello,
      contactPoint: [
        { "@type": "ContactPoint", contactType: "customer support", email: EMAILS.support, availableLanguage: "en" },
        { "@type": "ContactPoint", contactType: "privacy", email: EMAILS.privacy, availableLanguage: "en" },
      ],
    },
  ],
});

/**
 * schema.org data for a partner store page: a local hobby shop with its address and map position, plus its
 * upcoming events (so search engines can show them), each held at the store.
 */
const storeData = (site, store, events = []) => {
  const [locality, region] = store.city.split(", ");
  const address = { "@type": "PostalAddress", streetAddress: store.address, addressLocality: locality, addressRegion: region, addressCountry: "CA" };
  const url = `${site}${storePath(store)}`;
  const shop = {
    "@type": "HobbyShop",
    "@id": `${url}#store`,
    name: store.name,
    url,
    ...(store.website && { sameAs: [store.website] }),
    ...(store.notes && { description: store.notes }),
    address,
    ...(store.lat != null && { geo: { "@type": "GeoCoordinates", latitude: store.lat, longitude: store.lng } }),
  };
  if (!events.length) return { "@context": "https://schema.org", ...shop };
  const zone = timeZoneFor(store.city);
  const eventData = (e) => ({
    "@type": "Event",
    name: e.title,
    startDate: isoWithOffset(e.starts_at, zone),
    ...(e.ends_at && { endDate: isoWithOffset(e.ends_at, zone) }),
    eventStatus: `https://schema.org/${e.cancelled ? "EventCancelled" : "EventScheduled"}`,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    description: e.details ?? `${eventKindLabel(e.kind)} at ${store.name}.`,
    url,
    location: { "@type": "Place", name: store.name, address },
    organizer: { "@type": "Organization", name: store.name, url },
  });
  return { "@context": "https://schema.org", "@graph": [shop, ...events.map(eventData)] };
};

/**
 * robots.txt: search engines and AI search tools may crawl the public pages; the API and private pages are off
 * limits, and crawlers that only collect AI training data are turned away (players' listings aren't training data).
 * Profiles stay crawlable on purpose: their "noindex" tag is what keeps them out of results, and a crawler has to
 * read the page to see it.
 */
export const robotsTxt = () =>
  [
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    ...["/dashboard", "/inventory", "/wants", "/trades", "/settings", "/suggestions", "/moderation", "/admin"].map((p) => `Disallow: ${p}`),
    "",
    ...["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider"].flatMap((bot) => [`User-agent: ${bot}`, "Disallow: /", ""]),
    `Sitemap: ${siteUrl()}/sitemap.xml`,
    "",
  ].join("\n");

/** sitemap.xml with every public page, plus `extra` paths (the partner store pages). */
export const sitemapXml = (extra = []) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...Object.keys(PUBLIC), ...extra]
    .map((p) => `  <url><loc>${escape(`${siteUrl()}${p}`)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;

/** llms.txt (llmstxt.org): a plain summary for AI assistants that read it. Google Search ignores it. */
export const llmsTxt = () =>
  [
    `# ${NAME}`,
    "",
    "> A free website for trading Magic: The Gathering cards in person with players nearby, anywhere in Canada. Players list the exact printings they own, search other players' shared cards by distance, and send trade requests to meet at a public place or a partner game store. No payments or shipping.",
    "",
    "## Pages",
    "",
    ...Object.entries(PUBLIC).map(([p, page]) => `- [${page.heading}](${siteUrl()}${p}): ${page.description}`),
    "",
  ].join("\n");
