import fs from "node:fs/promises";
import path from "node:path";
import { pool, tx } from "./db.js";

// Migrations are numbered schema changes in server/migrations; each database records which files it has applied.
// This keeps local, test, and production schemas moving forward without recreating existing data.
export async function migrate() {
  // The ledger makes reruns safe: already-recorded migration files are skipped.
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const dir = path.resolve("server/migrations");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await pool.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.name));
  for (const file of files.filter((f) => !applied.has(f))) {
    const sql = await fs.readFile(path.join(dir, file), "utf8");
    // Apply the schema change and record it atomically; a failed migration can be fixed and retried cleanly.
    await tx(async (c) => {
      await c.query(sql);
      await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    console.log(`applied ${file}`);
  }
}

// Only run on its own when called as `node server/migrate.js`; seed.js and the tests import migrate() instead.
if (process.argv[1]?.endsWith("migrate.js")) {
  migrate()
    .then(() => console.log("migrations up to date"))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
