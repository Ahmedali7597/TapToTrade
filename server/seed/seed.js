import fs from "node:fs/promises";
import path from "node:path";
import { passwordMessage } from "../../shared/validation.js";
import { pool, tx } from "../db.js";
import { migrate } from "../migrate.js";
import { hashPassword } from "../lib/security.js";

// Fictional local-development data (npm run seed). Safe to re-run: existing rows are left alone.
// Printings are the 100 cards from the hero film plus a few classics, fetched from Scryfall once.
const PLAYERS = [
  { username: "ttt_admin", city: "Hamilton, ON", role: "admin" },
  { username: "ttt_moderator", city: "Hamilton, ON", role: "moderator" },
  { username: "hamilton_brewer", city: "Hamilton, ON" },
  { username: "bolt_burlington", city: "Burlington, ON" },
  { username: "toronto_tapper", city: "Toronto, ON" },
  { username: "niagara_decks", city: "Niagara Falls, ON" },
  { username: "guelph_grinder", city: "Guelph, ON" },
  { username: "oakville_bulk", city: "Oakville, ON" },
];
// Weighted toward NM on purpose, since that's what most real collections look like.
const CONDITIONS = ["NM", "NM", "LP", "MP", "NM", "HP"];

// All seed accounts share one password, and it has to pass the same policy as real sign-ups.
// printings.json has no finish data, so make a reasonable guess: foils started with Urza's Legacy (1999),
// so these older sets are non-foil only, and everything else gets non-foil and foil. Searching for a card
// in the app later overwrites this with Scryfall's real list.
const PRE_FOIL_SETS = new Set(["lea", "ice", "chr", "tmp", "wth", "por", "p02", "ptk", "6ed"]);
const finishesFor = (p) => (PRE_FOIL_SETS.has(p.set_code) ? ["nonfoil"] : ["nonfoil", "foil"]);

const password = process.env.SEED_PASSWORD;
if (!password || passwordMessage(password)) {
  console.error("Set SEED_PASSWORD in .env to a password that meets the policy (see .env.example).");
  process.exit(1);
}

// Make sure the tables exist first, then hash the password once and reuse it for every player.
await migrate();
const printings = JSON.parse(await fs.readFile(path.resolve("server/seed/printings.json"), "utf8"));
const hash = await hashPassword(password);

// Everything goes in one transaction so a failed seed doesn't leave half the data behind.
await tx(async (c) => {
  for (const p of printings) {
    await c.query(
      `INSERT INTO card_printings (id, name, set_code, set_name, collector_number, image_url, finishes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.name, p.set_code, p.set_name, p.collector_number, p.image_url, finishesFor(p)],
    );
  }

  // Upsert each player and remember their id for the classic listings below. The no-op DO UPDATE is there
  // so RETURNING also gives back the id of a player who already exists.
  const ids = {};
  for (const [n, player] of PLAYERS.entries()) {
    const { rows } = await c.query(
      `INSERT INTO users (email, username, password_hash, city, role) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [`${player.username}@example.test`, player.username, hash, player.city, player.role ?? "user"],
    );
    ids[player.username] = rows[0].id;
    // Deterministic spread: each player gets every 5th printing starting at a different offset.
    // Roughly one listing in four is a foil, where the printing has one.
    for (let i = n % 5; i < printings.length; i += 5 + (n % 3)) {
      const finish = (i + n) % 4 === 0 && finishesFor(printings[i]).includes("foil") ? "foil" : "nonfoil";
      await c.query(
        `INSERT INTO inventory_items (owner_id, printing_id, quantity, condition, finish, available)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [rows[0].id, printings[i].id, 1 + ((i * 7 + n) % 6), CONDITIONS[(i + n) % CONDITIONS.length], finish, i % 11 !== 0],
      );
    }
  }

  // Make sure the classics used by the Cypress/Postman checks are listed by someone nearby.
  const classic = (name) => printings.find((p) => p.name === name).id;
  for (const [username, name, qty] of [
    ["bolt_burlington", "Lightning Bolt", 4],
    ["hamilton_brewer", "Black Lotus", 1],
    ["toronto_tapper", "Sol Ring", 3],
    ["niagara_decks", "Counterspell", 2],
  ]) {
    await c.query(
      `INSERT INTO inventory_items (owner_id, printing_id, quantity, condition) VALUES ($1, $2, $3, 'LP')
       ON CONFLICT DO NOTHING`,
      [ids[username], classic(name), qty],
    );
  }
});

console.log(`Seeded ${printings.length} printings and ${PLAYERS.length} players (<username>@example.test, password from SEED_PASSWORD).`);
await pool.end();
