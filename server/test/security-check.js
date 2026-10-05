// Read-only security checks against a running site, for Milestone 4 section 6.4 (ST-01 to ST-05) alongside the
// OWASP ZAP scan:  node server/test/security-check.js https://taptotrade.ca
// Every request is a GET, or a POST that must be refused (no CSRF token), so it's safe to run against production.
// Prints one line per check and exits with code 1 if any check fails.

const site = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const results = [];
const check = (id, name, ok, detail = "") => results.push({ id, name, ok: Boolean(ok), detail });
const get = (path, init) => fetch(site + path, { redirect: "manual", ...init });

// ST-04: security headers on a normal page.
const home = await get("/");
const csp = home.headers.get("content-security-policy") ?? "";
check("ST-04", "Content-Security-Policy is set", csp.includes("default-src 'self'"), csp.slice(0, 60));
check("ST-04", "Anti-framing: frame-ancestors 'none'", csp.includes("frame-ancestors 'none'"));
check("ST-04", "Scripts only from this site (no 'unsafe-inline')", /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));
check("ST-04", "No JavaScript eval ('unsafe-eval'; WebAssembly-only is allowed for the map)", !/script-src[^;]*'unsafe-eval'/.test(csp));
check("ST-04", "X-Content-Type-Options: nosniff", home.headers.get("x-content-type-options") === "nosniff");
check("ST-04", "No X-Powered-By header (hides the framework)", !home.headers.get("x-powered-by"));
check("ST-04", "Styles and fonts only from this site (no https: wildcard)", !/(style|font)-src[^;]*https:(?!\/\/)/.test(csp));
const permissions = home.headers.get("permissions-policy") ?? "";
check("ST-04", "Permissions-Policy turns off camera and microphone", permissions.includes("camera=()") && permissions.includes("microphone=()"));
check("ST-04", "Referrer-Policy sends only the origin", home.headers.get("referrer-policy") === "strict-origin-when-cross-origin");
if (site.startsWith("https://")) {
  check("ST-04", "HTTPS is enforced (Strict-Transport-Security)", (home.headers.get("strict-transport-security") ?? "").includes("max-age="));
  const plain = await fetch(site.replace("https://", "http://") + "/", { redirect: "manual" });
  check("ST-04", "Plain http:// redirects to https://", plain.status >= 300 && plain.status < 400 && (plain.headers.get("location") ?? "").startsWith("https://"), `${plain.status}`);
}

// ST-05: the session cookie's flags. The first API call hands out a session (it carries the CSRF token).
const me = await get("/api/auth/me");
const cookie = me.headers.get("set-cookie") ?? "";
const { csrfToken } = await me.json();
check("ST-05", "Session cookie is HttpOnly", /HttpOnly/i.test(cookie), cookie.split(";")[0].replace(/=.*/, "=…"));
check("ST-05", "Session cookie is SameSite=Lax", /SameSite=Lax/i.test(cookie));
if (site.startsWith("https://")) check("ST-05", "Session cookie is Secure", /;\s*Secure/i.test(cookie));
check("ST-05", "Session cookie expires after 30 idle minutes", (() => {
  const expires = /Expires=([^;]+)/i.exec(cookie);
  const minutes = expires ? (new Date(expires[1]) - Date.now()) / 60_000 : 0;
  return minutes > 28 && minutes <= 30.5;
})());

// CSRF: a write without the token is refused, even with the session cookie.
const session = cookie.split(";")[0];
const noToken = await get("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Cookie: session }, body: "{}" });
check("5.1", "POST without the CSRF token is refused (403)", noToken.status === 403, `${noToken.status}`);
check("5.1", "A CSRF token is issued to the browser", typeof csrfToken === "string" && csrfToken.length >= 32);

// 4.1.8: private API routes need a login.
for (const path of ["/api/inventory", "/api/trades", "/api/wants", "/api/admin/users", "/api/moderation/reports"]) {
  const res = await get(path);
  check("4.1.8", `${path} needs a login (401)`, res.status === 401, `${res.status}`);
}

// ST-01: SQL injection in the search box is treated as plain text.
const sqli = await get(`/api/search?name=${encodeURIComponent("'; DROP TABLE users;--")}&sort=${encodeURIComponent("name; DROP TABLE users")}`);
const sqliBody = await sqli.text();
// On Render, Cloudflare's firewall may refuse an obvious attack before it reaches the app (an extra layer). Either
// way is a pass; run against localhost to see the app itself treat the text as a plain search.
const blockedAtEdge = sqli.status === 403 && /cloudflare/i.test(sqli.headers.get("server") ?? "");
check("ST-01", "SQL injection in search is blocked or returns a normal result", blockedAtEdge || (sqli.status === 200 && sqliBody.startsWith("{")), blockedAtEdge ? "blocked by Cloudflare before reaching the app" : `${sqli.status}`);
check("ST-01", "No database error text in the response", !/syntax error|postgres|pg_|SQLSTATE/i.test(sqliBody));
check("ST-01", "Search still works afterwards", (await get("/api/search?name=a")).status === 200);

// ST-02: a script in the address is escaped in the server-rendered page (React escapes everything else).
const xss = await get(`/u/${encodeURIComponent("<script>alert(1)</script>")}`);
check("ST-02", "Script in a profile address isn't echoed into the page", !(await xss.text()).includes("<script>alert(1)</script>"), `${xss.status}`);

// 5.2.2: errors stay friendly and never show internals.
const badJson = await get("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Cookie: session, "X-CSRF-Token": csrfToken }, body: "{not json" });
const badText = await badJson.text();
check("5.2.2", "Bad JSON gets a friendly 400", badJson.status === 400 && badText.includes("not valid JSON"), `${badJson.status}`);
check("5.2.2", "No stack traces in error responses", !/at \w+ \(|node_modules|\.js:\d+/.test(badText));
const missing = await get("/api/no-such-thing");
check("5.2.2", "Unknown API route gives a JSON 404", missing.status === 404 && (await missing.text()).includes('"error"'));

// Files that must never be downloadable.
for (const path of ["/.env", "/.git/config", "/package.json", "/server/db.js", "/server/migrations/001_init.sql"]) {
  const res = await get(path);
  const text = await res.text();
  check("5.1", `${path} is not served`, !/DATABASE_URL|\[core\]|"dependencies"|pg\.Pool|CREATE TABLE/.test(text), `${res.status}`);
}

// No cross-site API access.
const cors = await get("/api/auth/me", { headers: { Origin: "https://evil.example" } });
check("5.1", "No CORS access for other sites", !cors.headers.get("access-control-allow-origin"));

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "pass" : "FAIL"}  ${r.id.padEnd(6)} ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed against ${site}`);
process.exitCode = failed.length ? 1 : 0;
