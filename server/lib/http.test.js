import { HttpError, httpsLinkOrBlank, idFrom, oneOf, readText } from "./http.js";

test("readText trims and checks the length; anything but a string counts as blank", () => {
  expect(readText("  hello  ", 2, 10)).toBe("hello");
  expect(readText("a", 2, 10)).toBeNull();
  expect(readText("x".repeat(11), 2, 10)).toBeNull();
  expect(readText(undefined, 0, 10)).toBe("");
  expect(readText(42, 1, 10)).toBeNull();
});

test("oneOf falls back to the first (default) value", () => {
  expect(oneOf("reviewed", ["pending", "reviewed"])).toBe("reviewed");
  expect(oneOf("'; DROP TABLE", ["pending", "reviewed"])).toBe("pending");
});

test("httpsLinkOrBlank: blank is null, only https links pass", () => {
  expect(httpsLinkOrBlank("  ")).toBeNull();
  expect(httpsLinkOrBlank("https://example.com/x")).toBe("https://example.com/x");
  expect(httpsLinkOrBlank("http://example.com")).toBeUndefined();
  expect(httpsLinkOrBlank("javascript:alert(1)")).toBeUndefined();
  expect(httpsLinkOrBlank("not a url")).toBeUndefined();
});

test("idFrom turns garbage ids into a 404", () => {
  expect(idFrom("42")).toBe(42);
  expect(() => idFrom("4x")).toThrow(HttpError);
  expect(() => idFrom("-1", "That deck")).toThrow("That deck was not found.");
});
