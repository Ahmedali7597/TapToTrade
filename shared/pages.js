// Titles and descriptions of the public pages, shared by the server (search engines, share previews) and the
// React app (the browser tab title as people move between pages).

export const SITE_NAME = "Tap to Trade";

// The date shown on the terms and privacy pages. Change it whenever their wording changes: every sign-up
// records which version the player agreed to (users.terms_version).
export const TERMS_UPDATED = "October 2026";

// Public email addresses, each forwarded to the owner's inbox by Squarespace (README "Domain, email and search
// engines"). One per job, so a privacy request or a locked-out player never gets lost among general mail.
export const EMAILS = {
  hello: "hello@taptotrade.ca", // general questions, partnerships, game stores
  support: "support@taptotrade.ca", // account help; password-reset emails come from here, so replies reach a person
  privacy: "privacy@taptotrade.ca", // access, correction and deletion requests (PIPEDA)
};
const NAME = SITE_NAME;

// Public pages worth finding in search, in sitemap order.
export const PUBLIC_PAGES = {
  "/": {
    // Leads with "MTG trading", what players type into Google, then the exact brand spelling ("TapToTrade").
    // The title stays under ~65 characters and the description under ~155 so search results don't cut them off.
    title: "MTG Trading in Canada: Trade Magic Cards Locally · TapToTrade.ca",
    description:
      "MTG trading across Canada: find Magic: The Gathering cards in nearby players' binders and trade in person at a local game store. Free, no shipping.",
    heading: "Tap to Trade (TapToTrade.ca): local MTG trading across Canada, in person",
    text: "List the exact printings you own, search other players' shared binders by card and distance, and send a trade request. Meet in person at a public place or a partner game store. Tap to Trade never handles money or shipping.",
  },
  "/search": {
    title: `Find MTG cards near you to trade · ${NAME}`,
    description: "Search Magic: The Gathering (MTG) cards that players near you have shared for trade, by card name, city, distance, condition and finish.",
    heading: "Find Magic cards near you",
    text: "Search the cards local players have shared for trade, on a list or a map, and see how far away each one is.",
  },
  "/cards": {
    title: `Magic card browser: rules and legality · ${NAME}`,
    description: "Look up any Magic: The Gathering card: rules text, official rulings, format legality and who near you is trading it.",
    heading: "Magic: The Gathering card browser",
    text: "Look up any card to read its rules text, rulings and format legality, then find players who have it for trade.",
  },
  "/stores": {
    title: `Partner game stores for trading MTG cards · ${NAME}`,
    description: "Local game stores across Canada that host trade nights and welcome Tap to Trade players as a safe, public place to meet and trade Magic cards.",
    heading: "Partner game stores",
    text: "Find a local game store to meet at and see what each one offers: trade nights, Commander, drafts, singles and perks for Tap to Trade players. Run a store? Partner with us.",
  },
  "/register": {
    title: `Create a free account · ${NAME}`,
    description: "Join Tap to Trade for free to list your Magic: The Gathering cards and trade with players in your city.",
    heading: "Create a free account",
    text: "Only your username and city are public. Your email stays private.",
  },
  "/privacy": {
    title: `Privacy policy · ${NAME}`,
    description: "What Tap to Trade collects, what is public, where it is stored and how to get a copy or delete your account.",
    heading: "Privacy policy",
    text: "We collect as little as we can and never sell it.",
  },
  "/terms": {
    title: `Terms and trading rules · ${NAME}`,
    description: "The rules for trading Magic: The Gathering cards in person through Tap to Trade.",
    heading: "Terms and trading rules",
    text: "Trades are arranged and completed in person. Be honest, be respectful and meet somewhere public.",
  },
};

// Titles of pages kept out of search (no description or crawlable text), so the tab still says where you are.
const PRIVATE_TITLES = {
  "/login": `Log in · ${NAME}`,
  "/forgot-password": `Reset your password · ${NAME}`,
  "/reset-password": `Choose a new password · ${NAME}`,
  "/verify-email": `Confirm your email · ${NAME}`,
  "/register/google": `Finish signing up · ${NAME}`,
  "/dashboard": `Dashboard · ${NAME}`,
  "/inventory": `Your inventory · ${NAME}`,
  "/wants": `Your want list · ${NAME}`,
  "/decks": `Your decks · ${NAME}`,
  "/trades": `Trades · ${NAME}`,
  "/trades/new": `New trade · ${NAME}`,
  "/settings": `Account settings · ${NAME}`,
  "/suggestions": `Suggestions · ${NAME}`,
  "/moderation": `Moderation · ${NAME}`,
  "/admin": `Admin · ${NAME}`,
};

/**
 * The home page's questions and answers: shown on the page, written into the server HTML, and marked up as an
 * FAQPage for search engines (the same words in all three, as Google asks). `links` are [path, label] pairs.
 */
export const HOME_FAQ = [
  {
    q: "How does MTG trading on Tap to Trade work?",
    a: "List the Magic: The Gathering cards you own, down to the exact printing. Search for a card and see which players near you have it, then send a trade request offering cards of your own. When the other player accepts, you agree on a public place and time and trade in person.",
  },
  {
    q: "Is Tap to Trade free?",
    a: "Yes. There are no fees and no subscriptions. Tap to Trade never handles money or shipping: you trade cards for cards, face to face.",
  },
  {
    q: "Where in Canada can I trade Magic cards?",
    a: "Anywhere in Canada. Set your city and search from 10 to 250 km around it, on a list or a map. Each city has its own page with nearby players and partner game stores.",
    links: [
      ["/trade/toronto-on", "Toronto"],
      ["/trade/montreal-qc", "Montréal"],
      ["/trade/vancouver-bc", "Vancouver"],
      ["/trade/calgary-ab", "Calgary"],
      ["/trade/ottawa-on", "Ottawa"],
      ["/trade/edmonton-ab", "Edmonton"],
      ["/trade/winnipeg-mb", "Winnipeg"],
      ["/trade/hamilton-on", "Hamilton"],
      ["/trade/halifax-ns", "Halifax"],
    ],
  },
  {
    q: "Can I import my collection from Moxfield or Archidekt?",
    a: "Yes. Upload the collection CSV from Moxfield, Archidekt, ManaBox, Deckbox, TCGplayer or Dragon Shield, or paste a card list. Imported cards stay private until you choose which ones to share for trade.",
  },
  {
    q: "How do I know what my cards are worth?",
    a: "Every card shows a reference price in Canadian dollars: the TCGplayer market price converted at the Bank of Canada's daily rate, or Face to Face Games' price when there's no market price. Trades show the total on each side.",
  },
  {
    q: "Is it safe to trade cards with players I don't know?",
    a: "You only ever meet in public, often at a partner game store. Players rate each other after a trade, anyone can report a problem to the moderators, and your email and exact location are never shown.",
  },
  {
    q: "Can I build decks and find the cards I'm missing?",
    a: "Yes. The deck builder checks Commander, Modern, Standard and other format rules, suggests cards for your commander from EDHREC, and shows which cards you already own. Add the rest to your want list to find players nearby who have them.",
  },
];

/** The browser tab title for a path: the page's own title, or just the site name. */
export function pageTitle(path) {
  const title = PUBLIC_PAGES[path]?.title ?? PRIVATE_TITLES[path];
  if (title) return title;
  // One proposal (/trades/12) or its counter-offer page (/trades/12/counter).
  if (/^\/trades\/\d+\/counter$/.test(path)) return `Counter-offer · ${NAME}`;
  if (/^\/trades\/\d+$/.test(path)) return `Trade proposal · ${NAME}`;
  if (/^\/decks\/\d+$/.test(path)) return `Deck · ${NAME}`;
  return SITE_NAME;
}

// Titles of pages whose name depends on what they show. The server writes them into the first page load, and the
// pages set the same text when someone reaches them by clicking around the app.
export const profileTitle = (username) => `${username}'s trade binder · ${SITE_NAME}`;
export const storeTitle = (store) => `${store.name}, ${store.city} · Partner game store · ${SITE_NAME}`;
export const NOT_FOUND_TITLE = `Page not found · ${SITE_NAME}`;

// City landing pages (/trade/hamilton-on). Counts cover players within CITY_RADIUS_KM of the city centre.
export const CITY_RADIUS_KM = 25;
export const cityTitle = (city) => `Trade MTG cards in ${city} · ${SITE_NAME}`;
export const cityHeading = (city) => `Trade Magic: The Gathering cards in ${city}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** One sentence on what's happening near a city, from its stats (see cityStats in server/routes/cities.js). */
export function citySummary({ city, radiusKm, players, listings, stores }) {
  const shared = players > 0 ? `${plural(players, "player")} within ${radiusKm} km of ${city} have shared ${plural(listings, "card listing")} for trade` : `No one near ${city} has shared cards yet`;
  const meet = stores.length > 0 ? `, and ${plural(stores.length, "partner game store")} nearby host${stores.length === 1 ? "s" : ""} trades` : "";
  return `${shared}${meet}.`;
}
/**
 * Whether a city page goes in search results and the sitemap: the city has a partner store of its own, or players of
 * its own and at least 3 within the radius. Quieter cities still get a page, kept out of search so it isn't thin.
 */
export const cityIndexable = ({ localStores, localPlayers, players }) => localStores > 0 || (localPlayers > 0 && players >= 3);
