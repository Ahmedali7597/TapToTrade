import { hashPassword, newToken, safeEqual, sha256, verifyDummy, verifyPassword } from "./security.js";

describe("password hashing (5.1.1)", () => {
  test("UT-08 the hash verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("Secure@1");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain("Secure@1");
    await expect(verifyPassword(hash, "Secure@1")).resolves.toBe(true);
    await expect(verifyPassword(hash, "Secure@2")).resolves.toBe(false);
  });

  test("the same password hashes differently each time (salted)", async () => {
    expect(await hashPassword("Secure@1")).not.toBe(await hashPassword("Secure@1"));
  });

  test("malformed hashes (e.g. deleted accounts) never verify", async () => {
    await expect(verifyPassword("!", "anything")).resolves.toBe(false);
    await expect(verifyDummy("anything")).resolves.toBe(false);
  });
});

describe("tokens", () => {
  test("reset tokens are long, random and stored only as a hash", () => {
    const a = newToken();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newToken()).not.toBe(a);
    expect(sha256(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256(a)).not.toContain(a);
  });

  test("safeEqual compares in constant time and handles missing values", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual(undefined, "abc")).toBe(false);
  });
});
