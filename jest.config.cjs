// Three Jest projects: `server` and `client` unit tests (npm test) and `api` integration tests
// against a real PostgreSQL test database (npm run test:api).
const shared = {
  transform: { "\\.m?[jt]sx?$": "babel-jest" },
  // react-router 8 and two of its dependencies ship ESM only, so babel-jest compiles them too.
  transformIgnorePatterns: ["/node_modules/(?!(react-router|@remix-run|cookie-es)/)"],
};

module.exports = {
  // Section 6.1 target: at least 80% coverage of the core rule modules (npm run test:coverage).
  collectCoverageFrom: ["server/lib/**/*.js", "shared/**/*.js"],
  coverageThreshold: { global: { lines: 80, branches: 80 } },
  projects: [
    {
      ...shared,
      displayName: "server",
      testEnvironment: "node",
      testMatch: ["<rootDir>/server/**/*.test.js", "<rootDir>/shared/**/*.test.js"],
      testPathIgnorePatterns: ["\\.api\\.test\\.js$"],
    },
    // React components run in jsdom. CSS imports are stubbed out since Jest can't parse them.
    {
      ...shared,
      displayName: "client",
      testEnvironment: "jsdom",
      testMatch: ["<rootDir>/client/src/**/*.test.{js,jsx}"],
      moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/client/src/$1",
        "^@shared/(.*)$": "<rootDir>/shared/$1",
        "\\.css$": "<rootDir>/client/src/test/styleStub.js",
      },
      setupFilesAfterEnv: ["<rootDir>/client/src/test/setup.js"],
    },
    {
      ...shared,
      displayName: "api",
      testEnvironment: "node",
      testMatch: ["<rootDir>/server/**/*.api.test.js"],
      setupFiles: ["<rootDir>/server/test/apiEnv.js"],
    },
  ],
};
