import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { ArrowRight, Check, Lock, RotateCcw, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CardImage, ConditionBadge, ErrorAlert, PageHeader, SegmentedControl, Spinner, SuccessMessage, useApi } from "@/components/common";
import CardNameInput from "@/components/CardNameInput";
import { ColourDots } from "@/pages/Decks";
import { undoKey } from "@/pages/Deck";
import { api, qs } from "@/lib/api";
import { cad } from "@/lib/prices";
import { cn } from "@/lib/utils";
import { applyChanges, BUDGET_TIERS, cardValue, MODES, optimize, report, ROLES, SCORE_NOTES } from "@shared/optimizer";

// The Commander deck optimizer: pick a commander (locked), paste or load a 99, set a budget in CAD, and the page
// rebuilds the 99 on every change (shared/optimizer.js runs here, so the slider never waits on the server). The
// player picks which swaps to take, applies them to their saved deck or a new one, and can undo it afterwards.

const PRESETS = [100, 250, 500, 750, 1000, 2500];
const DRAFT_KEY = "ttt-optimizer-draft";
const pct = (p) => `${(p * 100).toFixed(1)}%`;
const money = (n) => (n === Infinity ? "Unlimited" : cad(n));
const changeKey = (c) => `${c.remove ?? ""}→${c.add ?? ""}`;

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function writeJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not remembered: private window or storage full */
  }
}

/** Cards as a "1 Sol Ring (FIC) 263" list with Commander and Deck sections, for the deck import. */
function listText(commanders, names, printingOf, extra = "") {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const line = (n, q) => `${q} ${n}${printingOf(n) ? ` ${printingOf(n)}` : ""}`;
  return ["Commander", ...commanders.map((n) => line(n, 1)), "", "Deck", ...[...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([n, q]) => line(n, q)), extra].join("\n").trim() + "\n";
}

/** Commander, list and (optionally) one of the player's decks to load them from. */
function Setup({ initial, onAnalyze, busy }) {
  const [commander, setCommander] = useState(initial.commander ?? "");
  const [partner, setPartner] = useState(initial.partner ?? "");
  const [withPartner, setWithPartner] = useState(Boolean(initial.partner));
  const [text, setText] = useState(initial.text ?? "");
  const [deckId, setDeckId] = useState(initial.deckId ?? "");
  const [loadError, setLoadError] = useState(null);
  const { data: decks } = useApi("/decks");
  const commanderDecks = (decks?.decks ?? []).filter((d) => d.format === "commander");

  // Keep what's been typed if the analysis fails or the page is closed (5.5.2).
  useEffect(() => writeJson(DRAFT_KEY, { commander, partner: withPartner ? partner : "", text }), [commander, partner, withPartner, text]);

  const load = async (id) => {
    setDeckId(id);
    setLoadError(null);
    if (!id) return;
    try {
      const { cards } = await api(`/decks/${id}`);
      const cmd = cards.filter((c) => c.board === "commander").map((c) => c.printing.name);
      setCommander(cmd[0] ?? "");
      setPartner(cmd[1] ?? "");
      setWithPartner(cmd.length > 1);
      setText(cards.filter((c) => c.board === "main").map((c) => `${c.quantity} ${c.printing.name}`).join("\n"));
      onAnalyze({ commanders: cmd, text: cards.filter((c) => c.board === "main").map((c) => `${c.quantity} ${c.printing.name}`).join("\n"), deckId: id, deckCards: cards });
    } catch (err) {
      setLoadError(err);
    }
  };
  const submit = (e) => {
    e.preventDefault();
    onAnalyze({ commanders: [commander, withPartner ? partner : ""].filter((n) => n.trim()), text, deckId: null });
  };
  return (
    <Card className="py-5">
      <CardContent>
        <form onSubmit={submit} className="grid gap-4">
          {commanderDecks.length > 0 && (
            <div className="grid gap-1 sm:max-w-md">
              <Label htmlFor="opt-deck">Start from one of your decks</Label>
              <NativeSelect id="opt-deck" value={deckId} onChange={(e) => load(e.target.value)} className="w-full">
                <NativeSelectOption value="">Paste a list instead</NativeSelectOption>
                {commanderDecks.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {d.name} ({d.cards} cards)
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <ErrorAlert error={loadError} title="Couldn't load that deck" />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="opt-commander">Commander</Label>
              <CardNameInput id="opt-commander" placeholder="e.g. Kinnan, Bonder Prodigy" value={commander} onChange={(e) => setCommander(e.target.value)} required />
            </div>
            {withPartner && (
              <div className="grid gap-1">
                <Label htmlFor="opt-partner">Partner</Label>
                <CardNameInput id="opt-partner" placeholder="e.g. Thrasios, Triton Hero" value={partner} onChange={(e) => setPartner(e.target.value)} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Switch id="opt-with-partner" checked={withPartner} onCheckedChange={setWithPartner} />
            <Label htmlFor="opt-with-partner">Two commanders (Partner, Friends forever or a Background)</Label>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="opt-list">Your 99</Label>
            <Textarea id="opt-list" rows={8} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" placeholder={"1 Sol Ring\n1 Mana Vault\n1 Demonic Tutor\n30 Island"} />
            <p className="text-xs text-muted-foreground">Moxfield, Archidekt, Arena or MTGO text. Leave it empty to build a deck from scratch. The commander above is used even if the list names another one.</p>
          </div>
          <div>
            <Button type="submit" disabled={busy || !commander.trim()} className="gap-1.5">
              <Sparkles aria-hidden="true" /> {busy ? "Analyzing…" : "Analyze and optimize"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Budget slider, typed amount, presets and Unlimited. */
function BudgetControls({ budget, setBudget, mode, setMode, commanderCost, strategy }) {
  const unlimited = budget === Infinity;
  const [typed, setTyped] = useState(unlimited ? "" : String(budget));
  useEffect(() => setTyped(unlimited ? "" : String(budget)), [budget, unlimited]);
  return (
    <Card className="gap-4 py-5">
      <CardHeader>
        <CardTitle className="text-base">Budget and goal</CardTitle>
        <p className="text-xs text-muted-foreground">The budget is for the whole deck in Canadian dollars, including the commander ({cad(commanderCost)}). The commander never changes with it.</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Label htmlFor="opt-budget-range" className="sr-only">
              Budget
            </Label>
            <input
              id="opt-budget-range"
              type="range"
              min={50}
              max={5000}
              step={10}
              value={unlimited ? 5000 : Math.min(5000, budget)}
              disabled={unlimited}
              onChange={(e) => setBudget(Number(e.target.value))}
              className="min-w-0 flex-1 accent-primary"
              aria-valuetext={money(budget)}
            />
            <div className="flex items-center gap-1">
              <Label htmlFor="opt-budget" className="text-sm text-muted-foreground">
                CA$
              </Label>
              <Input
                id="opt-budget"
                type="number"
                min={0}
                step={10}
                inputMode="decimal"
                className="w-28"
                value={typed}
                disabled={unlimited}
                onChange={(e) => {
                  setTyped(e.target.value);
                  const n = Number(e.target.value);
                  if (e.target.value !== "" && Number.isFinite(n) && n >= 0) setBudget(n);
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <Button key={p} type="button" size="sm" variant={budget === p ? "default" : "outline"} onClick={() => setBudget(p)}>
                {cad(p).replace(".00", "")}
              </Button>
            ))}
            <span className="ml-1 flex items-center gap-2 text-sm">
              <Switch id="opt-unlimited" checked={unlimited} onCheckedChange={(on) => setBudget(on ? Infinity : 500)} />
              <Label htmlFor="opt-unlimited">Unlimited</Label>
            </span>
          </div>
        </div>
        <div className="grid gap-1">
          <SegmentedControl label="Optimization goal" value={mode} onChange={setMode} options={MODES.map(([value, label]) => ({ value, label }))} className="max-w-full flex-wrap" />
          <p className="text-xs text-muted-foreground">
            {mode === "max" && "Rebuilds all 99 for the strongest deck the budget allows, including a new combo plan if it's better."}
            {mode === "preserve" && "Keeps your combos and most of your cards. It only swaps a card EDHREC's suggestions for your list say to cut, and only for a direct upgrade: one that does everything it did, and more."}
            {mode === "value" && "Starts from your deck and makes the upgrades with the biggest gain per dollar first."}
          </p>
          <StrategyNote strategy={strategy} />
        </div>
      </CardContent>
    </Card>
  );
}

/** What the commander rewards, which the swaps keep: "Venom attacks and sacrifices creatures; bigger mana value creatures fuel it." */
function StrategyNote({ strategy }) {
  if (!strategy?.name || (!strategy.plans.length && !strategy.fuel && !strategy.themes.length)) return null;
  const and = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{strategy.name}&apos;s plan: </span>
      {strategy.plans.length > 0 && `it ${and(strategy.plans.map((p) => p.text))}. `}
      {strategy.fuel && `Creatures with a bigger ${strategy.fuel} give it more. `}
      {strategy.themes.length > 0 && `EDHREC's most common themes for it: ${and(strategy.themes)}.`}
    </p>
  );
}

const SCORE_LABELS = [
  ["overall", "Competitive score"],
  ["speed", "Speed"],
  ["consistency", "Consistency"],
  ["interaction", "Interaction"],
  ["resilience", "Resilience"],
  ["combo", "Combo efficiency"],
];

function Delta({ before, after, unit = "", better = "up" }) {
  const d = Math.round((after - before) * 10) / 10;
  if (!d) return <span className="text-xs text-muted-foreground">no change</span>;
  const good = better === "up" ? d > 0 : d < 0;
  return <span className={cn("text-xs font-semibold tabular-nums", good ? "text-success" : "text-destructive")}>{`${d > 0 ? "+" : ""}${d}${unit}`}</span>;
}

/** Original against optimized: scores, densities, cost and win turns. */
function Dashboard({ before, after, budget, picked }) {
  const turn = (t) => (t == null ? "after turn 10" : `turn ${t}`);
  return (
    <section aria-labelledby="opt-dash" className="grid gap-3">
      <h2 id="opt-dash" className="text-lg font-bold">
        Deck performance
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {SCORE_LABELS.map(([key, label]) => (
          <div key={key} className={cn("rounded-xl border bg-card p-3 shadow-xs", key === "overall" && "border-primary/40")}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold tabular-nums">
              {after.scores[key]}
              <span className="text-sm font-normal text-muted-foreground">/100</span>
            </p>
            <p className="text-xs text-muted-foreground">
              was {before.scores[key]} · <Delta before={before.scores[key]} after={after.scores[key]} />
            </p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        {[
          ["Fast mana", `${after.counts.fastMana}`, before.counts.fastMana, after.counts.fastMana],
          ["Tutors", `${after.counts.tutor}`, before.counts.tutor, after.counts.tutor],
          ["Interaction (free)", `${after.counts.interaction} (${after.free})`, before.counts.interaction, after.counts.interaction],
          ["Deck cost", cad(after.cost.total), before.cost.total, after.cost.total, "down"],
          ["Remaining budget", budget === Infinity ? "No limit" : cad(Math.max(0, budget - after.cost.total)), null, null],
          ["Your picks cost", cad(picked.cost.total), null, null],
        ].map(([label, value, b, a, better]) => (
          <div key={label} className="rounded-xl border bg-card p-3 shadow-xs">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-bold tabular-nums">{value}</p>
            {b != null && (
              <p className="text-xs text-muted-foreground">
                was {typeof b === "number" && label === "Deck cost" ? cad(b) : b} · <Delta before={b} after={a} better={better} />
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-3 text-sm shadow-xs">
          <p className="font-semibold">Earliest theoretical win: {turn(after.earliest)}</p>
          <p className="text-xs text-muted-foreground">
            Was {turn(before.earliest)}. A perfect draw: every piece of the best line in hand with the deck's best fast mana. Rarely happens.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-3 text-sm shadow-xs">
          <p className="font-semibold">Realistic turn to threaten a win: {after.sim ? turn(after.expected) : "no combo line"}</p>
          <p className="text-xs text-muted-foreground">
            Was {before.sim ? turn(before.expected) : "no combo line"}. The median from {after.sim?.trials.toLocaleString() ?? "0"} simulated games (goldfish: no opponents, no interaction), so it is an estimate.
          </p>
        </div>
      </div>
      {after.cost.unpriced.length > 0 && <p className="text-xs text-warning">No market price for {after.cost.unpriced.join(", ")}, so the cost leaves them out.</p>}
    </section>
  );
}

/** Each swap as a card: what goes out, what comes in, the cost difference and why, with a checkbox and Reject. */
function Changes({ changes, chosen, toggle, setAll, reject, byName }) {
  if (!changes.length) return <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">No changes: this is already the best 99 the optimizer can find for this budget and goal.</p>;
  const card = (n, kind) => (
    <div className="flex min-w-0 items-center gap-3">
      {n && byName.get(n)?.imageUrl ? <CardImage name={n} imageUrl={byName.get(n).imageUrl} printingId={byName.get(n).printingId} className="w-14 shrink-0" /> : <div className="aspect-[488/680] w-14 shrink-0 rounded-md border border-dashed" aria-hidden="true" />}
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{kind === "add" ? "Add" : "Cut"}</p>
        <p className={cn("font-medium break-words", !n ? "text-muted-foreground" : kind === "add" ? "text-success" : "text-destructive")}>{n ?? "Nothing"}</p>
      </div>
    </div>
  );
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          {chosen.size} of {changes.length} swaps selected
        </span>
        <Button size="sm" variant="outline" onClick={() => setAll(true)}>
          Select all
        </Button>
        <Button size="sm" variant="outline" onClick={() => setAll(false)}>
          Select none
        </Button>
      </div>
      <ul className="grid gap-3" aria-label="Suggested swaps">
        {changes.map((c) => {
          const key = changeKey(c);
          const on = chosen.has(key);
          return (
            <li key={key} className={cn("grid gap-3 rounded-xl border bg-card p-3 shadow-xs transition-opacity sm:p-4", !on && "opacity-60")}>
              <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 size-5 shrink-0 accent-primary" checked={on} onChange={() => toggle(key)} aria-label={`Take: ${c.remove ?? "nothing"} out, ${c.add ?? "nothing"} in`} />
                <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                  {card(c.remove, "remove")}
                  {card(c.add, "add")}
                </div>
                <p className={cn("shrink-0 text-sm font-semibold tabular-nums", c.costDiff > 0 ? "text-foreground" : "text-success")} title="Cost difference">
                  {c.costDiff > 0 ? "+" : c.costDiff < 0 ? "−" : ""}
                  {cad(Math.abs(c.costDiff))}
                </p>
              </div>
              <dl className="grid gap-1.5 text-sm">
                {[
                  ["Why cut", c.why?.cut],
                  ["Why add", c.why?.add],
                  ["What changes", c.why?.effect],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt className="inline font-semibold">{k}: </dt>
                      <dd className="inline text-muted-foreground">{v}</dd>
                    </div>
                  ))}
              </dl>
              <div>
                <Button size="sm" variant="outline" className="gap-1 text-destructive" onClick={() => reject(c)} aria-label={`Reject ${c.add ? `adding ${c.add}` : ""}${c.add && c.remove ? " and " : ""}${c.remove ? `cutting ${c.remove}` : ""}`}>
                  <X aria-hidden="true" /> Reject this swap
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Reject keeps the card you have and never suggests the other one again; the deck is rebuilt around that. Rejected cards stay rejected when the budget or goal changes.</p>
    </div>
  );
}

/** Combo lines in the optimized deck, marked new or kept, plus lines the changes lose. */
function Combos({ before, after, byName, deck }) {
  const had = new Set(before.lines.map((l) => l.id));
  const has = new Set(after.lines.map((l) => l.id));
  const lost = before.lines.filter((l) => !has.has(l.id));
  const tutorsFor = (piece) => deck.filter((n) => byName.get(n)?.roles?.includes("tutor") && (byName.get(n).finds === "any" || (byName.get(n).finds ?? []).some((t) => (byName.get(piece)?.typeLine ?? "").toLowerCase().includes(t)))).length;
  const Line = ({ l, tag }) => (
    <li className="rounded-xl border bg-card p-3 text-sm shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{l.pieces.join(" + ")}</span>
        {tag}
        <Badge variant="outline">efficiency {l.efficiency}/100</Badge>
      </div>
      <p className="mt-1 text-muted-foreground">{l.produces.slice(0, 3).join(" · ")}</p>
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Mana to set up and run: </dt>
          <dd className="inline">{l.mana}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Earliest perfect-draw turn: </dt>
          <dd className="inline">{l.earliest ?? "after 10"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Colours: </dt>
          <dd className="inline">
            <ColourDots colors={[...new Set(l.pieces.flatMap((p) => byName.get(p)?.colorIdentity ?? []))]} />
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Tutors that find a piece: </dt>
          <dd className="inline">{l.pieces.map((p) => `${p.split(",")[0]} ${tutorsFor(p)}`).join(", ")}</dd>
        </div>
      </dl>
      {l.prerequisites && <p className="mt-2 text-xs whitespace-pre-line text-muted-foreground">Needs: {l.prerequisites}</p>}
      <p className="mt-2 text-xs text-muted-foreground">
        Weak to: {l.battlefield?.length ? "artifact or enchantment removal and graveyard hate on the pieces that sit on the battlefield, plus" : ""} counterspells and stax that stop the last piece.{" "}
        <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
          Steps on Commander Spellbook
        </a>
      </p>
    </li>
  );
  return (
    <section aria-labelledby="opt-combos" className="grid gap-3">
      <h2 id="opt-combos" className="text-lg font-bold">
        Combo lines
      </h2>
      {!after.lines.length && <p className="text-sm text-muted-foreground">The optimized deck has no complete combo from Commander Spellbook. It wins by other means, or the budget can't fit a line.</p>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {after.lines.slice(0, 8).map((l) => (
          <Line key={l.id} l={l} tag={had.has(l.id) ? <Badge variant="secondary">Kept</Badge> : <Badge className="bg-accent text-accent-foreground">New</Badge>} />
        ))}
      </ul>
      {lost.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Lines the changes take out: {lost.slice(0, 5).map((l) => l.pieces.join(" + ")).join("; ")}
          {lost.length > 5 && ` and ${lost.length - 5} more`}.
        </p>
      )}
    </section>
  );
}

/** Exact hypergeometric odds and the simulation, original against optimized. */
function Odds({ before, after }) {
  const keys = after.exact.map((e) => e.key);
  const old = new Map(before.exact.map((e) => [e.key, e.p]));
  return (
    <section aria-labelledby="opt-odds" className="grid gap-3">
      <h2 id="opt-odds" className="text-lg font-bold">
        Draw odds
      </h2>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
        <table className="w-full text-sm">
          <caption className="p-3 text-left text-xs text-muted-foreground">
            Exact: hypergeometric P(X ≥ k) = 1 − Σ C(K,i)·C(N−K,n−i) / C(N,n), with N = the 99 (the commander starts in the command zone), n = cards seen. By turn T you have seen 7 + T cards: in multiplayer nobody skips the first draw.
          </caption>
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Odds of…</th>
              <th className="p-2 text-right">Your deck</th>
              <th className="p-2 text-right">Optimized</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const e = after.exact.find((x) => x.key === k);
              return (
                <tr key={k} className="border-b last:border-0">
                  <td className="p-2">{e.label}</td>
                  <td className="p-2 text-right tabular-nums">{old.has(k) ? pct(old.get(k)) : "—"}</td>
                  <td className="p-2 text-right font-semibold tabular-nums">{pct(e.p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {after.sim && (
        <div className="rounded-xl border bg-card p-3 shadow-xs">
          <p className="text-sm font-semibold">Simulated: a combo line ready by each turn</p>
          <p className="mb-3 text-xs text-muted-foreground">
            Estimate from {after.sim.trials.toLocaleString()} seeded games per deck (±{(after.sim.margin * 100).toFixed(1)} points at turn 4, 95% confidence). Free first mulligan, then London mulligans; lands one a turn, fast mana counted when drawn, each tutor finds one piece it can reach, each card-draw card sees one more card. Mana colours, opponents
            and their interaction aren't modelled. Keeps the first seven {pct(after.sim.keep7)} of the time (was {before.sim ? pct(before.sim.keep7) : "—"}).
          </p>
          <div className="flex h-36 items-end gap-1.5" role="img" aria-label={`Chance a line is ready: ${after.sim.byTurn.slice(0, 8).map((p, i) => `turn ${i + 1} ${pct(p)}`).join(", ")}`}>
            {after.sim.byTurn.slice(0, 8).map((p, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[0.65rem] text-muted-foreground tabular-nums">{Math.round(p * 100)}%</span>
                <div className="flex h-24 w-full items-end gap-0.5">
                  <div className="flex-1 rounded-t-sm bg-muted-foreground/40" style={{ height: `${(before.sim?.byTurn[i] ?? 0) * 100}%` }} title={`Your deck: ${pct(before.sim?.byTurn[i] ?? 0)}`} />
                  <div className="flex-1 rounded-t-sm bg-primary/80" style={{ height: `${p * 100}%` }} title={`Optimized: ${pct(p)}`} />
                </div>
                <span className="text-xs font-medium">T{i + 1}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-muted-foreground/40" aria-hidden="true" /> Your deck
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2.5 rounded-sm bg-primary/80" aria-hidden="true" /> Optimized
            </span>
          </p>
        </div>
      )}
    </section>
  );
}

/** Real TapToTrade listings for the cards being added, nearest first. */
function Listings({ names, byName }) {
  const key = [...names].sort().join("|");
  const [state, setState] = useState({ key: null, data: null, error: null });
  useEffect(() => {
    if (!names.length) return;
    let live = true;
    // Wait for the budget to settle so a slider drag doesn't send a request per step.
    const t = setTimeout(() => {
      api("/optimizer/listings", { method: "POST", body: { names } }).then(
        (data) => live && setState({ key, data, error: null }),
        (error) => live && setState({ key, data: null, error }),
      );
    }, 700);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]); // names only matter through key
  if (!names.length) return null;
  const listings = state.key === key ? state.data?.listings : null;
  const withStock = names.filter((n) => listings?.[n]);
  return (
    <section aria-labelledby="opt-listings" className="grid gap-3">
      <h2 id="opt-listings" className="text-lg font-bold">
        Find the new cards on TapToTrade
      </h2>
      <p className="text-sm text-muted-foreground">
        Players near you who have shared these cards for trade, nearest first. TapToTrade listings are trades, so they have no asking price: the price shown is the market estimate, not the seller's.
      </p>
      <ErrorAlert error={state.error} title="Couldn't load listings" />
      {!listings && !state.error ? (
        <Spinner label="Looking for listings" />
      ) : (
        <>
          {withStock.length === 0 && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nobody has shared any of these cards for trade yet. Add them to your want list from the deck page to hear when someone does.</p>}
          <ul className="grid gap-3 md:grid-cols-2">
            {withStock.map((n) => (
              <li key={n} className="rounded-xl border bg-card p-3 text-sm shadow-xs">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{n}</span>
                  <span className="text-xs text-muted-foreground">market ≈ {byName.get(n)?.price != null ? cad(byName.get(n).price) : "no price"}</span>
                </div>
                <ul className="grid gap-1.5">
                  {listings[n].nearest.map((l) => (
                    <li key={l.itemId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link to={`/u/${l.owner.username}`} className="font-medium text-primary underline-offset-4 hover:underline">
                        {l.owner.username}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {l.owner.city}
                        {l.distanceKm != null && ` · ${l.distanceKm} km`}
                      </span>
                      <ConditionBadge condition={l.condition} />
                      <span className="text-xs text-muted-foreground">
                        {l.printing}
                        {l.finish !== "nonfoil" && ` · ${l.finish}`} · ×{l.quantity}
                      </span>
                      <Link to={`/trades/new${qs({ to: l.owner.username, item: l.itemId })}`} className="ml-auto text-xs font-medium text-primary underline-offset-4 hover:underline">
                        Propose a trade
                      </Link>
                    </li>
                  ))}
                </ul>
                {listings[n].total > listings[n].nearest.length && (
                  <Link to={`/search${qs({ name: n, sort: "distance" })}`} className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline">
                    See all {listings[n].total} listings
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {withStock.length > 0 && withStock.length < names.length && <p className="text-xs text-muted-foreground">No listings yet for {names.filter((n) => !listings?.[n]).slice(0, 12).join(", ")}{names.length - withStock.length > 12 ? "…" : ""}.</p>}
        </>
      )}
    </section>
  );
}

/** The same commander optimized independently at several budgets. */
function BudgetCompare({ data, rejected, original, current }) {
  const [rows, setRows] = useState(null);
  const run = () => {
    const tiers = [...new Set([...BUDGET_TIERS, current])].sort((a, b) => a - b);
    // Cheapest first, each tier also weighing the decks below it, so a bigger budget never shows a weaker build.
    const out = [];
    for (const budget of tiers) {
      const r = optimize({ pool: data.pool, combos: data.combos, commanders: data.commanderNames, original, budget, mode: "max", rejected, consider: out.map((o) => o.deck), strategy: data.strategy });
      out.push({ budget, deck: r.deck, rep: report({ pool: data.pool, combos: data.combos, commanders: data.commanderNames, deck: r.deck }) });
    }
    setRows(out);
  };
  useEffect(() => setRows(null), [data, rejected, original]);
  const byName = data.byName;
  // The cards the biggest budget plays that the smallest can't, best score per dollar first.
  const upgrades = rows
    ? rows
        .at(-1)
        .deck.filter((n) => !rows[0].deck.includes(n) && byName.get(n)?.price > 0)
        .map((n) => ({ n, perDollar: cardValue(byName.get(n)) / byName.get(n).price, price: byName.get(n).price }))
        .sort((a, b) => b.perDollar - a.perDollar)
        .slice(0, 8)
    : [];
  return (
    <section aria-labelledby="opt-compare" className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="opt-compare" className="text-lg font-bold">
            Compare budgets
          </h2>
          <p className="text-sm text-muted-foreground">Each column is its own Maximum-power build for the same commander.</p>
        </div>
        <Button variant="outline" size="sm" onClick={run}>
          {rows ? "Run again" : "Compare budgets"}
        </Button>
      </div>
      {rows && (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Metric</th>
                  {rows.map((r) => (
                    <th key={r.budget} className={cn("p-2 text-right", r.budget === current && "text-foreground")}>
                      {money(r.budget)}
                      {r.budget === current && " (now)"}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["Deck cost", (r) => cad(r.rep.cost.total)],
                  ["Competitive score", (r) => r.rep.scores.overall],
                  ["Speed", (r) => r.rep.scores.speed],
                  ["Consistency", (r) => r.rep.scores.consistency],
                  ["Interaction", (r) => r.rep.scores.interaction],
                  ["Fast mana / tutors", (r) => `${r.rep.counts.fastMana} / ${r.rep.counts.tutor}`],
                  ["Primary combo", (r) => r.rep.primary?.pieces.join(" + ") ?? "none"],
                  ["Score gained per CA$100 over the column before", (r, i) => (i === 0 ? "—" : (() => {
                    const spent = r.rep.cost.total - rows[i - 1].rep.cost.total;
                    return spent > 1 ? ((r.rep.scores.overall - rows[i - 1].rep.scores.overall) / (spent / 100)).toFixed(1) : "—";
                  })())],
                ].map(([label, cell]) => (
                  <tr key={label} className="border-b last:border-0">
                    <th scope="row" className="p-2 text-left font-medium">
                      {label}
                    </th>
                    {rows.map((r, i) => (
                      <td key={r.budget} className="p-2 text-right text-xs tabular-nums">
                        {cell(r, i)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {upgrades.length > 0 && (
            <div className="rounded-xl border bg-card p-3 text-sm shadow-xs">
              <p className="font-semibold">Best upgrades per dollar</p>
              <p className="mb-2 text-xs text-muted-foreground">Cards the {money(rows.at(-1).budget)} build plays that the {money(rows[0].budget)} build doesn't, by TapToTrade card score per dollar.</p>
              <ol className="grid gap-1 sm:grid-cols-2">
                {upgrades.map((u) => (
                  <li key={u.n} className="flex justify-between gap-2">
                    <span>{u.n}</span>
                    <span className="text-muted-foreground tabular-nums">{cad(u.price)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The optimizer's request for a saved deck: its commander(s) and main board. */
const fromDeck = (cards, deckId) => ({
  commanders: cards.filter((c) => c.board === "commander").map((c) => c.printing.name),
  text: cards
    .filter((c) => c.board === "main")
    .map((c) => `${c.quantity} ${c.printing.name}`)
    .join("\n"),
  deckId,
  deckCards: cards,
});

async function analyze(req) {
  const res = await api("/optimizer/analyze", { method: "POST", body: { commanders: req.commanders, text: req.text } });
  return { ...res, byName: new Map(res.pool.map((c) => [c.name, c])), commanderNames: res.commanders.map((c) => c.name) };
}

const LOADING = "Checking cards on Scryfall, EDHREC and Commander Spellbook. The first look at a commander can take half a minute.";

/** The deck page's Optimize tab: analyzes the deck as it is saved, and again after changes are applied. */
export function DeckOptimizer({ deck, cards, mine, onApplied }) {
  const req = fromDeck(cards, deck.id);
  const listKey = `${req.commanders.join("|")}\n${req.text}`;
  const [state, setState] = useState({ key: null, data: null, error: null });
  const [budget, setBudget] = useState(500);
  const [mode, setMode] = useState("preserve");
  const [notice, setNotice] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    analyze(req).then(
      (data) => live && setState({ key: listKey, data, error: null }),
      (error) => live && setState({ key: listKey, data: null, error }),
    );
    return () => {
      live = false;
    };
  }, [listKey, attempt]); // req is rebuilt from the same cards on every render
  if (state.key !== listKey) return <Spinner label={LOADING} />;
  if (state.error) return <ErrorAlert error={state.error} title="Couldn't analyze this deck" onRetry={() => setAttempt((n) => n + 1)} />;
  return (
    <Workspace
      data={state.data}
      request={req}
      savedDeck={mine ? deck : null}
      budget={budget}
      setBudget={setBudget}
      mode={mode}
      setMode={setMode}
      notice={notice}
      onApplied={(message) => {
        setNotice(message);
        onApplied();
      }}
    />
  );
}

/** Budget, goal, dashboard, swaps and the rest, for one analyzed deck. */
function Workspace({ data, request, savedDeck, budget, setBudget, mode, setMode, notice, onApplied, onChangeList }) {
  const [rejected, setRejected] = useState({ adds: [], keeps: [] });
  const [unchosen, setUnchosen] = useState(() => new Set());
  const [applyState, setApplyState] = useState(null);
  const [undo, setUndo] = useState(() => (savedDeck ? readJson(undoKey(savedDeck.id)) : null));

  // The slider moves freely; the 99 is rebuilt (right here in the browser, no server request) once it rests for 300 ms.
  // Each budget's result is kept per goal and rejections, so going back to a budget is instant, and every deck found
  // so far is weighed again: a budget that can afford a better deck found elsewhere uses it.
  const [settledBudget, setSettledBudget] = useState(budget);
  useEffect(() => {
    const t = setTimeout(() => setSettledBudget(budget), 300);
    return () => clearTimeout(t);
  }, [budget]);
  const results = useMemo(() => new Map(), [data, mode, rejected]); // a fresh cache per analysis, goal and rejections
  const result = useMemo(() => {
    const key = String(settledBudget);
    if (!results.has(key)) {
      const consider = [...results.values()].map((r) => r.deck);
      results.set(key, optimize({ pool: data.pool, combos: data.combos, commanders: data.commanderNames, original: data.original, budget: settledBudget, mode, rejected, consider, strategy: data.strategy }));
    }
    return results.get(key);
  }, [data, results, settledBudget, mode, rejected]);
  const before = useMemo(() => report({ pool: data.pool, combos: data.combos, commanders: data.commanderNames, deck: data.original }), [data]);
  const after = useMemo(() => report({ pool: data.pool, combos: data.combos, commanders: data.commanderNames, deck: result.deck }), [data, result]);
  const chosenChanges = result.changes.filter((c) => !unchosen.has(changeKey(c)));
  const picked = useMemo(() => report({ pool: data.pool, combos: data.combos, commanders: data.commanderNames, deck: applyChanges(data.original, chosenChanges), trials: 500 }), [data, result, unchosen]); // chosenChanges comes from these

  const ownDeck = Boolean(savedDeck);
  // A card already in the deck keeps its printing and finish (Moxfield's *F* / *E* marks).
  const mark = { foil: " *F*", etched: " *E*" };
  const cardText = (c) => `(${c.printing.setCode.toUpperCase()}) ${c.printing.collectorNumber}${mark[c.finish] ?? ""}`;
  const printingOf = (n) => {
    const card = request.deckCards?.find((c) => c.printing.name === n);
    if (card) return cardText(card);
    const p = data.byName.get(n);
    return p?.setCode ? `(${p.setCode.toUpperCase()}) ${p.collectorNumber}` : "";
  };
  // The sideboard and maybeboard ride along so replacing the deck's cards doesn't lose them.
  const otherBoards = (request.deckCards ?? [])
    .filter((c) => c.board === "side" || c.board === "maybe")
    .reduce((out, c) => ({ ...out, [c.board]: [...(out[c.board] ?? []), `${c.quantity} ${c.printing.name} ${cardText(c)}`] }), {});
  const extra = [otherBoards.side && ["", "Sideboard", ...otherBoards.side].join("\n"), otherBoards.maybe && ["", "Maybeboard", ...otherBoards.maybe].join("\n")].filter(Boolean).join("\n");
  const newList = applyChanges(data.original, chosenChanges);
  const newText = listText(data.commanderNames, newList, printingOf, extra);
  const originalText = listText(data.commanderNames, data.original, printingOf, extra);

  const reject = (c) => {
    setRejected((r) => ({ adds: c.add ? [...new Set([...r.adds, c.add])] : r.adds, keeps: c.remove ? [...new Set([...r.keeps, c.remove])] : r.keeps }));
  };
  const toggle = (key) =>
    setUnchosen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const setAll = (on) => setUnchosen(on ? new Set() : new Set(result.changes.map(changeKey)));

  const applyToDeck = async () => {
    setApplyState({ busy: true });
    try {
      // The deck as it is now, so Undo can put it back (kept in this browser).
      const snapshot = { text: originalText, at: new Date().toISOString(), name: savedDeck.name };
      await api(`/decks/${savedDeck.id}/import`, { method: "POST", body: { text: newText, replace: true } });
      writeJson(undoKey(savedDeck.id), snapshot);
      setUndo(snapshot);
      setApplyState(null);
      onApplied(`Applied ${chosenChanges.length} change${chosenChanges.length === 1 ? "" : "s"} to ${savedDeck.name}. "Undo the optimization" puts it back the way it was.`);
    } catch (err) {
      setApplyState({ error: err });
    }
  };
  const revertDeck = async () => {
    setApplyState({ busy: true });
    try {
      await api(`/decks/${savedDeck.id}/import`, { method: "POST", body: { text: undo.text, replace: true } });
      writeJson(undoKey(savedDeck.id), null);
      setUndo(null);
      setApplyState(null);
      onApplied(`${savedDeck.name} is back to how it was before the optimization.`);
    } catch (err) {
      setApplyState({ error: err });
    }
  };
  const saveAsNew = async () => {
    setApplyState({ busy: true });
    try {
      const { deck } = await api("/decks", { method: "POST", body: { name: `${data.commanderNames[0].split(",")[0]} optimized (${money(budget).replace(".00", "")})`.slice(0, 100), format: "commander", visibility: "private" } });
      await api(`/decks/${deck.id}/import`, { method: "POST", body: { text: newText, replace: true } });
      setApplyState({ done: "Saved as a new private deck.", link: `/decks/${deck.id}` });
    } catch (err) {
      setApplyState({ error: err });
    }
  };
  const commander = data.commanders;
  const added = chosenChanges.map((c) => c.add).filter((n) => n && !data.byName.get(n)?.basic);
  const apply = (compact) =>
    ownDeck ? (
      <Button size={compact ? "sm" : "default"} onClick={applyToDeck} disabled={!chosenChanges.length || applyState?.busy} className="gap-1.5">
        <Check aria-hidden="true" /> Apply {chosenChanges.length}
        {!compact && ` to ${savedDeck.name}`}
      </Button>
    ) : (
      <Button size={compact ? "sm" : "default"} onClick={saveAsNew} disabled={!chosenChanges.length || applyState?.busy} className="gap-1.5">
        {compact ? "Save as deck" : "Save as a new deck"} <ArrowRight aria-hidden="true" />
      </Button>
    );

  return (
    <div className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:pb-0">
      <div className="grid min-w-0 gap-8">
        {notice && <SuccessMessage>{notice}</SuccessMessage>}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-primary/40 bg-accent/40 p-3">
          <div className="flex gap-2">
            {commander.map((c) => (
              <CardImage key={c.name} name={c.name} imageUrl={c.imageUrl} printingId={c.printingId} className="w-16 sm:w-20" />
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Lock className="size-4" aria-hidden="true" /> Commander locked
            </p>
            <p className="font-bold break-words">{data.commanderNames.join(" and ")}</p>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ColourDots colors={data.identity} /> Budget and goal changes never replace it or change its colours.
            </p>
            {onChangeList && (
              <Button variant="outline" size="sm" className="mt-2" onClick={onChangeList}>
                Change commander or list
              </Button>
            )}
          </div>
        </div>
        {data.skipped.length > 0 && (
          <details className="rounded-xl border p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              {data.skipped.length} line{data.skipped.length === 1 ? "" : "s"} of your list skipped
            </summary>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {data.skipped.map((s) => (
                <li key={`${s.line}-${s.name}`}>
                  Line {s.line} · {s.name}: {s.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {data.original.length !== 99 && (
          <p className="text-sm text-muted-foreground">
            Your list has {data.original.length} cards in the 99{data.original.length < 99 ? "; the optimizer fills the rest" : "; the optimizer trims it to 99"}.
          </p>
        )}
        {result.notes.map((n) => (
          <p key={n} className="rounded-xl border border-warning/50 p-3 text-sm text-warning">
            {n}
          </p>
        ))}
        {settledBudget !== Infinity && mode === "max" && result.cost.total < settledBudget * 0.8 && (
          <p className="rounded-xl border p-3 text-sm text-muted-foreground">
            This build spends {cad(result.cost.total)} of the {cad(settledBudget)} budget: no pricier build scored higher on TapToTrade's score. The score doesn't model colour fixing or opponents' interaction, so pricier lands and fast mana can still be worth it.
          </p>
        )}

        <Dashboard before={before} after={after} budget={settledBudget} picked={picked} />

        <section aria-labelledby="opt-changes" className="grid gap-3">
          <h2 id="opt-changes" className="text-lg font-bold">
            Cut and add
          </h2>
          <Changes changes={result.changes} chosen={new Set(result.changes.map(changeKey).filter((k) => !unchosen.has(k)))} toggle={toggle} setAll={setAll} reject={reject} byName={data.byName} />
          {(rejected.adds.length > 0 || rejected.keeps.length > 0) && (
            <p className="text-xs text-muted-foreground">
              Rejected: {[...rejected.adds.map((n) => `never add ${n}`), ...rejected.keeps.map((n) => `keep ${n}`)].join(", ")}.{" "}
              <button type="button" className="font-medium text-primary underline-offset-4 hover:underline" onClick={() => setRejected({ adds: [], keeps: [] })}>
                Clear rejections
              </button>
            </p>
          )}
        </section>

        <Combos before={before} after={after} byName={data.byName} deck={result.deck} />
        <Odds before={before} after={after} />
        <Listings names={added} byName={data.byName} />
        <BudgetCompare data={data} rejected={rejected} original={data.original} current={settledBudget} />

        <section aria-labelledby="opt-lists" className="grid gap-3">
          <h2 id="opt-lists" className="text-lg font-bold">
            Original and new list
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Your list", originalText],
              ["With your selected changes", newText],
            ].map(([label, text]) => (
              <div key={label} className="min-w-0">
                <p className="mb-1 text-sm font-medium">{label}</p>
                <pre className="max-h-96 overflow-auto rounded-xl border bg-card p-3 text-xs leading-5">{text}</pre>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="opt-notes" className="text-xs text-muted-foreground">
          <h2 id="opt-notes" className="mb-2 text-sm font-semibold text-foreground">
            How the numbers are worked out
          </h2>
          <p className="mb-2">
            Scores are TapToTrade's own 0–100 indices, not win rates. Card choices come from the share of cEDH decks for this commander that play each card on{" "}
            <a href={data.sources.cedh ?? "https://edhrec.com"} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
              EDHREC
            </a>
            , combos from{" "}
            <a href={data.sources.spellbook} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
              Commander Spellbook
            </a>
            , and legality (Wizards' banned list), colour identity and prices from Scryfall. Prices are each card's cheapest printing at its TCGplayer market price, converted at the Bank of Canada rate of {data.rate.usdCad} USD/CAD ({data.rate.date}): estimates for reference, not
            TapToTrade listings.
          </p>
          <dl className="grid gap-1 sm:grid-cols-2">
            {SCORE_NOTES.map(([k, v]) => (
              <div key={k}>
                <dt className="inline font-medium text-foreground">{k}: </dt>
                <dd className="inline">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2">Roles: {Object.values(ROLES).join(", ")}.</p>
        </section>
      </div>

      <aside className="order-first grid gap-4 lg:sticky lg:top-24 lg:order-none" aria-label="Budget and actions">
        <BudgetControls budget={budget} setBudget={setBudget} mode={mode} setMode={setMode} commanderCost={commander.reduce((n, c) => n + (c.price ?? 0), 0)} strategy={data.strategy} />
        <Card className="gap-3 py-5">
          <CardHeader>
            <CardTitle className="flex items-baseline justify-between gap-2 text-base">
              <span>Optimized</span>
              <span className="tabular-nums">{cad(result.cost.total)}</span>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {result.changes.length} swap{result.changes.length === 1 ? "" : "s"} suggested, {chosenChanges.length} selected. Selected deck: {cad(picked.cost.total)}
              {settledBudget !== Infinity && picked.cost.total > settledBudget && <span className="text-warning"> (over budget: some unselected swaps saved money)</span>}.
            </p>
          </CardHeader>
          <CardContent className="grid gap-2">
            {apply(false)}
            {ownDeck && (
              <Button variant="outline" onClick={saveAsNew} disabled={!chosenChanges.length || applyState?.busy} className="gap-1.5">
                Save as a new deck <ArrowRight aria-hidden="true" />
              </Button>
            )}
            <Button variant="outline" onClick={() => setAll(false)} disabled={!chosenChanges.length} className="gap-1.5">
              <RotateCcw aria-hidden="true" /> Revert to my list
            </Button>
            {ownDeck && undo && (
              <Button variant="outline" onClick={revertDeck} disabled={applyState?.busy} className="gap-1.5 text-destructive">
                <RotateCcw aria-hidden="true" /> Undo the optimization
              </Button>
            )}
            {applyState?.done && (
              <SuccessMessage>
                {applyState.done}{" "}
                <Link to={applyState.link} className="underline">
                  Open the deck
                </Link>
              </SuccessMessage>
            )}
            {applyState?.error && <p className="text-sm font-medium text-destructive">{applyState.error.message}</p>}
            {ownDeck && undo && <p className="text-xs text-muted-foreground">Undo puts back the list from {new Date(undo.at).toLocaleString("en-CA")}. It's remembered in this browser.</p>}
          </CardContent>
        </Card>
        {settledBudget !== budget && (
          <p className="text-xs text-muted-foreground" role="status">
            Rebuilding for {money(budget)}…
          </p>
        )}
      </aside>

      {/* Phones: the cost and the apply button stay in reach while scrolling through the swaps. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="min-w-0 flex-1 text-xs">
          <p className="font-semibold tabular-nums">
            {cad(picked.cost.total)} <span className="font-normal text-muted-foreground">of {money(settledBudget)}</span>
          </p>
          <p className="text-muted-foreground">
            {chosenChanges.length} of {result.changes.length} swaps
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => document.getElementById("opt-budget-range")?.scrollIntoView({ behavior: "smooth", block: "center" })}>
          Budget
        </Button>
        {apply(true)}
      </div>
    </div>
  );
}

/** /optimizer: paste a list for any commander. A saved deck opens in its own page's Optimize tab. */
export default function Optimizer() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [initial] = useState(() => readJson(DRAFT_KEY) ?? {});
  const [request, setRequest] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(500);
  const [mode, setMode] = useState("preserve");

  // Old links (/optimizer?deck=42) open the deck's Optimize tab.
  const deckParam = params.get("deck");
  if (deckParam) return <Navigate to={`/decks/${deckParam}?tab=optimize`} replace />;

  const run = async (req) => {
    if (req.deckId) return navigate(`/decks/${req.deckId}?tab=optimize`);
    setBusy(true);
    setError(null);
    try {
      setData(await analyze(req));
      setRequest(req);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <PageHeader title="Commander deck optimizer" description="Your commander stays locked. Set a budget in Canadian dollars and the 99 is rebuilt around it, with exact draw odds and real TapToTrade listings for the cards it adds." />
      {data ? (
        <Workspace data={data} request={request} savedDeck={null} budget={budget} setBudget={setBudget} mode={mode} setMode={setMode} onChangeList={() => setData(null)} />
      ) : (
        <div className="mx-auto max-w-5xl">
          <ErrorAlert error={error} title="Couldn't analyze that deck" />
          <div className="mt-4">
            <Setup initial={initial} onAnalyze={run} busy={busy} />
          </div>
          {busy && (
            <div className="mt-6">
              <Spinner label={LOADING} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
