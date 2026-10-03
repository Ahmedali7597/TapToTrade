import { sendEmail } from "./email.js";

const message = { to: "player@example.test", subject: "Reset", text: "link" };

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.EMAIL_API_KEY;
  process.env.NODE_ENV = "test";
});

test("without a provider key, development prints the email instead of sending it", async () => {
  const info = jest.spyOn(console, "info").mockImplementation(() => {});
  const fetch = jest.spyOn(global, "fetch");
  await expect(sendEmail(message)).resolves.toBe(true);
  expect(info).toHaveBeenCalledWith(expect.stringContaining("[dev email] to=player@example.test"));
  expect(fetch).not.toHaveBeenCalled();
});

test("production without a key refuses to pretend it sent anything", async () => {
  process.env.NODE_ENV = "production";
  jest.spyOn(console, "error").mockImplementation(() => {});
  await expect(sendEmail(message)).resolves.toBe(false);
});

test("with a key, it calls Resend's HTTPS API with a bearer token", async () => {
  process.env.EMAIL_API_KEY = "re_test_key";
  const fetch = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 });
  await expect(sendEmail(message)).resolves.toBe(true);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(init.headers.Authorization).toBe("Bearer re_test_key");
  expect(JSON.parse(init.body)).toMatchObject({ to: "player@example.test", subject: "Reset" });
});

test("provider failures are reported, not thrown", async () => {
  process.env.EMAIL_API_KEY = "re_test_key";
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 422 });
  await expect(sendEmail(message)).resolves.toBe(false);
});

test("a timeout or network error is reported as not sent", async () => {
  process.env.EMAIL_API_KEY = "re_test_key";
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(global, "fetch").mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" }));
  await expect(sendEmail(message)).resolves.toBe(false);
});

test("HTML is sent alongside the text when given", async () => {
  process.env.EMAIL_API_KEY = "re_test_key";
  const fetch = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true, status: 200 });
  await sendEmail({ ...message, html: "<p>hi</p>" });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ text: "link", html: "<p>hi</p>" });
});
