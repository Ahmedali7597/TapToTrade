import { LINE } from "./collectionImport.js";

// Pasted decklists, in the text formats Moxfield, Archidekt, Arena and MTGO export:
//   Commander / Deck / Sideboard / Maybeboard section lines (with or without a colon, any case),
//   "1 Sol Ring (C21) 263 *F*" card lines, and Archidekt's "[Commander{top}]" / "[Sideboard]" category tags.
const SECTIONS = { commander: "commander", commanders: "commander", deck: "main", main: "main", mainboard: "main", sideboard: "side", side: "side", companion: "side", maybeboard: "maybe", maybe: "maybe", considering: "maybe" };

/** { rows: [{ line, quantity, name, setCode, collectorNumber, board }], skipped: [{ line, name, reason }] }. */
export function parseDeckList(text) {
  const rows = [];
  const skipped = [];
  let board = "main";
  String(text ?? "")
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const section = raw.trim().replace(/^\/\/\s*/, "").replace(/:$/, "").toLowerCase();
      if (SECTIONS[section]) return (board = SECTIONS[section]);
      const tags = [...raw.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].toLowerCase());
      const line = raw.replace(/\[[^\]]*\]|\^[^^]*\^|\s+#.*$/g, "").trim();
      if (!line || line.startsWith("//")) return;
      const m = LINE.exec(line);
      if (!m) return skipped.push({ line: i + 1, name: line.slice(0, 80), reason: "Couldn't read this line." });
      const tagged = tags.some((t) => t.includes("commander")) ? "commander" : tags.some((t) => t.includes("sideboard")) ? "side" : tags.some((t) => t.includes("maybe")) ? "maybe" : null;
      rows.push({ line: i + 1, quantity: Math.min(99, Number(m[1])), name: m[2].trim(), setCode: m[3]?.toLowerCase() ?? null, collectorNumber: m[4] ?? null, board: tagged ?? board });
    });
  return { rows: rows.filter((r) => r.quantity > 0), skipped };
}
