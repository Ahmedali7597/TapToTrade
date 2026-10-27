<p align="center">
  <img src="client/public/brand/icon-512.png" alt="Tap to Trade logo" width="96" height="96">
</p>

# Tap to Trade

[![CI](https://github.com/Ahmedali7597/TapToTrade/actions/workflows/ci.yml/badge.svg)](https://github.com/Ahmedali7597/TapToTrade/actions/workflows/ci.yml)
[![Live site](https://img.shields.io/badge/live-taptotrade.ca-2ea44f)](https://taptotrade.ca)
[![Node.js 24](https://img.shields.io/badge/node-24-339933?logo=node.js&logoColor=white)](.nvmrc)

Tap to Trade is a free website that helps Magic: The Gathering players across Canada trade cards in person. Players list the cards they own, find nearby players who have the cards they need, and send trade requests to meet somewhere public, like a local game store. It's built with React, Express and PostgreSQL, and it's live at [taptotrade.ca](https://taptotrade.ca).

## Features

- **Inventory:** add cards by name and printing, or import a collection export from Moxfield, Archidekt, ManaBox, Deckbox, TCGplayer and similar sites. Browse it as a list or as a card binder.
- **Want lists:** list the cards you're looking for and see which nearby players have them.
- **Search:** find a card by name and city, with results shown on a map.
- **Trades:** send a trade request, talk it through in the trade's conversation and agree on a public meetup spot. Messages and meetup changes appear live.
- **Notifications:** a bell for trade activity, with email choices for each kind of update.
- **Reputation:** after a trade, both players confirm it happened and rate each other from 1 to 5 stars.
- **Prices:** card prices in Canadian dollars for reference, from Scryfall (TCGplayer market price) and Face to Face Games. Tap to Trade never handles money.
- **Stores and events:** a directory of local game stores and their upcoming events.
- **Decks:** a deck builder with Commander card suggestions from EDHREC.
- **Safety:** player reports, a moderation queue and a slur filter on messages and usernames.

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React 19, React Router, Vite, Tailwind CSS, Radix UI, Leaflet |
| Backend | Node.js 24, Express 5, express-session with a PostgreSQL session store |
| Database | PostgreSQL (Neon in production) with plain SQL migrations |
| Email | Resend |
| Testing | Jest, Testing Library, Supertest, Cypress, Postman and Newman, OWASP ZAP |
| Hosting | Render |

## Getting started

You need Node.js 24 (see `.nvmrc`) and Docker for the local database.

```bash
git clone https://github.com/Ahmedali7597/TapToTrade.git
cd TapToTrade
npm install
cp .env.example .env    # then set SESSION_SECRET
docker compose up -d    # PostgreSQL with the app and test databases
npm run migrate
npm run seed            # optional: fictional players and inventories
npm run dev
```

The site opens at http://localhost:5173, and Vite forwards `/api` to the Express server on port 3000.

Google sign-in, Google Maps and email sending are optional. Without their keys, the Google button is hidden, maps use OpenStreetMap and emails are printed to the server console. `.env.example` explains each setting.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the API and the web app together, reloading on changes |
| `npm run build` | Builds the web app into `client/dist` |
| `npm start` | Starts the server, which serves the built app and the API from one origin |
| `npm run migrate` | Applies new database migrations (`npm run migrate:down` rolls the last one back) |
| `npm run seed` | Adds fictional players and inventories for local testing (safe to re-run) |
| `npm run make-admin -- <email>` | Gives an existing account the admin role |
| `npm run emails:sync` | Creates the email templates in Resend (add `-- --update` to replace existing ones) |

## Testing

| Command | What it covers |
| --- | --- |
| `npm test` | Unit and component tests (Jest and Testing Library) |
| `npm run test:coverage` | Server unit tests with a coverage report |
| `npm run test:api` | API integration tests against a real PostgreSQL database (`TEST_DATABASE_URL`). Run `npm run build` first. |
| `npm run test:e2e` | End-to-end browser tests with Cypress. Needs the built app running with seed data (`npm run seed && npm run build && npm start`). |
| `npm run test:postman` | The Postman collection, run with Newman against a local server |
| `npm run test:load -- <site>` | Load test with simulated visitors (100 users for 60 seconds by default) |
| `npm run test:security -- <site>` | Read-only checks of security headers, cookies and CSRF protection |

GitHub Actions runs the unit tests, the build and the API tests on every pull request and every push to `main`. The latest OWASP ZAP baseline scan is in [`docs/`](docs/).

## Security

- Passwords are hashed with Argon2id.
- Sessions use httpOnly, SameSite cookies stored in PostgreSQL, and every request that changes data needs a CSRF token.
- Helmet sends a strict Content Security Policy with no inline scripts, along with anti-framing, referrer and permissions headers.
- API requests are rate limited.
- Secrets stay in environment variables and are never sent to the browser.

## Project structure

```
client/     React app: pages, components and styles; public/ holds brand images and hero frames
server/     Express API: routes/, lib/ (logic with its unit tests), migrations/, seed/ and test/
shared/     Validation and data used by both the client and the server, with tests
cypress/    End-to-end tests
postman/    API collection for Newman
docs/       Map styles and the OWASP ZAP report
```

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.
