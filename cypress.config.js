// Front-end functional tests FE-01…FE-08 (Milestone 4 section 6.3). Run with: npm run test:e2e
// Needs the app running on :3000 with seed data (npm run seed && npm run build && npm start).
// Plain object (no `defineConfig` import) because Cypress runs through npx, not as a project dependency.
export default {
  e2e: {
    baseUrl: "http://localhost:3000",
    supportFile: false,
    video: false,
  },
};
