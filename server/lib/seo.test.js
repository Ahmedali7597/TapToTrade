import { llmsTxt, pageMeta, renderPage, robotsTxt, sitemapXml, structuredData } from "./seo.js";

const STORE = { id: 7, name: "The Mana Vault", address: "1 King St W", city: "Hamilton, ON", lat: 43.25, lng: -79.87, website: "https://example.com", notes: "Trade tables </script> on Fridays", tags: ["trade_night", "commander"] };
const TEMPLATE = `<!doctype html><html lang="en-CA"><head><meta name="description" content="old" /><title>Old</title></head><body><div id="root"></div></body></html>`;

beforeEach(() => {
  process.env.APP_BASE_URL = "https://taptotrade.ca/";
});
afterAll(() => {
  delete process.env.APP_BASE_URL;
});

describe("page metadata", () => {
  test("public pages are indexable with their own title and a canonical path", async () => {
    const home = await pageMeta("/");
    expect(home).toMatchObject({ status: 200, robots: "index, follow", canonical: "/", home: true });
    expect((await pageMeta("/cards/")).canonical).toBe("/cards"); // trailing slash folds into one URL
  });

  test("search results and card lookups with a query are crawled but not indexed", async () => {
    expect((await pageMeta("/search", { name: "bolt" })).robots).toBe("noindex, follow");
    expect((await pageMeta("/cards", { q: "doom" })).robots).toBe("noindex, follow");
    expect((await pageMeta("/search", {})).robots).toBe("index, follow");
  });

  test("profiles exist for real players only and are never indexed", async () => {
    const found = await pageMeta("/u/hamilton_brewer", {}, { profile: async (name) => name === "hamilton_brewer" });
    expect(found).toMatchObject({ status: 200, robots: "noindex, follow", title: expect.stringContaining("hamilton_brewer") });
    expect((await pageMeta("/u/nobody_here", {}, { profile: async () => false })).status).toBe(404);
  });

  test("partner store pages are indexed under their readable link, with local business data", async () => {
    const find = { store: async (id) => (id === 7 ? STORE : null) };
    const page = await pageMeta("/stores/7-old-name", {}, find);
    expect(page).toMatchObject({ status: 200, robots: "index, follow", canonical: "/stores/7-the-mana-vault", heading: "The Mana Vault" });
    expect(page.title).toBe("The Mana Vault, Hamilton, ON · Partner game store · Tap to Trade");
    expect(page.description).toContain("trade night, commander night");
    expect(page.description.length).toBeLessThanOrEqual(160);
    expect(page.jsonLd).toMatchObject({
      "@type": "HobbyShop",
      address: { streetAddress: "1 King St W", addressLocality: "Hamilton", addressRegion: "ON", addressCountry: "CA" },
      geo: { latitude: 43.25, longitude: -79.87 },
      sameAs: ["https://example.com"],
    });
    expect((await pageMeta("/stores/8", {}, find)).status).toBe(404);
    expect((await pageMeta("/stores/not-a-number", {}, find)).status).toBe(404);
    expect((await pageMeta("/stores")).robots).toBe("index, follow");
  });

  test("a store's upcoming events go into its structured data, in the store's local time", async () => {
    const event = { title: "Friday trade night", kind: "trade_night", starts_at: new Date("2026-10-09T22:00:00Z"), ends_at: null, details: null, cancelled: false };
    const find = { store: async () => STORE, events: async () => [event, { ...event, title: "Prerelease", cancelled: true }] };
    const { jsonLd } = await pageMeta("/stores/7", {}, find);
    const [shop, night, prerelease] = jsonLd["@graph"];
    expect(shop).toMatchObject({ "@type": "HobbyShop", name: "The Mana Vault" });
    expect(night).toMatchObject({
      "@type": "Event",
      name: "Friday trade night",
      startDate: "2026-10-09T18:00:00-04:00",
      eventStatus: "https://schema.org/EventScheduled",
      description: "Trade night at The Mana Vault.",
      location: { "@type": "Place", name: "The Mana Vault", address: { addressLocality: "Hamilton" } },
    });
    expect(night).not.toHaveProperty("endDate");
    expect(prerelease.eventStatus).toBe("https://schema.org/EventCancelled");
  });

  test("signed-in pages stay out of search; unknown paths are real 404s", async () => {
    for (const p of ["/dashboard", "/wants", "/trades", "/trades/12", "/trades/12/counter", "/trades/new", "/settings", "/admin", "/login"]) {
      expect(await pageMeta(p)).toMatchObject({ status: 200, robots: "noindex, nofollow" });
    }
    expect(await pageMeta("/wp-admin")).toMatchObject({ status: 404, canonical: null });
    expect((await pageMeta("/trades/abc")).status).toBe(404);
  });
});

describe("rendered page", () => {
  test("writes title, description, canonical, share tags and crawlable text; React's root keeps its id", async () => {
    const html = renderPage(TEMPLATE, await pageMeta("/cards"));
    expect(html).not.toContain("<title>Old</title>");
    expect(html.match(/<meta name="description"/g)).toHaveLength(1);
    expect(html).toContain('<link rel="canonical" href="https://taptotrade.ca/cards" />');
    expect(html).toContain('<meta property="og:image" content="https://taptotrade.ca/og-image.jpg" />');
    expect(html).toMatch(/<div id="root"><main class="seo-shell"><h1>Magic: The Gathering card browser<\/h1>/);
    expect(html).toContain('<a href="/search">');
    expect(html).not.toContain("application/ld+json"); // structured data and the film preload are home-page only
  });

  test("the home page carries structured data and the hero preload; 404s carry no canonical", async () => {
    const home = renderPage(TEMPLATE, await pageMeta("/"));
    expect(home).toContain('<script type="application/ld+json">');
    expect(home).toContain('rel="preload" as="image"');
    expect(home).toContain('<link rel="canonical" href="https://taptotrade.ca/" />');
    const missing = renderPage(TEMPLATE, await pageMeta("/nope"));
    expect(missing).not.toContain('rel="canonical"');
    expect(missing).toContain('<div id="root"></div>');
  });

  test("store pages carry their structured data, and database text can't close the script tag", async () => {
    const html = renderPage(TEMPLATE, await pageMeta("/stores/7", {}, { store: async () => STORE }));
    expect(html).toContain('"@type":"HobbyShop"');
    expect(html).not.toContain("</script> on Fridays");
    expect(html).toContain("\\u003c/script> on Fridays");
  });

  test("a Google Maps key is written in only when one is set", async () => {
    expect(renderPage(TEMPLATE, await pageMeta("/search"))).not.toContain("google-maps-key");
    process.env.GOOGLE_MAPS_API_KEY = "AIza-test";
    try {
      const html = renderPage(TEMPLATE, await pageMeta("/search"));
      expect(html).toContain('<meta name="google-maps-key" content="AIza-test" />');
      expect(html).toContain('<meta name="google-maps-map-id" content="DEMO_MAP_ID" />');
    } finally {
      delete process.env.GOOGLE_MAPS_API_KEY;
    }
  });

  test("text is escaped", () => {
    const html = renderPage(TEMPLATE, { status: 200, title: 'A "quoted" <b>title</b>', description: "x & y", robots: "index, follow", canonical: "/" });
    expect(html).toContain("<title>A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt;</title>");
    expect(html).toContain('content="x &amp; y"');
  });
});

test("structured data names the site and its organisation", () => {
  const data = structuredData("https://taptotrade.ca");
  expect(data["@graph"].map((n) => n["@type"])).toEqual(["WebSite", "Organization"]);
  expect(data["@graph"][0]).toMatchObject({ name: "Tap to Trade", url: "https://taptotrade.ca/" });
});

test("robots.txt, sitemap.xml and llms.txt use the public address", () => {
  const robots = robotsTxt();
  expect(robots).toContain("Disallow: /api/");
  expect(robots).toMatch(/User-agent: GPTBot\nDisallow: \//);
  expect(robots).not.toContain("Disallow: /u/"); // profiles must be readable to see their noindex
  expect(robots).toContain("Sitemap: https://taptotrade.ca/sitemap.xml");
  const sitemap = sitemapXml();
  expect(sitemap).toContain("<loc>https://taptotrade.ca/</loc>");
  expect(sitemap).toContain("<loc>https://taptotrade.ca/cards</loc>");
  expect(sitemap).not.toContain("/dashboard");
  expect(sitemapXml(["/stores/7-the-mana-vault"])).toContain("<loc>https://taptotrade.ca/stores/7-the-mana-vault</loc>");
  expect(llmsTxt()).toMatch(/^# Tap to Trade\n\n> /);
});
