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
    // The exact spelling people search for ("taptotrade") goes in the title, description and heading.
    title: `${NAME} (TapToTrade.ca) · Trade Magic: The Gathering cards in Canada`,
    description:
      "TapToTrade.ca: find Magic: The Gathering cards in nearby players' collections across Canada and trade in person at a game store. Free, no shipping.",
    heading: "Tap to Trade (TapToTrade.ca): trade Magic: The Gathering cards with players near you",
    text: "List the exact printings you own, search other players' shared binders by card and distance, and send a trade request. Meet in person at a public place or a partner game store. Tap to Trade never handles money or shipping.",
  },
  "/search": {
    title: `Find Magic cards near you · ${NAME}`,
    description: "Search Magic: The Gathering cards that players near you have shared for trade, by card name, city, distance, condition and finish.",
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
    title: `Partner game stores for trading Magic cards · ${NAME}`,
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

/** The browser tab title for a path: the public page's title, or just the site name. */
export const pageTitle = (path) => PUBLIC_PAGES[path]?.title ?? SITE_NAME;

// Titles of pages whose name depends on what they show. The server writes them into the first page load, and the
// pages set the same text when someone reaches them by clicking around the app.
export const profileTitle = (username) => `${username}'s trade binder · ${SITE_NAME}`;
export const storeTitle = (store) => `${store.name}, ${store.city} · Partner game store · ${SITE_NAME}`;
export const NOT_FOUND_TITLE = `Page not found · ${SITE_NAME}`;
