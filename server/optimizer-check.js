import { buildPool, front, lookupNames } from "./lib/cedh.js";
import { compare, manaBase, optimize } from "../shared/optimizer.js";

// Runs the deck optimizer on Wizards' Commander precons (decklists from MTGJSON) with live Scryfall, EDHREC and
// Commander Spellbook data, and checks every swap against the optimizer's rules:
//   npm run optimizer:check -- [budget, default 500 or Infinity] [goal: preserve or value] [precon file names...]
// The precons cover one to five colours and most strategies: tribal, tokens, landfall, aristocrats, spellslinger,
// artifacts, enchantments, +1/+1 counters, goad, reanimator. Prints each deck's swaps by kind and its land base
// before and after, then any swap that breaks a rule. Takes about ten minutes (a few dozen requests per deck).
const PRECONS = [
  ["CallingAllAngels_FDC", "W angels"],
  ["KeenEngineering_FDC", "U artifacts"],
  ["WretchedRanks_FDC", "B zombies"],
  ["ReignOfDragons_FDC", "R dragons"],
  ["TramplesaurusRex_FDC", "G stompy"],
  ["FirstFlight_SCD", "WU flyers"],
  ["GraveDanger_SCD", "UB graveyard"],
  ["ChaosIncarnate_SCD", "BR goad"],
  ["DraconicDestruction_SCD", "RG dragons"],
  ["TokenTriumph_SCD", "GW tokens"],
  ["BloodRites_LCC", "WB vampires"],
  ["DeathToll_DSC", "BG self-mill"],
  ["EndlessPunishment_DSC", "BR punisher"],
  ["JumpScare_DSC", "GU lands"],
  ["ExplorersOfTheDeep_LCC", "GU merfolk"],
  ["AnimatedArmy_BLC", "RG enchantments"],
  ["SquirreledAway_BLC", "BG aristocrats"],
  ["MiracleWorker_DSC", "WUB enchantress"],
  ["AhoyMateys_LCC", "UBR pirates"],
  ["WorldShaper_EOC", "BRG landfall"],
  ["VelociRampTor_LCC", "RGW dinosaurs"],
  ["AbzanArmor_TDC", "WBG toughness"],
  ["TemurRoar_TDC", "GUR counters"],
  ["JeskaiStriker_TDC", "URW spellslinger"],
  ["CounterIntelligence_EOC", "URW artifacts"],
  ["FamilyMatters_BLC", "URW tokens"],
  ["PeaceOffering_BLC", "GWU group hug"],
  ["SliverSwarm_CMM", "WUBRG slivers"],
  ["EldraziIncursion_M3C", "WUBRG eldrazi"],
];
const [budgetArg = "500", mode = "preserve", ...only] = process.argv.slice(2);
const budget = Number(budgetArg);
const problems = [];
const tally = {};
for (const [file, what] of PRECONS.filter(([f]) => !only.length || only.includes(f))) {
  const res = await fetch(`https://mtgjson.com/api/v5/decks/${file}.json`);
  if (!res.ok) throw new Error(`MTGJSON ${file}: HTTP ${res.status}`);
  const { data: precon } = await res.json();
  const cards = precon.mainBoard.flatMap((c) => Array(c.count).fill(c.name));
  const commanderCards = [...(await lookupNames(precon.commander.map((c) => c.name))).values()];
  const data = await buildPool(commanderCards, cards);
  const commanders = commanderCards.map((c) => c.name);
  const byFront = new Map(data.pool.map((c) => [front(c.name), c.name]));
  const byName = new Map(data.pool.map((c) => [c.name, c]));
  const original = cards.map((n) => byFront.get(front(n))).filter((n) => n && !commanders.includes(n));
  const r = optimize({ pool: data.pool, combos: data.combos, commanders, original, budget, mode, strategy: data.strategy });
  const lands = (deck) => {
    const m = manaBase(deck, byName, data.identity, commanders);
    return `${m.lands} lands (Karsten: ${m.wanted}), sources ${m.colours.map((c) => `${c.colour} ${c.sources}/${c.need}`).join(" ")}`;
  };
  console.log(`\n=== ${file} (${what}): ${commanders.join(" + ")}, ${original.length} cards, cost CA$${r.cost.total}`);
  console.log(`  before: ${lands(original)}\n  after:  ${lands(r.deck)}`);
  for (const c of r.changes) {
    tally[c.kind ?? "none"] = (tally[c.kind ?? "none"] ?? 0) + 1;
    console.log(`  [${c.kind ?? "-"}] ${c.remove} -> ${c.add}: ${c.why.effect.split(/(?<=\.) /).slice(0, 2).join(" ")}`);
    const [x, y] = [byName.get(c.add), byName.get(c.remove)];
    if (!c.kind) problems.push(`${file}: ${c.remove} -> ${c.add} has no kind`);
    if (c.kind === "strict" && compare(x, y, { identity: data.identity, strategy: data.strategy }).worse) problems.push(`${file}: "strictly better" ${c.remove} -> ${c.add} is worse somewhere`);
    if (c.kind === "edhrec" && !((y.recCut ?? 0) >= 0.5 || (y.edh ?? 0) < 0.3)) problems.push(`${file}: EDHREC's pick cuts ${c.remove}, which EDHREC doesn't rate weak`);
    if (c.kind === "edhrec" && !(x.recAdd >= 0.3)) problems.push(`${file}: EDHREC's pick adds ${c.add}, which EDHREC barely suggests`);
    if (c.kind === "land" && y.utility) problems.push(`${file}: the land base trades away ${c.remove}, a utility land`);
  }
  if (r.deck.length !== 99) problems.push(`${file}: ${r.deck.length} cards`);
  if (r.cost.total > budget) problems.push(`${file}: CA$${r.cost.total}, over budget`);
}
console.log(`\nSwaps by kind: ${JSON.stringify(tally)}`);
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : "Every swap follows the rules.");
process.exitCode = problems.length ? 1 : 0;
