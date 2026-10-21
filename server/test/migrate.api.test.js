import fs from "node:fs";
import pg from "pg";
import { migrate, migrationFiles, rollback } from "../migrate.js";

// Every migration must be reversible: applying it and then its undo (server/migrations/down/) has to leave the
// database exactly as it was. This runs in its own schema of the test database, so the app tests aren't touched.
// "public" stays on the search path only so the pg_trgm text-search functions (installed there) can be found.
const SCHEMA = "migration_check";
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
// Set on each new connection (Neon's pooler doesn't accept it as a startup option).
db.on("connect", (client) => client.query(`SET search_path TO ${SCHEMA}, public`));
const quiet = () => {};

/** The schema's shape: every column, index and constraint (not the bookkeeping table itself). */
async function shape() {
  const { rows: columns } = await db.query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = $1 AND table_name <> 'schema_migrations' ORDER BY table_name, column_name`,
    [SCHEMA],
  );
  const { rows: indexes } = await db.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename <> 'schema_migrations' ORDER BY indexname",
    [SCHEMA],
  );
  const { rows: constraints } = await db.query(
    `SELECT c.conrelid::regclass::text AS on_table, c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = $1 AND c.conrelid::regclass::text <> 'schema_migrations' ORDER BY 1, 2`,
    [SCHEMA],
  );
  return { columns, indexes, constraints };
}

beforeAll(async () => {
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
});
afterAll(async () => {
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

test("every migration has an undo file", async () => {
  for (const file of await migrationFiles()) expect(fs.existsSync(`server/migrations/down/${file}`)).toBe(true);
});

test("each migration's undo puts the schema back exactly as it was, and the migration applies again", async () => {
  for (const file of await migrationFiles()) {
    const before = await shape();
    expect(await migrate({ db, to: file, log: quiet })).toEqual([file]);
    const after = await shape();
    expect(after).not.toEqual(before); // the migration did change something

    expect(await rollback({ db, steps: 1, log: quiet })).toEqual([file]);
    expect(await shape()).toEqual(before);

    await migrate({ db, to: file, log: quiet }); // forward again, so the next migration builds on this one
    expect(await shape()).toEqual(after);
  }
  // Undoing everything at once leaves an empty schema; doing it all again matches a fresh install.
  const full = await shape();
  const files = await migrationFiles();
  expect(await rollback({ db, steps: files.length, log: quiet })).toEqual([...files].reverse());
  expect(await shape()).toEqual({ columns: [], indexes: [], constraints: [] });
  await migrate({ db, log: quiet });
  expect(await shape()).toEqual(full);
}, 120_000); // dozens of schema changes, each a round trip to the database
