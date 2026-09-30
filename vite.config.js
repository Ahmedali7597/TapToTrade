import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The React app lives in client/. Express serves client/dist in production (same origin as /api).
export default defineConfig({
  root: "client",
  plugins: [react(), tailwindcss()],
  // "@/..." points at client/src and "@shared/..." at the validation rules the server also uses.
  resolve: {
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
  },
  // In dev, Vite runs on :5173 and forwards API calls to Express so cookies stay same-origin.
  server: { proxy: { "/api": "http://localhost:3000" } },
  // Output lands in client/dist, which server/app.js serves as static files.
  build: { outDir: "dist", emptyOutDir: true },
});
