import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

// Migrations are numbered schema changes in server/migrations; each database records which files it has applied.
// This keeps local, test, and production schemas moving forward without recreating existing data.
// Every migration has an undo with the same name in server/migrations/down/, so a release can be rolled back:
//   npm run migrate                          apply every migration not applied yet
//   npm run migrate:down -- --confirm        undo the latest one (add --steps=2 to undo two)
// `npm run test:api` checks that each undo puts the database back exactly as it was before (migrate.test.js).
const DIR = path.resolve("server/migrations");
const DOWN = path.join(DIR, "down");

/** Every migration file, in order. */
export const migrationFiles = async () => (await fs.readdir(DIR)).filter((f) => f.endsWith(".sql")).sort();

// Apply the schema change and record it atomically; a failed migration can be fixed and retried cleanly.
async function inTransaction(db, fn) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await fn(c);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

async function appliedNames(db) {
  // The ledger makes reruns safe: already-recorded migration files are skipped.
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const { rows } = await db.query("SELECT name FROM schema_migrations ORDER BY name");
  return rows.map((r) => r.name);
}

/** Applies every migration that hasn't been applied yet (or only up to and including `to`). Returns their names. */
export async function migrate({ db = pool, to, log = console.log } = {}) {
  const applied = new Set(await appliedNames(db));
  const done = [];
  for (const file of await migrationFiles()) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(DIR, file), "utf8");
    await inTransaction(db, async (c) => {
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    log(`applied ${file}`);
    done.push(file);
    if (file === to) break;
  }
  return done;
}

/** Undoes the latest `steps` applied migrations with their down files, newest first. Returns their names. */
export async function rollback({ db = pool, steps = 1, log = console.log } = {}) {
  const applied = await appliedNames(db);
  const undone = [];
  for (const file of applied.slice(-steps).reverse()) {
    const sql = await fs.readFile(path.join(DOWN, file), "utf8").catch(() => {
      throw new Error(`${file} has no undo file (server/migrations/down/${file}), so it can't be rolled back.`);
    });
    await inTransaction(db, async (c) => {
      await c.query(sql);
      await c.query("DELETE FROM schema_migrations WHERE name = $1", [file]);
    });
    log(`rolled back ${file}`);
    undone.push(file);
  }
  return undone;
}

// Only run on its own when called as `node server/migrate.js`; seed.js and the tests import these instead.
if (process.argv[1]?.endsWith("migrate.js")) {
  const args = process.argv.slice(2);
  const run = async () => {
    if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first (see .env.example).");
    if (args[0] !== "down") {
      await migrate();
      return console.log("migrations up to date");
    }
    const steps = Number(args.find((a) => a.startsWith("--steps="))?.slice(8) ?? 1);
    if (!Number.isInteger(steps) || steps < 1) throw new Error("--steps must be a whole number of 1 or more.");
    // Undos drop tables and columns, and the data in them, so they never run by accident.
    if (!args.includes("--confirm")) {
      const latest = (await appliedNames(pool)).slice(-steps).reverse();
      console.log(`This would undo: ${latest.join(", ") || "nothing"}. Data in what it removes is deleted.`);
      return console.log("Run it again with --confirm to go ahead (take a database backup or Neon branch first).");
    }
    await rollback({ steps });
  };
  run()
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
