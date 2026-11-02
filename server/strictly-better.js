import fs from "node:fs/promises";

// Saves Strictly Better's community list (https://www.strictlybetter.eu, MIT licensed, a free API) of cards players
// voted strictly better than others to server/data/strictly-better.json, which the deck optimizer reads to suggest
// upgrades that give nothing up:
//   npm run strictly-better
// About 600 pages, fetched slowly so the small community site isn't hammered. Run it again after a big set comes out.
const API = "https://www.strictlybetter.eu/api/obsoletes";
const front = (name) => name.split(" // ")[0].trim().toLowerCase();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const pairs = {};
let kept = 0;
for (let page = 1, last = 1; page <= last; page++) {
  const res = await fetch(`${API}?page=${page}`, { headers: { "User-Agent": "TapToTrade/1.0 (student capstone)", Accept: "application/json" } });
  if (!res.ok) throw new Error(`Strictly Better page ${page}: HTTP ${res.status}`);
  const body = await res.json();
  last = body.last_page;
  for (const s of body.data) {
    // Only pairs players agree on, with the same card types (a creature stays a creature), no extra coloured pips
    // and no legendary on one side only. More or fewer colours is fine: the optimizer checks the colour identity.
    const l = s.labels ?? {};
    if (s.upvotes <= s.downvotes || l.downvoted || l.types_differ || l.more_colored_mana || l.supertypes_differ) continue;
    for (const inferior of s.inferiors) {
      for (const superior of s.superiors) (pairs[front(inferior.name)] ??= []).push([superior.name, s.upvotes, s.downvotes]);
    }
    kept += 1;
  }
  if (page % 50 === 0) console.log(`page ${page} of ${last}`);
  await wait(400);
}
for (const list of Object.values(pairs)) list.sort((a, b) => b[1] - b[2] - (a[1] - a[2]));
await fs.mkdir("server/data", { recursive: true });
await fs.writeFile("server/data/strictly-better.json", JSON.stringify({ generated: new Date().toISOString().slice(0, 10), source: "https://www.strictlybetter.eu", pairs }) + "\n");
console.log(`Saved ${kept} upgrades for ${Object.keys(pairs).length} cards to server/data/strictly-better.json`);
