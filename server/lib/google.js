// "Continue with Google": OpenID Connect authorization-code flow, server side, no extra libraries.
// The browser is sent to Google with a random state and nonce kept in our session; Google sends it back
// with a one-time code, and we swap that code for an ID token directly with Google over TLS.
// Because the token comes straight from Google's token endpoint (not through the browser), OIDC Core
// 3.1.3.7 lets us skip the signature check, but we still validate issuer, audience, expiry and nonce.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Credentials from the environment, trimmed: a stray space or line break pasted into a hosting
// dashboard makes Google answer "OAuth client not found".
const clientId = () => (process.env.GOOGLE_CLIENT_ID ?? "").trim();
const clientSecret = () => (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();

/** On only when both credentials are set (Render settings). The button is hidden otherwise. */
export const googleConfigured = () => Boolean(clientId() && clientSecret());

/** Where Google sends people back to. Must match the redirect URI registered in Google Cloud exactly. */
const redirectUri = () => `${process.env.APP_BASE_URL ?? "http://localhost:5173"}/api/auth/google/callback`;

/** The Google sign-in page URL for this attempt. */
export function authUrl({ state, nonce }) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    prompt: "select_account",
  });
  return `${AUTH_URL}?${params}`;
}

/** Decodes a JWT's payload. Only used on tokens received directly from Google's token endpoint. */
export function decodeJwtPayload(jwt) {
  const part = String(jwt ?? "").split(".")[1];
  if (!part) throw new Error("Malformed ID token");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

/** Checks the ID token's claims and returns { sub, email } for a verified Google account. */
export function checkClaims(claims, { nonce, now = Date.now() }) {
  if (!ISSUERS.includes(claims.iss)) throw new Error("Wrong issuer");
  if (claims.aud !== clientId()) throw new Error("Wrong audience");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) throw new Error("Expired ID token");
  if (!nonce || claims.nonce !== nonce) throw new Error("Nonce mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("Missing subject");
  // Only a Google-verified email may be linked to an existing account or used for a new one.
  if (claims.email_verified !== true || typeof claims.email !== "string") throw new Error("Email not verified");
  return { sub: claims.sub, email: claims.email };
}

/** Swaps the one-time code for an ID token and returns the verified { sub, email }. */
export async function exchangeCode(code, nonce) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Google token endpoint responded ${res.status}`);
  const { id_token: idToken } = await res.json();
  return checkClaims(decodeJwtPayload(idToken), { nonce });
}
