import argon2 from "argon2";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Argon2id at OWASP's minimum profile (19 MiB, t=2, p=1): keeps 100 concurrent logins inside a small instance.
const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password) => argon2.hash(password, ARGON);

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false; // malformed/placeholder hash (e.g. deleted account) never verifies
  }
}

let dummyHash;
/** Spends the same work as a real check so login timing doesn't reveal whether an email exists. */
export async function verifyDummy(password) {
  dummyHash ??= await hashPassword("Dummy-password-1!");
  await verifyPassword(dummyHash, String(password ?? ""));
  return false;
}

// 32 random bytes, URL-safe. Used for reset links and CSRF tokens.
export const newToken = () => randomBytes(32).toString("base64url");
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Constant-time string compare, so an attacker can't guess a token one character at a time by timing us.
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ""));
  const y = Buffer.from(String(b ?? ""));
  return x.length === y.length && timingSafeEqual(x, y);
}
