import { authUrl, checkClaims, decodeJwtPayload, googleConfigured } from "./google.js";

const CLIENT = "client-123.apps.googleusercontent.com";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const good = {
  iss: "https://accounts.google.com",
  aud: CLIENT,
  exp: NOW / 1000 + 300,
  nonce: "n-1",
  sub: "1098765",
  email: "player@gmail.com",
  email_verified: true,
};

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = CLIENT;
  process.env.GOOGLE_CLIENT_SECRET = "secret";
});
afterAll(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

describe("Google sign-in (OIDC)", () => {
  test("is off until both credentials are set", () => {
    expect(googleConfigured()).toBe(true);
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(googleConfigured()).toBe(false);
  });

  test("credentials pasted with a trailing line break still work", () => {
    process.env.GOOGLE_CLIENT_ID = `${CLIENT}\n`;
    expect(new URL(authUrl({ state: "s", nonce: "n" })).searchParams.get("client_id")).toBe(CLIENT);
    expect(checkClaims(good, { nonce: "n-1", now: NOW }).sub).toBe("1098765");
  });

  test("the sign-in URL carries state, nonce and only the openid email scope", () => {
    const url = new URL(authUrl({ state: "s-1", nonce: "n-1" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: CLIENT, response_type: "code", scope: "openid email", state: "s-1", nonce: "n-1" });
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/auth\/google\/callback$/);
  });

  test("accepts a fresh, verified token meant for us", () => {
    expect(checkClaims(good, { nonce: "n-1", now: NOW })).toEqual({ sub: "1098765", email: "player@gmail.com" });
  });

  test.each([
    ["another issuer", { iss: "https://evil.example" }],
    ["another app's token", { aud: "someone-else" }],
    ["an expired token", { exp: NOW / 1000 - 1 }],
    ["a replayed nonce", { nonce: "old" }],
    ["an unverified email", { email_verified: false }],
  ])("rejects %s", (_, change) => {
    expect(() => checkClaims({ ...good, ...change }, { nonce: "n-1", now: NOW })).toThrow();
  });

  test("decodes the payload of a compact JWT", () => {
    const jwt = ["e30", Buffer.from(JSON.stringify(good)).toString("base64url"), "sig"].join(".");
    expect(decodeJwtPayload(jwt).sub).toBe("1098765");
    expect(() => decodeJwtPayload("garbage")).toThrow();
  });
});
