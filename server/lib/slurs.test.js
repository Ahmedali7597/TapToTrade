import { hasSlur } from "./slurs.js";

// The examples below have to name slurs to test for them; they're kept to the milder end of the list.
test("slurs are caught, including disguised spellings", () => {
  for (const text of ["you retard", "what a r3tard", "RETARDDD", "spastic move", "you f@g"]) expect(hasSlur(text)).toBe(true);
});

test("ordinary messages and swearing are allowed", () => {
  for (const text of [
    "Can we meet at the Mana Vault on Friday at 6?",
    "This fucking deck finally works",
    "Damn, that's a good trade",
    "I'm in Scunthorpe for the weekend",
    "Fire retardant spray", // whitelisted: a real word that contains one
    "",
  ]) expect(hasSlur(text)).toBe(false);
  expect(hasSlur(undefined)).toBe(false);
});
