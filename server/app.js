import fs from "node:fs";
import path from "node:path";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import { pool } from "./db.js";
import { errorHandler, HttpError } from "./lib/http.js";
import { llmsTxt, pageMeta, renderPage, robotsTxt, siteUrl, sitemapXml } from "./lib/seo.js";
import { storePath } from "../shared/stores.js";
import { apiLimiter, csrf, IDLE_MINUTES, loadUser } from "./middleware.js";
import authRoutes from "./routes/auth.js";
import accountRoutes from "./routes/account.js";
import inventoryRoutes from "./routes/inventory.js";
import cardRoutes from "./routes/cards.js";
import searchRoutes from "./routes/search.js";
import tradeRoutes from "./routes/trades.js";
import moderationRoutes from "./routes/moderation.js";
import storeRoutes from "./routes/stores.js";
import suggestionRoutes from "./routes/suggestions.js";
import emailRoutes from "./routes/emails.js";
import wantRoutes from "./routes/wants.js";
import { upcomingEvents } from "./lib/events.js";
import eventRoutes from "./routes/events.js";

/** Builds the Express app: JSON API under /api plus the built React app, on one origin (plan 8.1). */
export function createApp() {
  if (!process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is not set (see .env.example).");
  const production = process.env.NODE_ENV === "production";
  const app = express();
  app.set("trust proxy", 1); // Render terminates TLS in front of the app; needed for Secure cookies

  // Helmet sets the usual security headers. We only loosen the CSP enough to show Scryfall card images and
  // symbols, and the map: OpenStreetMap tiles, or Google Maps when GOOGLE_MAPS_API_KEY is set (Google's
  // documented hosts, without its optional 'unsafe-inline' for scripts, which the map doesn't need).
  const google = process.env.GOOGLE_MAPS_API_KEY
    ? { script: ["https://*.googleapis.com", "https://*.gstatic.com", "blob:"], img: ["https://*.googleapis.com", "https://*.gstatic.com", "https://*.google.com", "https://*.googleusercontent.com"], connect: ["https://*.googleapis.com", "https://*.google.com", "https://*.gstatic.com", "data:", "blob:"], style: ["https://fonts.googleapis.com"], font: ["https://fonts.gstatic.com"] }
    : { script: [], img: [], connect: [], style: [], font: [] };
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // svgs.scryfall.io serves the mana and tap symbols in card text.
          "img-src": ["'self'", "data:", "https://cards.scryfall.io", "https://svgs.scryfall.io", "https://tile.openstreetmap.org", ...google.img],
          "script-src": ["'self'", ...google.script],
          "connect-src": ["'self'", ...google.connect],
          // Our fonts and styles are bundled, so no other sites (Helmet's default allows any https: host).
          // 'unsafe-inline' stays for styles only: the UI libraries add small <style> tags at runtime.
          "style-src": ["'self'", "'unsafe-inline'", ...google.style],
          "font-src": ["'self'", "data:", ...google.font],
          ...(process.env.GOOGLE_MAPS_API_KEY && { "worker-src": ["blob:"] }),
          "frame-ancestors": ["'none'"], // ST-04 anti-framing
        },
      },
      // Send only our origin (never paths or query strings) to other sites. OpenStreetMap's tile policy
      // requires a Referer, and blocks map tiles without one.
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    }),
  );
  // Turn off browser features the site never uses; location stays available to this site for "near me" search.
  app.use((req, res, next) => {
    res.set("Permissions-Policy", "camera=(), microphone=(), payment=(), usb=(), geolocation=(self)");
    next();
  });
  // Render pings this to check the process is up. It sits before sessions so it never touches the DB.
  app.get("/healthz", (req, res) => res.json({ ok: true }));

  // One address for search engines: once APP_BASE_URL is the real domain, visits to the .onrender.com address
  // are sent there permanently (301), keeping the path and query.
  const canonicalHost = new URL(siteUrl()).host;
  app.use((req, res, next) => {
    if (production && req.hostname.endsWith(".onrender.com") && !canonicalHost.endsWith(".onrender.com")) {
      return res.redirect(301, `${siteUrl()}${req.originalUrl}`);
    }
    next();
  });

  // Crawler files, built from the page list in lib/seo.js.
  app.get("/robots.txt", (req, res) => res.type("text/plain").send(robotsTxt()));
  app.get("/sitemap.xml", async (req, res, next) => {
    try {
      const { rows } = await pool.query("SELECT id, name FROM stores WHERE active ORDER BY id");
      res.type("application/xml").send(sitemapXml(rows.map(storePath)));
    } catch (err) {
      next(err);
    }
  });
  app.get("/llms.txt", (req, res) => res.type("text/plain").send(llmsTxt()));

  // Everything under /api goes through the same chain: JSON body -> session -> rate limit -> user -> CSRF.
  // Order matters: loadUser needs the session, and csrf needs both.
  const PgStore = connectPgSimple(session);
  // Collection files can be large; this path gets a bigger body limit, and the general parser below skips it.
  app.use("/api/inventory/import", express.json({ limit: "3mb" }));
  app.use(
    "/api",
    express.json({ limit: "100kb" }),
    session({
      store: new PgStore({ pool, tableName: "session", ttl: IDLE_MINUTES * 60 }),
      name: "ttt.sid",
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      rolling: true, // idle timeout: every request pushes expiry out by IDLE_MINUTES (5.1.4)
      cookie: { httpOnly: true, secure: production, sameSite: "lax", maxAge: IDLE_MINUTES * 60 * 1000 },
    }),
    apiLimiter,
    loadUser,
    csrf,
  );

  // One router per feature area. Anything under /api that no router handled becomes a JSON 404.
  app.use("/api/auth", authRoutes);
  app.use("/api/account", accountRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/wants", wantRoutes);
  app.use("/api/cards", cardRoutes);
  app.use("/api/trades", tradeRoutes);
  app.use("/api/stores/:storeId", eventRoutes);
  app.use("/api/stores", storeRoutes);
  app.use("/api/admin/emails", emailRoutes);
  app.use("/api", searchRoutes);
  app.use("/api", moderationRoutes);
  app.use("/api", suggestionRoutes);
  app.use("/api", () => {
    throw new HttpError(404, "Not found.");
  });

  // Built React app (npm run build). Every page is index.html with that page's title, description, canonical
  // link and robots rule written in (lib/seo.js); unknown paths get the same app with a real 404 status.
  const dist = path.resolve("client/dist");
  let template;
  // Brand images and the share picture are shown by email apps and other sites, so they may be loaded
  // cross-origin (Helmet's default only allows this site). Everything else keeps the same-origin rule.
  app.use(["/brand", "/og-image.jpg"], (req, res, next) => {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  });
  // Built files in /assets have a content hash in their name, so browsers can keep them for a year; a new
  // deploy gets new names. Everything else (icons, robots.txt) is checked again on each visit.
  app.use(express.static(dist, { index: false, setHeaders: (res, file) => file.includes(`${path.sep}assets${path.sep}`) && res.set("Cache-Control", "public, max-age=31536000, immutable") }));
  app.get("/{*path}", async (req, res, next) => {
    try {
      template ??= fs.readFileSync(path.join(dist, "index.html"), "utf8");
      const find = {
        profile: async (username) =>
          (await pool.query("SELECT 1 FROM users WHERE lower(username) = lower($1) AND status = 'active'", [username])).rowCount > 0,
        store: async (id) => (await pool.query("SELECT * FROM stores WHERE id = $1 AND active", [id])).rows[0] ?? null,
        events: (storeId) => upcomingEvents(storeId, 20),
      };
      const meta = await pageMeta(req.path, req.query, find);
      // no-cache: the page is checked on every visit, so a new deploy shows up straight away.
      res.status(meta.status).type("html").set("Cache-Control", "no-cache").send(renderPage(template, meta));
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);
  return app;
}
