// Load test for Milestone 4 requirement 5.4.3 (100 concurrent users) and 5.4.2 (search within 3 seconds).
//   node server/test/load-test.js <site> [users=100] [seconds=60] [thinkMs=1000]
// Each simulated visitor keeps browsing like a guest would: the home page, a card search, the map counts,
// the store directory and a public profile, pausing `thinkMs` between pages. It prints how long requests took
// (median, p95, p99), how many failed, and the slowest kind of request. Uses only Node's built-in fetch.
//
// The live site rate-limits each visitor to 300 API requests a minute, so a full run from one computer has to target
// a copy started with NODE_ENV=test (limits off), e.g. the production build on localhost against the test database.

const [site = "http://localhost:3000", users = "100", seconds = "60", thinkMs = "1000"] = process.argv.slice(2);
const SEARCHES = ["bolt", "ring", "lotus", "counter", "dragon", "angel", "goblin", "elf", "test card", "sword"];
const CITIES = ["Hamilton, ON", "Toronto, ON", "Burlington, ON", "Guelph, ON", ""];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// What one visit does, in order. Each entry is [name, path].
const visit = () => {
  const city = pick(CITIES);
  const query = `name=${encodeURIComponent(pick(SEARCHES))}${city ? `&city=${encodeURIComponent(city)}&radius=100` : ""}`;
  return [
    ["home page", "/"],
    ["card search", `/api/search?${query}`],
    ["map counts", `/api/search/cities?${query}`],
    ["store directory", "/api/stores"],
    ["sign-in check", "/api/auth/me"],
  ];
};

const results = []; // { name, ms, ok }
const end = Date.now() + Number(seconds) * 1000;

async function visitor() {
  while (Date.now() < end) {
    for (const [name, path] of visit()) {
      if (Date.now() >= end) return;
      const start = performance.now();
      let ok = false;
      try {
        const res = await fetch(site + path, { signal: AbortSignal.timeout(10_000) });
        await res.arrayBuffer();
        ok = res.ok;
      } catch {
        ok = false; // timeout or connection refused
      }
      results.push({ name, ms: performance.now() - start, ok });
      await new Promise((r) => setTimeout(r, Number(thinkMs)));
    }
  }
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const summary = (rows) => {
  const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
  return { requests: rows.length, failed: rows.filter((r) => !r.ok).length, median: percentile(ms, 50), p95: percentile(ms, 95), p99: percentile(ms, 99), max: ms.at(-1) ?? 0 };
};
const fmt = (s) => `${String(s.requests).padStart(6)} requests  ${String(s.failed).padStart(4)} failed  median ${s.median.toFixed(0).padStart(5)} ms  p95 ${s.p95.toFixed(0).padStart(5)} ms  p99 ${s.p99.toFixed(0).padStart(5)} ms  max ${s.max.toFixed(0).padStart(5)} ms`;

console.log(`${users} visitors for ${seconds}s against ${site}, ${thinkMs} ms between pages`);
const began = Date.now();
await Promise.all(Array.from({ length: Number(users) }, visitor));
const elapsed = (Date.now() - began) / 1000;

console.log(`\nall      ${fmt(summary(results))}  (${(results.length / elapsed).toFixed(1)} requests/s)`);
for (const name of [...new Set(results.map((r) => r.name))]) console.log(`${name.padEnd(16)} ${fmt(summary(results.filter((r) => r.name === name)))}`);
const search = summary(results.filter((r) => r.name === "card search"));
const failRate = (summary(results).failed / Math.max(1, results.length)) * 100;
console.log(`\n5.4.2 card search p95 under 3 s: ${search.p95 < 3000 ? "yes" : "NO"} (${search.p95.toFixed(0)} ms)`);
console.log(`5.4.3 ${users} concurrent visitors with under 1% errors: ${failRate < 1 ? "yes" : "NO"} (${failRate.toFixed(2)}% failed)`);
