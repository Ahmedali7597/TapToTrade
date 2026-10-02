import {
  CITIES,
  emailMessage,
  normalizeEmail,
  parseQuantity,
  passwordMessage,
  passwordProblems,
  usernameMessage,
  validateRegistration,
} from "./validation.js";

const valid = { email: "Player@Example.com ", username: "brewer_1", password: "Secure@1", city: "Hamilton, ON" };

describe("password policy (4.1.3)", () => {
  test("UT-01 rejects 'abc' for length and complexity", () => {
    expect(passwordMessage("abc")).toMatch(/^Password needs /);
    expect(passwordProblems("abc")).toEqual(
      expect.arrayContaining(["at least 8 characters", "an uppercase letter", "a number", "a symbol"]),
    );
  });

  test("UT-02 accepts 'Secure@1'", () => {
    expect(passwordProblems("Secure@1")).toEqual([]);
  });

  test.each([
    ["no uppercase", "secure@12", "an uppercase letter"],
    ["no lowercase", "SECURE@12", "a lowercase letter"],
    ["no number", "Secure@@", "a number"],
    ["no symbol", "Secure12", "a symbol"],
  ])("rejects a password with %s", (_, pw, problem) => {
    expect(passwordProblems(pw)).toEqual([problem]);
  });

  test("rejects non-strings and absurdly long passwords", () => {
    expect(passwordProblems(undefined)).toContain("at least 8 characters");
    expect(passwordProblems(`Aa1!${"x".repeat(200)}`)).toEqual(["at most 128 characters"]);
  });
});

describe("registration (4.1.2)", () => {
  test("accepts a complete form", () => {
    expect(validateRegistration(valid)).toEqual({});
  });

  test("UT-03 returns a validation error when city is missing", () => {
    expect(validateRegistration({ ...valid, city: "" })).toEqual({ city: "City is required." });
  });

  test("flags every missing field", () => {
    expect(Object.keys(validateRegistration({}))).toEqual(["email", "username", "password", "city"]);
  });

  test("rejects a city outside the controlled list", () => {
    expect(validateRegistration({ ...valid, city: "123 Main St" }).city).toMatch(/choose your city/i);
    expect(CITIES).toContain("Hamilton, ON");
    expect(validateRegistration({ ...valid, city: "Hamilton" }).city).toMatch(/choose your city/i); // needs the province
    // Canada-wide, and names shared between provinces stay distinct.
    expect(CITIES).toEqual(expect.arrayContaining(["Vancouver, BC", "Montréal, QC", "Windsor, ON", "Windsor, NS", "Iqaluit, NU"]));
    expect(new Set(CITIES).size).toBe(CITIES.length);
  });

  test("validates email and username format", () => {
    expect(emailMessage("not-an-email")).toMatch(/valid email/);
    expect(normalizeEmail("  A@B.CO ")).toBe("a@b.co");
    expect(usernameMessage("ab")).toMatch(/3-24/);
    expect(usernameMessage("<script>")).toMatch(/3-24/);
  });
});

describe("quantity (4.3.4)", () => {
  test("UT-04 rejects -5", () => {
    expect(parseQuantity(-5)).toBeNull();
  });

  test("UT-05 accepts 3", () => {
    expect(parseQuantity(3)).toBe(3);
    expect(parseQuantity("3")).toBe(3);
  });

  test.each([0, 1.5, "1.5", "abc", "", null, undefined, 10000, NaN])("rejects %p", (value) => {
    expect(parseQuantity(value)).toBeNull();
  });
});
