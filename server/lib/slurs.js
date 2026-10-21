import { DataSet, englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";

// Blocks slurs (words that attack people for who they are) in text players send each other: trade messages,
// meetup places, proposal messages and usernames. Ordinary swearing is allowed; adults trading cards can swear.
// obscenity's matcher also catches disguised spellings (n1gg3r, f@g, repeated letters, look-alike characters)
// and skips harmless words that happen to contain one ("Scunthorpe", plus the ones listed below).
// ponytail: spaced or dotted spellings (r.e.t.a.r.d) get through, since ignoring punctuation and spaces would flag
// normal text ("a bo..." reads as "abo"); players can still report those to moderators.
const SLURS = new Set([
  "abeed", "abo", "africoon", "arabush", "boonga", "chingchong", "chink", "dyke", "fag", "kike", "negro", "nigger",
  "retard", "spastic", "tranny",
]);

const slurs = new DataSet().addAll(englishDataset).removePhrasesIf((phrase) => !SLURS.has(phrase.metadata?.originalWord));
const built = slurs.build();
const matcher = new RegExpMatcher({
  ...built,
  whitelistedTerms: [...built.whitelistedTerms, "retardant", "retardation"], // fire retardant, a medical term
  ...englishRecommendedTransformers,
});

/** Whether `text` contains a slur. */
export const hasSlur = (text) => typeof text === "string" && matcher.hasMatch(text);

/** The error players see when something they wrote contains one. */
export const SLUR_MESSAGE = "That includes a slur, which isn't allowed on Tap to Trade. Please rephrase it.";

/** usernameMessage() from shared/validation.js plus this check (server only, so the word list stays off the page). */
export const usernameProblem = (username, shapeProblem) =>
  shapeProblem ?? (hasSlur(username) ? "That username includes a slur. Please choose another." : null);
