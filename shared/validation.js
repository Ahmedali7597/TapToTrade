// Validation rules shared by the React forms and the Express API.
// The server always re-validates; the client uses the same rules for instant feedback.

import { CITIES } from "./cities.js";

// Controlled city list (req 4.1.2 / 4.2.2): a city, never a street address (privacy plan 12.1).
// The list, its coordinates and the distance helpers live in cities.js.
export { CITIES, CITY_GROUPS } from "./cities.js";

// Standard card grading scale, best to worst. The labels are what the dropdowns show.
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
export const CONDITION_LABELS = {
  NM: "Near mint",
  LP: "Lightly played",
  MP: "Moderately played",
  HP: "Heavily played",
  DMG: "Damaged",
};

// Finish is the print type, separate from wear. Not every printing comes in every finish,
// so the server also checks the choice against the printing's own list from Scryfall.
export const FINISHES = ["nonfoil", "foil", "etched"];
export const FINISH_LABELS = { nonfoil: "Non-foil", foil: "Foil", etched: "Etched foil" };

// Matches the CHECK constraint on inventory_items.quantity.
const MAX_QUANTITY = 9999;
// Deliberately loose: "something@something.tld". The real check is whether the reset email arrives.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Usernames show up in URLs and trade lists, so keep them to plain word characters.
const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

/** Req 4.1.3: returns the list of unmet rules (empty = strong enough). */
export function passwordProblems(password) {
  const p = typeof password === "string" ? password : "";
  const problems = [];
  if (p.length < 8) problems.push("at least 8 characters");
  if (p.length > 128) problems.push("at most 128 characters");
  if (!/[a-z]/.test(p)) problems.push("a lowercase letter");
  if (!/[A-Z]/.test(p)) problems.push("an uppercase letter");
  if (!/\d/.test(p)) problems.push("a number");
  if (!/[^A-Za-z0-9]/.test(p)) problems.push("a symbol");
  return problems;
}

// One friendly sentence for the form, or null when the password is fine.
export function passwordMessage(password) {
  const problems = passwordProblems(password);
  return problems.length ? `Password needs ${problems.join(", ")}.` : null;
}

// Emails are compared trimmed and lower-cased everywhere, so "Bob@X.com " and "bob@x.com" are one account.
export const normalizeEmail = (email) => (typeof email === "string" ? email.trim().toLowerCase() : "");

// Each *Message helper returns an error string, or null when the value is OK.
export function emailMessage(email) {
  const e = normalizeEmail(email);
  if (!e) return "Email is required.";
  if (e.length > 254 || !EMAIL_RE.test(e)) return "Enter a valid email address.";
  return null;
}

export function usernameMessage(username) {
  if (!username) return "Username is required.";
  if (!USERNAME_RE.test(username)) return "Use 3-24 letters, numbers or underscores.";
  return null;
}

/** Meetup range in km: blank (not set) or a whole number from 1 to 500. Returns [value, error]. */
export function parseTravelKm(value) {
  if (value === null || value === undefined || value === "") return [null, null];
  const n = typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n >= 1 && n <= 500 ? [n, null] : [null, "Choose a distance from 1 to 500 km."];
}

export const cityMessage = (city) => (CITIES.includes(city) ? null : "Choose your city from the list.");

/** Req 4.1.2: email, username, password and city are all required. Returns { field: message }. */
export function validateRegistration({ email, username, password, city } = {}) {
  const errors = {
    email: emailMessage(email),
    username: usernameMessage(username),
    password: password ? passwordMessage(password) : "Password is required.",
    city: city ? cityMessage(city) : "City is required.",
  };
  // Drop the fields that passed so an empty object means "all good".
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v));
}

/** Req 4.3.4: a positive whole number. Accepts 3 or "3"; returns null when invalid. */
export function parseQuantity(value) {
  // Only accept plain digit strings, so "3.5", "1e3" and "0x10" don't sneak through Number().
  const n = typeof value === "string" && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  return Number.isInteger(n) && n > 0 && n <= MAX_QUANTITY ? n : null;
}
