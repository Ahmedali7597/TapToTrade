# Search and recommendation checklist

The code side (titles, descriptions, sitemap, structured data, city pages) is in `server/lib/seo.js`,
`shared/pages.js` and `server/routes/cities.js`. Rankings mostly depend on the steps below, which happen
outside the code. Roughly in order of payoff.

## Once

- [ ] **Google Search Console**: verify `taptotrade.ca` (DNS `TXT` record at Squarespace), submit
      `https://taptotrade.ca/sitemap.xml`, then use URL Inspection → "Request indexing" on `/`, `/stores` and
      each city page in the sitemap.
- [ ] **Bing Webmaster Tools**: import the site from Search Console (one click). Bing powers Copilot and DuckDuckGo results
      and is one of the sources behind ChatGPT search.
- [ ] **Google Business Profile**: only if there's a real public address to list. Tap to Trade is online-only, so
      skip it rather than inventing one; the partner stores' own profiles do that job.

## Links and mentions (what moves rankings most)

- [ ] Ask each partner store to link to its Tap to Trade page (`/stores/<id>-<name>`) from its website and to
      mention it on its socials and in-store signage. A link from a local store is worth more than most others.
- [ ] Post in local MTG communities where self-promotion is allowed: city and Canadian MTG subreddits, local
      Discord servers, Facebook groups for your city's Magic players. Link the city page
      (`/trade/<city>`), not just the home page.
- [ ] A short write-up for your college (the capstone) or a student news site, with a link.

## Ongoing

- [ ] Check Search Console → Performance monthly: which searches show the site, and which city pages get
      impressions. Cities with impressions but few clicks need a better description or more activity.
- [ ] Recruit players and stores in one city at a time. A city page becomes indexable once it has a partner store
      or a few active players, and a page with real listings and events is what ranks for "trade MTG cards in <city>".
- [ ] Keep store events up to date: they show on store and city pages and in Google as `Event` data.

## AI assistants (ChatGPT, Claude, Gemini, Perplexity)

- Their search features already crawl the site: `robots.txt` allows every crawler except the ones that only
  collect AI training data. Being in Bing and Google's index (above) is what gets the site cited.
- Mentions on other sites (Reddit, store sites, local news) are what make assistants recommend it by name.
- `robots.txt` blocks training crawlers (GPTBot, ClaudeBot, Google-Extended and others) on purpose, so players'
  listings aren't used as training data. Allowing them on public marketing pages only could help future models
  know the site; that's a policy choice, not a fix.
