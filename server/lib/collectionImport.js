// Collection import: turns an export from another collection site into inventory rows.
// Supported by header detection (column order never matters): Moxfield, Archidekt, ManaBox, Deckbox,
// TCGplayer, Dragon Shield, MTGGoldfish, TopDecked and similar CSVs, plus plain text lists such as
// "4 Lightning Bolt (M10) 146 *F*" (Moxfield / Arena / Archidekt text exports).

import { isUuid } from "./http.js";

export const MAX_ROWS = 5000;

// Header aliases, compared after lower-casing and stripping everything but letters and digits.
// The first alias found wins, so more specific names come first (TCGplayer's "Name" includes
// variant text like "(Showcase)", so its "Simple Name" is preferred).
const HEADERS = {
  quantity: ["count", "quantity", "qty", "amount", "groupcount"],
  name: ["simplename", "cardname", "name", "card", "title"],
  // "Edition"/"Set" is a code on Moxfield but a full set name on Deckbox; rows keep it only if it looks like a code.
  setCode: ["setcode", "editioncode", "setid", "edition", "set"],
  collectorNumber: ["collectornumber", "cardnumber", "collector", "number", "collectornum", "no"],
  scryfallId: ["scryfallid", "scryfalluuid", "id"],
  finish: ["finish", "foil", "printing", "premium", "isfoil", "foiling"],
  condition: ["condition", "cond"],
};
const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// Which site a header row most likely came from, only for the summary shown to the user.
const SIGNATURES = [
  ["ManaBox", ["manaboxid"]],
  ["Moxfield", ["tradelistcount", "alter", "proxy"]],
  ["Deckbox", ["tradelistcount", "editioncode", "cardnumber"]],
  ["Archidekt", ["editioncode", "editionname"]],
  ["Dragon Shield", ["foldername", "cardname"]],
  ["TCGplayer", ["simplename", "productid"]],
  ["MTGGoldfish", ["setid", "variation"]],
  ["TopDecked", ["setcode", "acquireddate"]],
];

const SET_CODE = /^[a-z0-9]{2,6}$/i;

// Condition words, normalized, for the US scale (TCGplayer, Moxfield, Deckbox, Archidekt...).
const US_GRADES = {
  NM: ["m", "mint", "nm", "nearmint", "nearmintmint"],
  LP: ["lp", "sp", "ex", "excellent", "goodlightlyplayed", "lightlyplayed", "lightplayed", "slightlyplayed", "good"],
  MP: ["mp", "played", "moderatelyplayed"],
  HP: ["hp", "heavilyplayed", "heavyplayed"],
  DMG: ["d", "dmg", "damaged", "poor", "po"],
};
// European (Cardmarket) scale used by Dragon Shield and ManaBox: "Played" is a grade lower than in the US.
const EU_GRADES = {
  NM: ["m", "mint", "nm", "nearmint"],
  LP: ["ex", "excellent"],
  MP: ["gd", "good", "lp", "lightplayed", "lightlyplayed"],
  HP: ["pl", "played", "heavilyplayed"],
  DMG: ["po", "poor", "damaged"],
};
const EU_FORMATS = ["Dragon Shield", "ManaBox"];

/** Maps a site's condition wording onto our five grades. Blank = Near mint; unknown = null. */
export function toCondition(raw, format = "CSV") {
  const c = norm(String(raw ?? ""));
  if (!c) return "NM";
  const grades = EU_FORMATS.includes(format) ? EU_GRADES : US_GRADES;
  return Object.keys(grades).find((g) => grades[g].includes(c)) ?? null;
}

/** Maps foil columns ("foil", "Yes", "TRUE", "1", "etched", "foil_etched", blank...) onto our finishes. */
export function toFinish(raw) {
  const f = norm(String(raw ?? ""));
  if (f.includes("etched")) return "etched";
  if (["foil", "yes", "true", "1", "y", "premium"].includes(f)) return "foil";
  if (["", "normal", "nonfoil", "regular", "no", "false", "0", "n"].includes(f)) return "nonfoil";
  return null;
}

/** RFC 4180 CSV parsing: quoted fields, doubled quotes, newlines inside quotes, CRLF. */
export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Finds the column index for each field we use; null when the header row isn't a card list. */
function mapHeaders(header) {
  const names = header.map(norm);
  const used = new Set();
  const pick = (aliases) => {
    for (const a of aliases) {
      const i = names.findIndex((n, idx) => n === a && !used.has(idx));
      if (i !== -1) return i;
    }
    return -1;
  };
  const cols = {};
  // Claim specific columns first so a generic alias ("set", "edition", "id") can't steal them.
  for (const key of ["scryfallId", "quantity", "name", "collectorNumber", "finish", "condition", "setCode"]) {
    const i = pick(HEADERS[key]);
    if (i !== -1) {
      cols[key] = i;
      used.add(i);
    }
  }
  return cols.name === undefined && cols.scryfallId === undefined ? null : cols;
}

const detectFormat = (header) => {
  const names = new Set(header.map(norm));
  return SIGNATURES.find(([, needles]) => needles.every((n) => names.has(n)))?.[0] ?? "CSV";
};

/** One plain-text list line: "4 Lightning Bolt", "1x Sol Ring (C21) 263", "2 Opt (ELD) 59 *F*". */
const LINE = /^(\d+)\s*x?\s+(.+?)(?:\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★-]+))?)?(?:\s+\*([FE])\*)?$/i;

function parseTextList(lines) {
  const rows = [];
  const skipped = [];
  lines.forEach((raw, i) => {
    // Drop Archidekt [categories], ^tags^ and trailing comments; skip section headers and blank lines.
    const line = raw.replace(/\[[^\]]*\]|\^[^^]*\^|\s+#.*$/g, "").trim();
    if (!line || line.startsWith("//") || /^(deck|sideboard|commander|companion|maybeboard)\b:?$/i.test(line)) return;
    const m = LINE.exec(line);
    if (!m) return skipped.push({ line: i + 1, name: line.slice(0, 80), reason: "Couldn't read this line." });
    rows.push({
      line: i + 1,
      quantity: Number(m[1]),
      name: m[2].trim(),
      setCode: m[3]?.toLowerCase() ?? null,
      collectorNumber: m[4] ?? null,
      scryfallId: null,
      finish: m[5]?.toUpperCase() === "E" ? "etched" : m[5] ? "foil" : "nonfoil",
      condition: "NM",
    });
  });
  return { format: "Text list", rows, skipped };
}

/**
 * Parses an export into { format, rows, skipped }. Each row is
 * { line, quantity, name, setCode, collectorNumber, scryfallId, finish, condition }.
 */
export function parseCollection(input) {
  let text = String(input ?? "").replace(/^﻿/, "");
  // Excel-style hint some apps put first, e.g. Dragon Shield's "sep=,".
  let delimiter = ",";
  const sep = /^sep=(.)\r?\n/i.exec(text);
  if (sep) {
    delimiter = sep[1];
    text = text.slice(sep[0].length);
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (!sep) delimiter = [",", ";", "\t"].reduce((best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best), ",");

  const table = firstLine.includes(delimiter) ? parseCsv(text, delimiter) : null;
  const cols = table && mapHeaders(table[0]);
  if (!cols) return parseTextList(text.split(/\r?\n/));

  const format = detectFormat(table[0]);
  const rows = [];
  const skipped = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (key) => (cols[key] === undefined ? "" : (cells[cols[key]] ?? "").trim());
    const name = get("name");
    const scryfallId = isUuid(get("scryfallId")) ? get("scryfallId").toLowerCase() : null;
    const qtyRaw = get("quantity");
    const quantity = qtyRaw === "" ? 1 : Number(qtyRaw);
    const condition = toCondition(get("condition"), format);
    const finish = toFinish(get("finish"));
    if (!name && !scryfallId) return skipped.push({ line, name: "", reason: "No card name." });
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) return skipped.push({ line, name, reason: "Quantity isn't a whole number from 1 to 9999." });
    if (quantity === 0) return; // some exports list wanted or traded-away cards with a zero count
    if (!condition) return skipped.push({ line, name, reason: `Unknown condition "${get("condition")}".` });
    if (!finish) return skipped.push({ line, name, reason: `Unknown finish "${get("finish")}".` });
    const setRaw = get("setCode");
    rows.push({
      line,
      quantity,
      name,
      setCode: SET_CODE.test(setRaw) ? setRaw.toLowerCase() : null,
      collectorNumber: get("collectorNumber") || null,
      scryfallId,
      finish,
      condition,
    });
  });
  return { format, rows, skipped };
}

/**
 * The Scryfall lookup for a row, most precise first: Scryfall id, set + collector number, name + set, name.
 * Returns [key, identifier] so identical rows share one lookup.
 */
export function identifierFor(row) {
  if (row.scryfallId) return [`id:${row.scryfallId}`, { id: row.scryfallId }];
  if (row.setCode && row.collectorNumber) {
    return [`sc:${row.setCode}:${row.collectorNumber.toLowerCase()}`, { set: row.setCode, collector_number: row.collectorNumber }];
  }
  if (row.setCode) return [`ns:${row.name.toLowerCase()}:${row.setCode}`, { name: row.name, set: row.setCode }];
  return [`n:${row.name.toLowerCase()}`, { name: row.name }];
}

/** Does Scryfall card `card` answer lookup `ident`? Double-faced cards also match their front face's name. */
export function matchesIdentifier(card, ident) {
  if (ident.id) return card.id === ident.id;
  const sameSet = !ident.set || card.set === ident.set.toLowerCase();
  if (ident.collector_number) return sameSet && String(card.collector_number).toLowerCase() === ident.collector_number.toLowerCase();
  const want = ident.name.toLowerCase();
  const names = [card.name, ...(card.card_faces ?? []).map((f) => f.name)].map((n) => String(n).toLowerCase());
  return sameSet && names.includes(want);
}
