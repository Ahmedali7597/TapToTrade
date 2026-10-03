// Partner store details shared by the server (validation, sitemap) and the app (store pages, admin form).

/** What a store can offer. Admins tick these; players filter the store directory by them. */
export const STORE_TAGS = [
  { value: "trade_night", label: "Trade night" },
  { value: "commander", label: "Commander night" },
  { value: "fnm", label: "Friday Night Magic" },
  { value: "draft", label: "Drafts and prereleases" },
  { value: "singles", label: "Sells singles" },
  { value: "buylist", label: "Buys cards" },
  { value: "play_space", label: "Open play space" },
  { value: "other_tcgs", label: "Other card games" },
  { value: "accessible", label: "Step-free access" },
];
const LABELS = Object.fromEntries(STORE_TAGS.map((t) => [t.value, t.label]));
export const tagLabel = (value) => LABELS[value] ?? value;

/** "Snapcaster's Games & Café" -> "snapcasters-games-cafe" (for readable store links). */
export const slugify = (name) =>
  String(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** A store's page: /stores/12-snapcasters-games. Only the number matters, so old names keep working. */
export const storePath = (store) => `/stores/${store.id}${slugify(store.name) ? `-${slugify(store.name)}` : ""}`;

/** Store id from a /stores/:slug value, or null. */
export const storeIdFromSlug = (slug) => {
  const m = /^(\d{1,12})(?:-[a-z0-9-]*)?$/.exec(String(slug ?? ""));
  return m ? Number(m[1]) : null;
};

/** Google Maps directions to a store (a plain link: no Maps API key needed). */
export const directionsUrl = (store) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${store.name}, ${store.address}, ${store.city}`)}`;
