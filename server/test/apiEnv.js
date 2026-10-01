// Runs before each API integration test file: point the app at the disposable test database.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL (see .env.example). The API tests drop and recreate its schema.");
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET ||= "test-session-secret";
process.env.EMAIL_API_KEY = "";
