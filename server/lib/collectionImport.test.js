import { identifierFor, matchesIdentifier, parseCollection, parseCsv, toCondition, toFinish } from "./collectionImport.js";

// Trimmed real-world header rows from each site's collection export.
const MOXFIELD = `"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"
"4","4","Lightning Bolt","m10","Near Mint","English","","","2026-09-01 10:00:00.000000","146","False","False",""
"1","0","Sol Ring","c21","Good (Lightly Played)","English","etched","","2026-09-01 10:00:00.000000","263","False","False",""
"2","0","Delver of Secrets // Insectile Aberration","isd","Played","English","foil","","","51","False","False",""`;

const ARCHIDEKT = `Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Multiverse Id,Scryfall ID,Collector Number
3,Opt,Foil,LP,2026-09-01,EN,0.25,,Eldraine,eld,0,4c1ef8a2-1b23-4c9a-9d0e-0123456789ab,59`;

const MANABOX = `Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency
"Counterspell",mh2,"Modern Horizons 2",267,normal,uncommon,2,123,,0.5,false,false,played,en,USD`;

const DECKBOX = `Count,Tradelist Count,Name,Edition,Edition Code,Card Number,Condition,Language,Foil,Signed,Artist Proof,Altered Art,Misprint,Promo,Textless,Printing Id,Printing Note,Tags,My Price
1,1,"Black Lotus","Limited Edition Alpha",lea,232,Heavily Played,English,,,,,,,,,,,$0.00`;

const TCGPLAYER = `Quantity,Name,Simple Name,Set,Card Number,Set Code,Printing,Condition,Language,Rarity,Product ID,SKU
1,"Sol Ring (Showcase)","Sol Ring","Commander 2021",263,C21,Normal,Near Mint,English,Uncommon,1,2`;

const DRAGON_SHIELD = `sep=,
Folder Name,Quantity,Trade Quantity,Card Name,Set Code,Set Name,Card Number,Condition,Printing,Language,Price Bought,Date Bought,LOW,MID,MARKET
Binder,1,0,Lightning Bolt,M10,Magic 2010,146,Played,Foil,English,1.00,2026-09-01,1,1,1`;

describe("collection import parsing", () => {
  test("Moxfield: codes, long condition names, foil and etched, double-faced names", () => {
    const { format, rows, skipped } = parseCollection(MOXFIELD);
    expect(format).toBe("Moxfield");
    expect(skipped).toEqual([]);
    expect(rows.map((r) => [r.quantity, r.name, r.setCode, r.collectorNumber, r.condition, r.finish])).toEqual([
      [4, "Lightning Bolt", "m10", "146", "NM", "nonfoil"],
      [1, "Sol Ring", "c21", "263", "LP", "etched"],
      [2, "Delver of Secrets // Insectile Aberration", "isd", "51", "MP", "foil"],
    ]);
  });

  test("Archidekt: prefers the Scryfall id", () => {
    const { format, rows } = parseCollection(ARCHIDEKT);
    expect(format).toBe("Archidekt");
    expect(rows[0]).toMatchObject({ quantity: 3, scryfallId: "4c1ef8a2-1b23-4c9a-9d0e-0123456789ab", finish: "foil", condition: "LP" });
    expect(identifierFor(rows[0])[1]).toEqual({ id: "4c1ef8a2-1b23-4c9a-9d0e-0123456789ab" });
  });

  test("ManaBox and Dragon Shield use the European scale, where Played is heavily played", () => {
    expect(parseCollection(MANABOX)).toMatchObject({ format: "ManaBox", rows: [{ name: "Counterspell", condition: "HP", finish: "nonfoil", setCode: "mh2" }] });
    expect(parseCollection(DRAGON_SHIELD)).toMatchObject({ format: "Dragon Shield", rows: [{ name: "Lightning Bolt", condition: "HP", finish: "foil", setCode: "m10" }] });
  });

  test("Deckbox and TCGplayer: set code column wins over the set name, and Simple Name over Name", () => {
    expect(parseCollection(DECKBOX).rows[0]).toMatchObject({ name: "Black Lotus", setCode: "lea", collectorNumber: "232", condition: "HP" });
    expect(parseCollection(TCGPLAYER)).toMatchObject({ format: "TCGplayer", rows: [{ name: "Sol Ring", setCode: "c21", finish: "nonfoil" }] });
  });

  test("plain text lists, with tags, sections and foil markers", () => {
    const { format, rows, skipped } = parseCollection("Deck\n4 Lightning Bolt\n1x Sol Ring (C21) 263 [Ramp]\n2 Opt (ELD) 59 *F*\n\nSideboard\n1 Fable of the Mirror-Breaker // Reflection of Kiki-Jiki (NEO) 141 *E*\nnot a card line");
    expect(format).toBe("Text list");
    expect(rows.map((r) => [r.quantity, r.name, r.setCode, r.collectorNumber, r.finish])).toEqual([
      [4, "Lightning Bolt", null, null, "nonfoil"],
      [1, "Sol Ring", "c21", "263", "nonfoil"],
      [2, "Opt", "eld", "59", "foil"],
      [1, "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki", "neo", "141", "etched"],
    ]);
    expect(skipped).toEqual([{ line: 8, name: "not a card line", reason: expect.any(String) }]);
  });

  test("bad rows are reported with their line number instead of failing the whole file", () => {
    const { rows, skipped } = parseCollection("Count,Name,Condition,Foil\n2,Opt,Mint,\nlots,Opt,NM,\n1,Opt,Shiny,\n0,Opt,NM,\n1,,NM,");
    expect(rows).toHaveLength(1);
    expect(skipped.map((s) => s.line)).toEqual([3, 4, 6]); // the zero-count row is silently ignored
  });

  test("CSV quoting: commas and doubled quotes inside fields, CRLF, BOM, semicolons", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
    expect(parseCollection('﻿Amount;Card Name;Condition\n2;"Borrowing 100,000 Arrows";NM').rows[0]).toMatchObject({ quantity: 2, name: "Borrowing 100,000 Arrows" });
  });

  test("condition and finish vocabularies", () => {
    expect(["NM", "Near Mint", "near_mint", "", "Mint"].map((c) => toCondition(c))).toEqual(["NM", "NM", "NM", "NM", "NM"]);
    expect(["Lightly Played", "SP", "Good (Lightly Played)"].map((c) => toCondition(c))).toEqual(["LP", "LP", "LP"]);
    expect(toCondition("Excellent", "ManaBox")).toBe("LP");
    expect(toCondition("Poor", "Dragon Shield")).toBe("DMG");
    expect(toCondition("pristine")).toBeNull();
    expect(["", "normal", "Foil", "Yes", "TRUE", "etched", "foil_etched", "glitter"].map(toFinish)).toEqual([
      "nonfoil", "nonfoil", "foil", "foil", "foil", "etched", "etched", null,
    ]);
  });

  test("matching Scryfall results back to lookups", () => {
    const bolt = { id: "x1", name: "Lightning Bolt", set: "m10", collector_number: "146" };
    const delver = { id: "x2", name: "Delver of Secrets // Insectile Aberration", set: "isd", collector_number: "51", card_faces: [{ name: "Delver of Secrets" }, { name: "Insectile Aberration" }] };
    expect(matchesIdentifier(bolt, { set: "M10", collector_number: "146" })).toBe(true);
    expect(matchesIdentifier(bolt, { name: "lightning bolt" })).toBe(true);
    expect(matchesIdentifier(bolt, { name: "Lightning Bolt", set: "2ed" })).toBe(false);
    expect(matchesIdentifier(delver, { name: "Delver of Secrets" })).toBe(true);
    expect(matchesIdentifier(delver, { id: "x1" })).toBe(false);
  });
});
