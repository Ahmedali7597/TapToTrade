import fs from "node:fs/promises";
import { searchCards } from "./lib/scryfall.js";
import { JOBS } from "../shared/optimizer.js";

// Saves Scryfall Tagger's function tags (removal, mana rock, wheel...) for the most played Commander cards to
// server/data/function-tags.json, which the deck optimizer reads to tell what each card does:
//   npm run tags
// Searching the tags live would add about 20 Scryfall requests to every new commander, so they're saved here
// instead. Run it again after a big set comes out; cards it doesn't cover fall back to reading their rules text.
const PAGES = 4; // the 700 most played cards with each tag, by EDHREC rank

const jobs = {};
for (const job of Object.keys(JOBS)) {
  const cards = await searchCards(`otag:${job} f:commander order:edhrec`, { pages: PAGES });
  // Front-face names, lower case, the way the optimizer matches cards (shared with cedh.front).
  jobs[job] = [...new Set(cards.map((c) => c.name.split(" // ")[0].trim().toLowerCase()))].sort();
  console.log(`${job}: ${jobs[job].length}`);
}
await fs.mkdir("server/data", { recursive: true });
await fs.writeFile("server/data/function-tags.json", JSON.stringify({ generated: new Date().toISOString().slice(0, 10), source: "https://tagger.scryfall.com", jobs }, null, 0) + "\n");
console.log("Saved server/data/function-tags.json");
