# Test evidence

Results for the Milestone 4 testing plan (section 6) that aren't covered by `npm test` and `npm run test:api`.
Each section says how to repeat the run. Dates are when the run happened; the commit is the code that was tested.

## Load and response time (5.4.2, 5.4.3, 6.6)

Run on 2026-10-02 at commit `698c134` with `npm run test:load -- <site> <visitors> <seconds> <pause ms>`
(`server/test/load-test.js`). Each simulated visitor browses like a guest: the home page, a card search, the map
counts, the store directory and the sign-in check.

**Setup.** The live site rate-limits each visitor to 300 API requests a minute, so the 100-visitor runs used the
production build on a laptop with `NODE_ENV=test` (limits off), connected to the Neon `test` branch in the same
region as production (AWS us-east-2, Ohio). Dataset: 664 players, 404 printings and 6,025 shared listings (12 MB).
Production itself was probed gently, under the rate limit.

| Run | Requests | Failed | Median | p95 | p99 | Card search p95 |
| --- | --- | --- | --- | --- | --- | --- |
| 100 visitors, 60 s, 1 s between pages | 5,723 (94/s) | 0 | 40 ms | 119 ms | 556 ms | 556 ms |
| 100 visitors, 30 s, no pauses (stress) | 10,698 (353/s) | 0 | 330 ms | 505 ms | 515 ms | 515 ms |
| Live site (Render Starter + Neon Free), 4 visitors, 60 s | 80 | 0 | 56 ms | 778 ms | 1,178 ms | 1,178 ms |

**Result.** 5.4.2 is met: search answers well within 3 seconds (p95 0.5 s locally, 1.2 s on the live site, where
the slowest request was the first one after Neon's sleeping database woke up). 5.4.3 is met: 100 concurrent visitors
with no failed requests. Under the no-pause stress run, requests queue for the database pool (10 connections,
`PG_POOL_MAX`), which keeps every response near half a second rather than failing.

## Security (6.4, ST-01 to ST-05)

Last run on 2026-10-03 at commit `e206e41` with `npm run test:security -- https://taptotrade.ca`
(`server/test/security-check.js`, read-only: GETs, and POSTs that must be refused).

**34 of 34 checks passed** on the live site, and 31 of 31 against the app directly on localhost (the HTTPS-only
checks don't apply there):

- ST-04 headers: Content-Security-Policy with `frame-ancestors 'none'`, no inline scripts and no wildcard style or
  font hosts, `nosniff`, no `X-Powered-By`, a Permissions-Policy that turns off camera and microphone, origin-only
  referrer, HSTS, and http:// redirects to https://.
- ST-05 session cookie: HttpOnly, Secure, SameSite=Lax, 30-minute idle expiry.
- CSRF: a POST without the token is refused (403); private API routes answer 401 without a login (4.1.8).
- ST-01 SQL injection in the search box: on the live site Cloudflare (in front of Render) blocks the request before it
  reaches the app; sent straight to the app, it is treated as plain search text and returns an empty result.
- ST-02: a script in a profile address is not echoed into the page.
- 5.2.2: bad JSON gets a friendly 400, unknown routes a JSON 404, and no stack traces appear in responses.
- `/.env`, `/.git/config`, `package.json`, server code and migrations are not downloadable; no CORS access.

The API tests (`npm run test:api`) also cover ST-01, ST-02, ST-03 and ST-05 against the app.

### OWASP ZAP baseline scan

Passive scan (it reads pages, never attacks) of the live site with the official image, which spiders the public
pages and the JavaScript app:

```
docker run --rm -v "$PWD:/zap/wrk" -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://taptotrade.ca -j -m 3 -r report.html
```

| Run | Failed | Warnings | Passed |
| --- | --- | --- | --- |
| 2026-10-03, commit `8e38229` | 0 | 9 | 58 |
| 2026-10-03, commit `e206e41` (after fixes) | 0 | 8 | 59 |

Fixed after the first run (commit `e206e41`): styles and fonts allowed any `https:` host (Helmet's default; nothing
external is used, so now only this site), no Permissions-Policy header, and no caching rules (pages are now checked
on every visit; hashed `/assets` files are cached for a year). Full report: `docs/zap-baseline-2026-10-03.html`.

The remaining warnings, and why they stay:

| Warning | Decision |
| --- | --- |
| CSP: style-src `'unsafe-inline'` | Kept. The dialog, menu and toast libraries add small `<style>` tags at runtime. Scripts stay strict (`'self'` only), which is where inline code is dangerous. |
| Cross-Origin-Embedder-Policy missing | Kept off. `require-corp` would block Scryfall's card images and the map tiles, which don't send the header it needs. |
| Re-examine Cache-control, Storable and Cacheable Content | Informational. Pages use `no-cache` on purpose, so new deploys show up straight away. |
| Timestamp Disclosure | False positive: Scryfall's image version numbers in card URLs. |
| Suspicious Comments | False positive: the words `SELECT` and `FROM` in bundled code and a comment, not SQL. |
| Modern Web Application, Session Management Response | Informational: it notes the site is a JavaScript app with a session cookie. |

## Accessibility (5.3, 6.5, AC-01 to AC-05)

Run on 2026-10-02 at commit `698c134`.

**axe-core 4.13** (WCAG 2.0/2.1 A and AA rules) found **no violations** on any page, in light and dark theme, at
desktop (1280 px) and phone (390 px) width: 10 public pages on the live site (home, search, card browser, stores, log
in, register, forgot password, privacy, terms, 404) and 13 signed-in pages on the local copy (dashboard, inventory,
want list, trades, a proposal, a new trade, settings, suggestions, moderation, admin, two profiles, a store page).

Re-run on 2026-10-05 at commit `2789b46`, after the map markers, meetup spots and card-name suggestions: still no
violations on the 10 public pages, and none in the new interactive states (suggestion list open on search and the
card browser, with a suggestion highlighted; search map open), in both themes at both widths. Google's own map
controls are left out of that scan; our markers and legend are included.

**Lighthouse 13.5** on the live site (plan target: accessibility at least 90):

| Page | Phone: performance / accessibility / best practices / SEO | Desktop |
| --- | --- | --- |
| Home | 91 / 100 / 100 / 100 | 99 / 100 / 100 / 100 |
| Search | 99 / 100 / 100 / 100 (after the heading fix) | 99 / 99 / 100 / 100 |
| Card browser | 94 / 100 / 100 / 100 | 91 / 100 / 100 / 100 |
| Stores | 99 / 100 / 100 / 100 (after the layout fix) | 99 / 100 / 100 / 100 |
| Log in | 96 / 100 / 100 / 66 | 97 / 100 / 100 / 69 |
| Terms | 92 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |

Log in's SEO score is low on purpose: sign-in pages are marked `noindex` so they stay out of search results. The two
issues Lighthouse found were fixed the same day (commit `698c134`): a skipped heading level on the search results, and
a layout shift on the store directory (0.15, now 0.078). Manual keyboard, 200% zoom and screen-reader checks are
still worth doing before the final report.

## Trade journey and link check in a real browser (4.5, 6.6)

Run on 2026-10-03 at commit `f8e8e2e` with Playwright (Chrome).

**Full trade journey** on the local copy against the Neon `test` branch, with two new players. Player A opened
the composer from a search-style link, asked for B's only Lightning Bolt and offered 2 of their 3 Black Lotus. B
accepted (both inventories unchanged), then both answered "We traded" with a rating. Result: B's Lightning Bolt
listing was deleted and B gained 2 Black Lotus as a private listing; A's Black Lotus went from 3 to 1 and A gained
the Lightning Bolt, also private. Each profile showed 1 completed trade with the rating given. `npm run test:api` covers the same rules, plus "It didn't happen" changing nothing.

**Link crawl** from the home page, following every same-site link and reporting console errors, failed requests,
pages showing the 404 and missing `#anchors`:

| Run | Pages | External links | Problems |
| --- | --- | --- | --- |
| Live site, signed out | 23 | 6 | none |
| Local copy, signed in as a player | 73 | 9 | none |

The security checks were run again on the live site after this deploy: 32 of 32 passed.

## Backup restore rehearsal (5.5.1, 6.6)

Run on 2026-10-03 with the nightly backup `taptotrade-20261003T1239Z.dump.gpg` (workflow run 37123599451),
following README "Backups and restore":

1. Downloaded the private artifact with `gh run download` (15.8 KB encrypted).
2. Decrypted it with `gpg` and `BACKUP_PASSPHRASE` (67.7 KB custom-format dump).
3. Created a throwaway Neon branch with a new, empty database and restored into it with `pg_restore` 18
   (`postgres:18` Docker image): **3.8 s, no errors**; download to restored data took under 10 seconds.
4. Compared every table with production (read-only), then deleted the branch and the decrypted file.

| Table | Restored | Production | Table | Restored | Production |
| --- | --- | --- | --- | --- | --- |
| users | 3 | 3 | trade_feedback | 1 | 1 |
| inventory_items | 2 | 2 | password_resets | 3 | 3 |
| card_printings | 80 | 80 | email_verifications | 2 | 2 |
| trade_requests | 1 | 1 | schema_migrations | 7 | 7 |
| trade_request_items | 1 | 1 | session | 0 | 2 |

The other seven tables (stores, store_events, want_items, reports, mod_actions, suggestions, email_texts) were empty
in both. **16 of 17 tables match exactly.** The one difference is `session`: sign-ins made after the backup was
taken, which are temporary and expire after 30 idle minutes. Both servers run Postgres 18.6, all 7 migrations
are present, and every restored table is owned by the restoring role, the same as production.

The first attempt stopped on `ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin`: the dump includes Neon's own admin
privileges, which a normal role can't recreate. Adding `--no-acl` to `pg_restore` skips them, so the README
command now includes it. The nightly backup has succeeded every day since 2026-10-01; failures email the owner.

## Launch-readiness audit (2026-10-10)

A page-by-page check of the things quick builds tend to skip, at commit `39fecce`. Scripts drove Chrome against the
live site (public pages) and the local copy on the Neon `test` branch (signed-in pages, as an admin test player).

| Check | Result |
| --- | --- |
| Domain | `taptotrade.onrender.com` and `www.` redirect (301) to `https://taptotrade.ca`; no preview domain is exposed. |
| Titles and descriptions | Every page has its own tab title (fixed: signed-in pages, password/email pages and trade pages all said "Tap to Trade"). Indexable pages have unique titles and descriptions. |
| Canonical, Open Graph, Twitter card, favicon | On every page; the share image is 1200 x 630. 404s send a real 404 with `noindex` and no canonical. |
| Sitemap and robots | 7 public pages plus every active partner store; all answer 200. Private pages are disallowed. |
| 404, loading, empty and error states | Every data page shows a loading indicator and, when its API fails, a clear message with **Try again**. Empty lists explain what to do next. |
| Headings and alt text | One `h1` per page, no skipped levels, no images without alt text; axe (WCAG 2.1 AA and best practices) found nothing. |
| Console and files | No console errors, no leftover `console.log`, no dev files served (see Security). |
| JavaScript size | Fixed: one 750 KB bundle split by page; the first visit downloads 187 KB gzipped instead of 233 KB. |
| Screen sizes | No sideways scrolling on any page at 280, 320, 375, 600, 768, 812 x 375 (landscape), 1024, 1366, 1440, 1920 and 2560 px (fixed: the staff header scrolled sideways at 1024 px). |
| Long text | Fixed: a 24-letter username, a 500-character message with no spaces and a 1000-character report reason pushed pages up to 6,500 px sideways; they now wrap. |
| Phones | Fixed: the trade composer's send panel covered a third of a phone screen; rows ran off the card. |
| Buttons and links | No control without an action (the scan was checked against planted fakes). 151 non-destructive buttons clicked one by one: each opened, switched or changed something, and none threw. Fixed: the send button showed when the other player had nothing to request. |
| Consistency | One icon set (lucide), one button component with a few variants, a fixed radius scale; page titles now share one size. |
