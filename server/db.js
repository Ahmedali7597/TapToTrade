import pg from "pg";

// Postgres "bigint" columns (every id, and count(*)) arrive as text by default, because they can be bigger than
// JavaScript numbers. Ours never get anywhere near that (2^53), so read them as plain numbers: 5 === 5, not "5".
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

// Every route shares this PostgreSQL pool. DATABASE_URL selects the local Docker database or hosted Neon database.
// Neon connection strings use ?sslmode=verify-full so the server checks the TLS certificate.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

// Shortcut for one-off queries that don't need a transaction.
export const query = (text, params) => pool.query(text, params);

/** Runs fn(client) inside BEGIN/COMMIT, rolling back on any error. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // If the connection itself died, ROLLBACK can fail too. The original error matters more.
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The VALUES part of a multi-row INSERT, with its parameters:
 * valuesList([[1, "a"], [2, "b"]]) -> { sql: "($1, $2), ($3, $4)", params: [1, "a", 2, "b"] }.
 * Every row needs the same number of values, in the same order as the INSERT's column list.
 */
export function valuesList(rows) {
  const width = rows[0]?.length ?? 0;
  const sql = rows.map((_, r) => `(${Array.from({ length: width }, (_, c) => `$${r * width + c + 1}`).join(", ")})`).join(", ");
  return { sql, params: rows.flat() };
}
