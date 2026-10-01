import pg from "pg";

// One small pool per process (deployment plan 8.3). DATABASE_URL uses ?sslmode=verify-full for Neon (encrypted and certificate-checked).
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
