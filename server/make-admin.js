import { normalizeEmail } from "../shared/validation.js";
import { pool } from "./db.js";

// Bootstraps the first administrator: npm run make-admin -- someone@example.com
const email = normalizeEmail(process.argv[2]);
if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}
// Only promotes accounts that are still active, so a suspended user can't be made admin by mistake.
const { rowCount } = await pool.query("UPDATE users SET role = 'admin' WHERE email = $1 AND status = 'active'", [email]);
console.log(rowCount ? `${email} is now an administrator.` : `No active account found for ${email}.`);
await pool.end();
