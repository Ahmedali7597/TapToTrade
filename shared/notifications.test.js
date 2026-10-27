import { EMAIL_CATEGORIES, emailPrefsFor, NOTIFICATION_KINDS, notificationText } from "./notifications.js";

test("every notification kind has a sentence and a known email setting", () => {
  const keys = EMAIL_CATEGORIES.map(([k]) => k);
  for (const [kind, { email, text }] of Object.entries(NOTIFICATION_KINDS)) {
    expect(email === null || keys.includes(email)).toBe(true);
    expect(notificationText({ kind, actor: { username: "bob" } })).toBe(text("bob"));
  }
  expect(notificationText({ kind: "trade_request", actor: { username: "bob" } })).toBe("bob sent you a trade request");
  expect(notificationText({ kind: "trade_message" })).toBe("New message from A player");
  expect(notificationText({ kind: "unknown" })).toBe("Trade update");
});

test("email choices default to on", () => {
  expect(emailPrefsFor()).toEqual({ requests: true, updates: true, messages: true, meetups: true });
  expect(emailPrefsFor(null)).toEqual({ requests: true, updates: true, messages: true, meetups: true });
  expect(emailPrefsFor({ messages: false, junk: false })).toEqual({ requests: true, updates: true, messages: false, meetups: true });
});
