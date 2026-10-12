# Tap to Trade

A local Magic: The Gathering inventory and trading website (COMP 10244/10202 capstone). Players across
Canada list the exact printings they own (or import their collection from Moxfield, Archidekt, ManaBox and
others), search nearby players' shared inventories by card and distance, see matches on a map, and negotiate
in-person swaps with requests, optional offers and counter-offers, optionally at a partner game store. A want
list matches the cards a player is looking for against nearby binders (both ways), and players rate each other after
an accepted trade, which builds a public trade record.
Anyone can browse listings, profiles and a Scryfall-powered card browser without an account; tapping any card
opens its rules text, rulings, format legality and Scryfall links. Sign-up works with email and password or
"Continue with Google". Players can send suggestions to the staff. Moderators review reports and suggestions;
an administrator manages moderator roles and partner stores. No payments, shipping or real-time chat
(Milestone 4, section 2).

## Architecture

```
Browser ──> Express 5 (one origin, Render) ──> PostgreSQL (pg, parameterized SQL)
             ├─ /api/*        JSON API: sessions in PostgreSQL, CSRF, rate limits, role checks
             ├─ /healthz      process health
             └─ /*            built React app (client/dist), SPA fallback to index.html
```

- **server/**: Express 5 on Node 24. `app.js` wires Helmet (CSP, anti-framing), the PostgreSQL session
  store (30-minute rolling idle timeout), CSRF, rate limits and the routers. `routes/` holds one file per
  feature area. `lib/` holds pure, unit-tested rules (validation, trade state machine, search SQL builder,
  Argon2id hashing, Scryfall client, email sending, Google OIDC checks, collection-import parsing, page metadata).
  `migrations/`
  holds versioned SQL; `migrate.js` applies it.
- **shared/validation.js**: password policy, registration, quantity and city rules, used by the API
  and by the React forms so users get instant feedback that matches the server.
- **shared/cities.js**: the Canada-wide city list with centre coordinates, plus the distance helpers behind
  radius search, nearest-first sorting, the map and "Use my location".
- **shared/emails.js**: every email the site sends (welcome and confirm-your-email, password reset, moderator
  promotion, trade request, counter-offer, accepted), built from plain data so the server sends exactly what the
  Admin page previews. **shared/stores.js**: partner store tags, readable store links and directions links.
- **client/**: React 19 + Vite + Tailwind v4 with shadcn/ui components (the `@shadcn` set 21st.dev
  republishes), re-themed for the "trade binder" design: light and dark themes (System, Light or Dark in the
  header's Theme menu),
  binder-pocket and card-sleeve styles, rarity-coloured status badges and a self-hosted Bricolage Grotesque
  display face. [DESIGN.md](DESIGN.md) documents the tokens, components and rules. The footer is Efferd UI's
  Minimal Footer from 21st.dev (`components/ui/minimal-footer.jsx`). Magic UI components (MIT) drive the home
  card marquee and a few scroll reveals (Blur Fade); the hero keeps a steady headline and plain buttons, and
  listings use the binder's own slide-in and sleeve sheen. Foil printings get a soft rainbow film over the whole
  card that drifts slowly (still with reduced motion), the way Moxfield shows foils.
  `<MotionConfig reducedMotion="user">` and the CSS reduced-motion rules switch effects off for users who
  ask the OS for less motion. Pages live in `pages/`, feature components in `components/`, and `lib/api.js`
  wraps fetch (CSRF token, friendly errors, session-expiry redirect).
- **Hero** (`components/ScrollHero.jsx`): Ahmed Ali's Blender card-sort film, drawn frame-by-frame onto a canvas
  as you scroll (150 WebP frames). Reduced-motion users get the final still, with no scroll-jacking.
- **Tap-to-trade animation** (`components/TradeSentDialog.jsx` + `public/brand/taptotrade-logo.css`):
  plays when a trade request or counter-offer is sent. The arrow makes one clockwise turn, glides left,
  and "To Trade" slides out from behind it. On entry the header logo's arrow makes the same turn in place,
  with the words already showing so the logo is never caught half-revealed. Clicking any logo (in the dialog,
  the logo itself is the replay button) replays the full sequence.
- **Card view** (`components/CardDetails.jsx`): any card image with a printing id is a button that opens a
  Moxfield-style view: large image, mana symbols, oracle and flavour text, printing and artist, official
  rulings, format legality, a Scryfall market price, and links to Scryfall and to players trading the card.
  Previous/Next (and the arrow keys) walk through the other cards on screen. Data comes from
  `GET /api/cards/:id`, which the server fetches from Scryfall and caches for 24 hours.
- **Showcase cards** (`lib/showcase.js`, `GET /api/cards/showcase`): the home page marquee and binder page,
  the sign-in pages' fanned hand and the card browser's ideas are random on every visit, sampled from a pool of
  about 700 cards the server reads from a few random Scryfall search pages once a day. Images that fail to
  load are retried twice, then swapped for another card.
- **Emails** (`lib/notify.js`, `routes/emails.js`): sign-up sends a thank-you with a confirm-your-email button
  (72 hours, single use, only the hash stored); sending or countering a trade needs a confirmed address, and a
  banner offers a new link until then. Google sign-ups are confirmed by Google. New moderators get an email,
  and players get trade request, counter-offer and accepted emails unless they turn them off in Settings.
  Notification emails only go to confirmed addresses, in the background, so a slow provider never slows a page.
  Admins add their own text to any email (or a footer on all of them) on the Admin page, with a live preview
  and "Send me a test"; the site still builds the links and buttons, so they can't break.
- **Partner stores** (`routes/stores.js`, `pages/Stores.jsx`): a public directory at `/stores` and a page per
  store (`/stores/12-store-name`) with tags (trade night, Commander, drafts, singles, buylist...), hours and
  events, a member perk, Google Maps directions, a map, how many cards are shared within 25 km, and the
  store's own player account (which gets an official store badge on its profile and listings). Featured
  stores appear on the home page. Store pages are indexed with `HobbyShop` structured data and listed in the
  sitemap. The directory ends with the pitch for store owners (partnering is free; write to `hello@`).
- **Store events** (`routes/events.js`, `lib/events.js`, `shared/events.js`, `components/StoreEvents.jsx`): trade
  nights, Commander nights, prereleases and other events on each store page, with the next couple in the
  directory. Admins and the store's own player account add, edit, cancel or remove them right on the store page;
  a weekly event can be posted for 4, 8 or 12 weeks at once (one event per week, so one night can change alone).
  Times are entered and shown in the store's local time zone (from its province, with a few city exceptions).
  `/api/stores/:id/events.ics` is a calendar feed (subscribe from Google, Apple or Outlook) and
  `/api/stores/:id/events/:eventId.ics` adds one event. Store pages carry the events as schema.org `Event` data.
  Changes are written to `mod_actions`.
- **Want lists and matches** (`routes/wants.js`, `lib/wants.js`, `pages/Wants.jsx`): players list the cards they're
  looking for (any printing by default, or one exact printing, in any or one finish). `GET /api/wants/matches` finds
  nearby players (within the meetup range, or a chosen radius) who share a wanted card, and nearby players who want a
  card you share. Players with cards both ways come first, then whoever covers the most wants, then the nearest. Each
  match links to a new proposal with their cards requested and yours offered. The dashboard says how many players near
  you have cards you want.
- **Trader reputation** (`POST /api/trades/:id/feedback`): after an offer is accepted, each player says once whether
  the trade happened and, if it did, rates the other player 1 to 5 stars. A player's completed trades and average
  rating (from feedback others gave them) show on their profile, listings and matches. "It didn't happen" answers and
  who gave which rating stay private.
- **Maps** (`components/TradeMap.jsx`): Google Maps when `GOOGLE_MAPS_API_KEY` is set (the key is written into
  the page as a meta tag, and the CSP only allows Google's map hosts then); otherwise, or if Google refuses
  the key, OpenStreetMap through Leaflet. Both draw the same markers (styled in `index.css`): a bubble per city
  with its listing count, gold pins for partner stores, the two players on a trade page, and a legend under the
  map. On the Google map only, teal pins show other game stores nearby from Google Places (around the searched
  city, and on a pending or accepted trade around the halfway point between the two players, `meetupArea` in
  `shared/cities.js`), with a directions link. Cost controls in the Google Cloud project: a CA$5 monthly budget
  with email alerts at 50/90/100%, map loads capped at 320 a day and Places text searches at 160 a day (both
  inside Google's free monthly allowance), every other Maps and Places feature at 0, and the key restricted to
  taptotrade.ca and those two APIs. The Google map follows the site's theme (and so the device, by default),
  rebuilding itself with the Map ID's light or dark style when the theme changes; the brand-coloured styles are
  in `docs/map-styles/` (Google Cloud's map style JSON: paste into a new style's JSON tab and press Apply).
- **Card name suggestions** (`components/CardNameInput.jsx`, `GET /api/cards/autocomplete`): every card-name box
  (search, card browser, dashboard, add card, want list) suggests names as you type, from Scryfall's autocomplete
  (cached for a day; card names already saved here if Scryfall is down). It's an ARIA combobox: arrow keys,
  Enter and Escape work, and picking a name runs that box's search.
- **Display and accessibility** (`components/DisplayMenu.jsx`, `lib/display.js`, `public/theme-init.js`): the
  Settings card lets anyone, signed in or not, pick the theme (light, dark or match the device), a larger text size,
  reduce motion (stops the hero film, card rows, foil drift and other animations, on top of the device setting),
  higher contrast and underlined links. Choices are saved on the device and applied before the first paint.
  The Terms page's accessibility statement explains them. The header has just a sun and moon button that
  switches between light and dark.
- **Feedback and motion**: success draws a green check (Face ID style), failure draws a red X and shakes the
  form; buttons press in, switches spring, the selected segment slides, dialogs spring open and pages ease in.
  See DESIGN.md "Motion".

## Assumptions (where Milestone 4 leaves a decision open)

| Topic | Decision |
| --- | --- |
| Stock policy (9.2) | **Arrangement-only.** Accepting rechecks that every card is still listed with enough quantity, but never reserves stock. When a player confirms the trade happened, the cards they gave come off their inventory (deleted, or the quantity lowered) and the cards they got are added as private listings (or added to a matching listing). The UI says so. |
| Search & profiles | Public, so visitors can see what's out there before signing up, and Wizards' Fan Content Policy asks for Magic content to be free to view without registering. Trading, inventory, reports and suggestions need an account. A signed-in player's own listings are left out of their search results. |
| Counter-offers | The recipient of a pending version creates a new version with the parties swapped; the old one becomes `countered` atomically. Only the current recipient can act. |
| Roles (4.7) | Admins switch users between `user` and `moderator`. Admin accounts are bootstrapped with `npm run make-admin`, not through the UI. Moderators act on users; admins also on moderators; nobody on admins. |
| Account deletion (4.2.4) | Anonymize instead of hard delete: listings, reset tokens and sessions are removed and pending proposals declined; trade snapshots and moderation records are kept. |
| Finish | Each listing records non-foil, foil or etched foil, limited to the finishes Scryfall lists for that printing. The same printing and condition in two finishes are two listings. Search can filter by finish. |
| Cities | A controlled, Canada-wide list grouped by province or territory (`shared/validation.js`), stored as "City, PROV" so names shared across provinces stay distinct. Never an address. |
| Distance and map | Distances are measured between city centres (GeoNames coordinates, about 1 km precision), never addresses. Search takes a radius (10–250 km) around any city and can sort nearest first; a fresh search starts around your city within your meetup range (or 100 km). The map (Leaflet + OpenStreetMap tiles) shows matches per city and partner stores. "Use my location" runs only in the browser and snaps to the nearest listed city. |
| Meetup range | Optional "I'll travel up to N km", shown on the profile and used as the default search radius. |
| Partner stores | Admins add game stores as official meetup spots (exact address allowed, since they're public businesses), retire them instead of deleting, and every change is logged in `mod_actions`. A proposal version can suggest one; retired stores can't be picked. |
| Google sign-in | OpenID Connect authorization-code flow with state and nonce, server side. A Google-verified email links to an existing account with that email; otherwise the player picks a username and city. Google-only accounts have no password (`password_hash = '!'`) until they set one in Settings, and need one before changing email or deleting the account. Hidden until `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set. |
| Collection import | CSV exports from Moxfield, Archidekt, ManaBox, Deckbox, TCGplayer, Dragon Shield, MTGGoldfish and TopDecked (detected by header names), or text lists like `4 Lightning Bolt (M10) 146 *F*`. Printings resolve through Scryfall's bulk lookup (Scryfall id, then set + number, then name + set, then name). Rows matching an existing listing add to it (capped at 9999); unknown rows are reported by line. Up to 5,000 rows per import. Export writes Moxfield's CSV format. |
| Email | 15 emails through Resend's HTTPS API (sign-up, confirm email, password reset and change, email change, account deletion, trade request/counter/accept/decline, moderator promotion, listing removed, suspension and reinstatement, report received), written once in `shared/emails.js`. `npm run emails:sync` uploads them to Resend as templates (it needs a Resend key with Full access in `.env`; Render keeps a Sending-only key); with `EMAIL_TEMPLATES=resend` the app sends those templates, so their wording can be edited in Resend's dashboard, and falls back to its built-in copy if Resend refuses one. Admins can also add a note to any email from the Admin page. Trade emails can be turned off in Settings; account notices only go to confirmed addresses. Without `EMAIL_API_KEY` in development, emails are printed to the server console. |
| Skipped (optional or not yet approved) | MFA, avatars, real-time chat. |

## Changes from the Milestone 4 plan

Section 1 of the revised Milestone 4 asks for changes to be documented. Each row is a decision made during
development; record the professor's approval for each one in the final report.

| Change | Plan reference | Why |
| --- | --- | --- |
| Search, public profiles, the card browser and store pages work without an account | 2, 4.4 ("registered users") | Wizards' Fan Content Policy asks for Magic content to be free to view; trading still needs an account |
| Public profiles also show a trader rating, completed-trade count, meetup range and store badge | 4.2.1, 10.4 | Ratings come from both players' own answers after an accepted trade (a self-reported completion process) |
| Optional features delivered: Google sign-in, collection import and export, distance search and map, dark mode | 4.1.6, 4.3.5, 4.4.5, 2 | Built after the mandatory requirements were complete |
| Added features not in the plan: want lists with matches, partner game stores and their events, suggestions | 2 | Help players find trades and safe public places to meet |
| Meeting coordination is a suggested partner store only (no proposed time or confirmation step) | 9.2 | Smallest version that keeps meetups public |

## Placeholders you need to fill

| What | Where |
| --- | --- |
| `SESSION_SECRET` | `.env` (generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) |
| `DATABASE_URL`, `TEST_DATABASE_URL` | `.env` (local defaults match `docker-compose.yml`) |
| `EMAIL_API_KEY`, `EMAIL_FROM`, `EMAIL_TEMPLATES`, `APP_BASE_URL` | `.env` / Render settings (Resend key, `Tap to Trade <support@taptotrade.ca>` once the domain is verified, and the public address). See [Domain, email and search engines](#domain-email-and-search-engines). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `.env` / Render settings (Google Cloud OAuth client, redirect URI `<APP_BASE_URL>/api/auth/google/callback`) |
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID` (optional) | Render settings. A Maps JavaScript API key restricted to `https://taptotrade.ca/*` (and `www`), plus a Map ID from Google Cloud's Map Management (`DEMO_MAP_ID` is used if it's missing). Without a key the maps use OpenStreetMap. |
| `SEED_PASSWORD` | `.env`: password for the fictional seed accounts (local only; never seed production) |
| `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE` | GitHub repository secrets, for `.github/workflows/backup.yml` |
| Hero frames | Already generated in `client/public/hero/frames/`. To regenerate, see [Hero frames](#hero-frames). |

## Domain, email and search engines

- **Domain:** `taptotrade.ca` is registered at Squarespace and added to the Render service as a custom domain
  (`www` redirects to it). Squarespace DNS: delete the "Squarespace Defaults" records, then add an `A` record
  `@` → `216.24.57.1` and a `CNAME` `www` → `taptotrade.onrender.com` (no `AAAA` records). Render issues the
  HTTPS certificate once the records resolve.
- **Switching over:** set `APP_BASE_URL=https://taptotrade.ca` in Render after the domain shows "Verified".
  That one setting moves canonical links, the sitemap, reset-email links and Google sign-in to the new address,
  and makes the server 301-redirect the old `.onrender.com` address there. Add
  `https://taptotrade.ca/api/auth/google/callback` to the Google OAuth client's redirect URIs first.
- **Receiving email:** Squarespace email forwarding sends three addresses (`shared/pages.js` `EMAILS`) to the
  owner's inbox: `hello@` (general, footer "Contact"), `support@` (account help, accessibility) and `privacy@`
  (the privacy policy's access and correction requests).
- **Sending email:** the site's emails (welcome and confirmation, password resets, moderator promotions, trade
  updates) go through Resend from `support@taptotrade.ca`, not a "no-reply" address, so a player who replies
  reaches a person. The wording lives in `shared/emails.js`; admins add their own text on the Admin page
  ("Email messages"), not in Resend, so the links in each email stay correct. The domain is
  verified in Resend with the DKIM, SPF and MX records Resend lists (on the `send` and `resend._domainkey`
  names, so they don't touch the forwarding MX records), then `EMAIL_API_KEY` and `EMAIL_FROM` are set in Render.
- **Search engines** (`server/lib/seo.js`, `shared/pages.js`): the server writes each page's title,
  description, canonical link, Open Graph tags and robots rule into `index.html`, plus a short crawlable
  summary that React replaces. Public pages are indexed; search results with filters, profiles (players'
  privacy) and signed-in pages are `noindex`; unknown paths return a real 404. `/robots.txt` keeps crawlers
  out of the API and private pages and turns away AI training crawlers; `/sitemap.xml` lists the public pages;
  `/llms.txt` summarizes the site for AI assistants; the home page carries `WebSite` and `Organization`
  structured data and each partner store page `HobbyShop` data; `og-image.jpg` is the share preview. Verify the domain in Google Search Console (a DNS
  `TXT` record at Squarespace) and submit `https://taptotrade.ca/sitemap.xml`.
- **City pages** (`/trade/hamilton-on`, `pages/City.jsx`, `routes/cities.js`): one page per listed city for searches
  like "trade MTG cards in Hamilton": players and listings within 25 km, the cards most of them share, partner
  stores nearby and their next events. Counts and card names only, never usernames, and card names only once
  3 players are nearby. A city is indexed and in the sitemap once it has a partner store, or players of its own
  and 3 within 25 km (`cityIndexable` in `shared/pages.js`); quieter cities get a `noindex` page so they aren't
  thin. Home and the store directory link to the active ones. Off-site steps that help ranking are in
  [docs/seo-checklist.md](docs/seo-checklist.md).

## Run it locally

Prerequisites: Node.js 24 LTS, plus PostgreSQL 15+ (Docker or a native install).

```bash
npm install
```

```bash
docker compose up -d
```

Docker creates both `taptotrade` and `taptotrade_test`. With a native PostgreSQL install, create those two databases yourself.

```bash
cp .env.example .env
```

Then edit `.env` and set `SESSION_SECRET` (and the database URLs if yours differ).

```bash
npm run migrate
```

```bash
npm run seed
```

The seed script adds 104 real printings and 8 fictional players (`<username>@example.test`, password = `SEED_PASSWORD`), including `ttt_admin` and `ttt_moderator`.

```bash
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to Express on :3000.

Production-style run (Express serves the built client on one port):

```bash
npm run build
```

```bash
npm start
```

## Tests

| Command | What | Count |
| --- | --- | --- |
| `npm test` | Jest unit tests for server rules and React components (UT-01…UT-10, FE-01/03/05/06/08 in jsdom, plus distances, Google token checks, collection-import parsing, want matching and ratings, store event times and calendar files, every email template, the 404 page, card name suggestions, meetup areas) | 206 |
| `npm run test:coverage` | Same server tests with the 80% core-module coverage gate (section 6.1) | 99% lines |
| `npm run test:api` | Jest + Supertest against a real PostgreSQL test DB (AT-01…AT-10, ST-01/02/03/05 and the 6.6 extras: ownership, CSRF, stale counters, repeated and concurrent acceptance, reset-token reuse and expiry, suspension, deletion, username changes, radius search, meetup ranges, partner stores, Google sign-in, collection import and export, want lists, matches, trade ratings and inventory updates after a confirmed trade, store events and calendar feeds, card name suggestions, account and trade emails including the Resend template path) | 69 |
| `npm run test:load -- <site> 100 60 1000` | Load test: 100 simulated visitors browsing for 60 s (5.4.2, 5.4.3). Results in `docs/test-evidence.md` | 0 failed, search p95 0.6 s |
| `npm run test:security -- <site>` | Read-only security checks: headers, cookie flags, CSRF, logins, injection, error pages, hidden files (6.4) | 35 |
| `npm run test:e2e` | Cypress FE-01…FE-08 against the running, seeded app on :3000 | 8 |
| `npm run test:postman -- --env-var seedPassword=<SEED_PASSWORD>` | Postman collection through Newman (AT-01…AT-10) against the running, seeded app | 14 assertions |

`test:api` drops and recreates the schema of `TEST_DATABASE_URL`, so never point it at real data. Run `npm run build` first: the page tests read the built `client/dist/index.html`.
CI (`.github/workflows/ci.yml`) runs unit, coverage, API tests and the build on every push and PR.
Accessibility (axe, Lighthouse), load, security (including the OWASP ZAP baseline scan) and browser trade-journey
and backup restore results are recorded in `docs/test-evidence.md`.

## Security controls (5.1, 5.2)

Argon2id password hashes (19 MiB, t=2) · parameterized SQL everywhere · React output encoding (no
`dangerouslySetInnerHTML`) · Helmet CSP with `frame-ancestors 'none'` · sessions in PostgreSQL, HttpOnly,
Secure in production, SameSite=Lax, 30-minute rolling idle expiry · session regeneration on login ·
synchronizer-token CSRF · rate limits on auth and the API · server-side ownership, role and suspension
checks on every request · reset and email-confirmation tokens stored only as SHA-256 hashes, single-use,
60-minute and 72-hour expiry · trade requests need a confirmed email ·
sessions revoked on password change, reset, suspension and deletion · auth-failure log lines with ids
only · every moderator/admin action written to `mod_actions`.

## Operational records and retention (4.2.1)

| Record | Purpose | Retention |
| --- | --- | --- |
| `users` | account, role, status, and which terms version was accepted at sign-up (and when) | until deletion, then anonymized |
| `session` | sign-in state | 30 min idle; deleted on logout, revocation or expiry |
| `password_resets` | reset links (hash only) | deleted with the account; expired rows can be purged |
| `email_verifications` | confirm-your-email links (hash only) | deleted with the account; used and expired rows can be purged |
| `email_texts` | admin-written text added to emails | until an admin removes it; changes are logged in `mod_actions` |
| `stores` | partner stores (public business details) | kept; retired rather than deleted, since old proposals point at them |
| `store_events` | partner store events (public business information) | kept; past events simply stop showing |
| `trade_requests`, `trade_request_items` | proposal versions and card snapshots | kept for both parties' history |
| `want_items` | cards a player is looking for | until removed; deleted with the account |
| `trade_feedback` | whether an accepted trade happened, and its 1-5 star rating | kept, like trade history; the author is anonymized if their account is deleted |
| `reports`, `mod_actions` | moderation evidence and accountability | kept; the reporter reference survives deletion |
| `suggestions` | ideas and problem reports sent to the staff | kept; the author is anonymized if their account is deleted |
| Server logs (auth failures) | security monitoring, ids only | host log retention |

## Backups and restore (5.5.1)

`backup.yml` runs daily at 07:30 UTC. It streams `pg_dump --format=custom` through AES-256 `gpg` into a
private workflow artifact kept for 14 days; GitHub emails the owner if a run fails. To restore into an
isolated database:

```bash
gpg --decrypt taptotrade-YYYYMMDDTHHMMZ.dump.gpg > restore.dump
```

```bash
pg_restore --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" restore.dump
```

With `sslmode=verify-full` in the URL, add `&sslrootcert=system` so the Postgres tools trust the system's root certificates. `--no-acl` skips Neon's own admin privileges, which a normal role isn't allowed to recreate (the app's tables come back owned by the restoring role). Use `pg_restore` 18 or newer, since production runs Postgres 18 (for example `docker run --rm -it -v "$PWD:/w" postgres:18 pg_restore ...`). Afterwards, compare row counts with production.

## Deploy (Render + Neon, section 8)

- **Build command:** `npm ci --include=dev && npm run build`. The `--include=dev` matters: with `NODE_ENV=production`, npm would otherwise skip Vite.
- **Start command:** `npm start`
- **Health check path:** `/healthz`
- **Environment:** `NODE_ENV=production`, `DATABASE_URL` (with `?sslmode=verify-full`), `SESSION_SECRET`, `APP_BASE_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, and optionally `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID`.
- **Migrations:** run `npm run migrate` as a separate, deliberate step (e.g. a Render shell or job) before switching traffic.
- **First admin:** create the account through the site, then run `npm run make-admin -- you@example.com`.

## Hero frames

Source: the 300-frame 1920×1080 render in `Blender_Card_Sort/bedroom_hq/frames/`. Every second frame, scaled to 1280 px, gives about 8.8 MB of WebP:

```bash
ffmpeg -framerate 30 -i Blender_Card_Sort/bedroom_hq/frames/frame_%04d.png -vf "select=not(mod(n\,2)),scale=1280:-2" -fps_mode vfr -c:v libwebp -quality 72 -start_number 1 client/public/hero/frames/frame_%03d.webp
```

If you change the frame count, update `FRAME_COUNT` in `client/src/components/ScrollHero.jsx`.

## Credits

Hero card-sort film by Ahmed Ali (Blender).
Curved arrow by dh park, Noun Project, CC BY 3.0 (credited in the footer; see
`client/public/brand/ATTRIBUTION.md`). Bricolage Grotesque by Mathieu Triay (SIL Open Font License). City coordinates from GeoNames (CC BY 4.0). Maps by Leaflet with
© OpenStreetMap contributors. Card data and images from Scryfall; Magic: The Gathering ©
Wizards of the Coast. This is an independent student project, not affiliated with Wizards of the Coast.
