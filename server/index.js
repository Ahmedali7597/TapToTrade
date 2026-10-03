import { createApp } from "./app.js";
import { showcasePool } from "./lib/scryfall.js";

// Render supplies PORT and requires binding 0.0.0.0 (plan 8.2).
const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, "0.0.0.0", () => console.log(`Tap to Trade listening on http://localhost:${port}`));

// Fetch today's random showcase cards now, so the first visitor's home page doesn't wait for Scryfall.
showcasePool().catch((err) => console.warn(`Showcase warm-up failed (will retry on the next visit): ${err.message}`));
