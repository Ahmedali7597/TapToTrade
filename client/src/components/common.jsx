import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { BadgeCheck, Loader2, Star } from "lucide-react";
import { motion } from "motion/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "@/lib/api";
import { motionReduced } from "@/lib/display";
import { cn } from "@/lib/utils";
import { CONDITION_LABELS, FINISH_LABELS, FINISHES } from "@shared/validation";

/** Loads GET /api{path}; returns { data, error, loading, reload }. Pass null to skip. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: path != null });
  // Bumping nonce re-runs the effect, which is how reload() works.
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (path == null) return;
    // Ignore late replies after the path changed or the component unmounted.
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path).then(
      (data) => live && setState({ data, error: null, loading: false }),
      (error) => live && setState({ data: null, error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [path, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

// Centered loading indicator. role="status" makes screen readers announce it.
export function Spinner({ label = "Loading" }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

// Page title and description, with room on the right for action buttons.
export function PageHeader({ title, description, children }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-border/80 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {description && <p className="mt-2 max-w-[65ch] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Full-page state for permission-denied, missing and service errors (mockup 5 direction). */
export function PageMessage({ title, body, action, code }) {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      {/* An optional big status number above the heading, e.g. 404. Screen readers get it from the heading instead. */}
      {code && (
        <p className="font-display text-7xl font-bold tracking-tight text-primary" aria-hidden="true">
          {code}
        </p>
      )}
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-muted-foreground">{body}</p>
      <div className="mt-6 flex justify-center gap-3">
        {action}
        <Button asChild variant="outline">
          <Link to="/">Home</Link>
        </Button>
      </div>
    </div>
  );
}

/** Shakes an element side to side, the "no" of a failed Face ID. Does nothing for reduced-motion users. */
export function shake(el) {
  if (!el?.animate || motionReduced()) return;
  el.animate(
    [0, -9, 8, -6, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
    { duration: 480, easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)" },
  );
}

// Face ID style marks: a circle that draws itself, then a check (success) or an X (failure). See index.css.
export function SuccessMark({ className }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={cn("mark size-6 shrink-0 text-success", className)} aria-hidden="true">
      <circle cx="14" cy="14" r="12" />
      <path d="M8.6 14.6l3.6 3.6 7.2-7.6" />
    </svg>
  );
}
function FailMark({ className }) {
  return (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className={cn("mark size-6 shrink-0 text-destructive", className)} aria-hidden="true">
      <circle cx="14" cy="14" r="12" />
      <path d="M10 10l8 8M18 10l-8 8" />
    </svg>
  );
}

/** A success message with the drawn green check. role="status" so screen readers announce it. */
export function SuccessMessage({ children, className }) {
  return (
    <p role="status" className={cn("flex items-center gap-2 text-sm font-medium text-success", className)}>
      <SuccessMark className="size-5" />
      <span>{children}</span>
    </p>
  );
}

// Red alert box for a failed request. Renders nothing when there's no error, so pages can always include it.
// Every new error redraws the X and shakes the box, so a second failed try is as noticeable as the first.
export function ErrorAlert({ error, title = "That didn't work", onRetry }) {
  const box = useRef(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!error) return;
    setAttempt((n) => n + 1);
    shake(box.current);
  }, [error]);
  if (!error) return null;
  return (
    <Alert ref={box} variant="destructive" className="mb-6 has-[>svg]:grid-cols-[1.25rem_1fr] [&>svg]:size-5 [&>svg]:translate-y-0">
      <FailMark key={attempt} />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{error.message ?? String(error)}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

// An empty binder pocket: a dashed card outline waiting to be filled, with optional buttons underneath.
export function EmptyState({ title, body, children }) {
  return (
    <div className="pocket flex flex-col items-center px-6 pt-10 pb-12 text-center">
      <div className="mb-4 aspect-[63/88] w-12 rounded-[4.5%/3.25%] border-2 border-dashed border-pocket-edge" aria-hidden="true" />
      <p className="font-display text-lg font-semibold">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{body}</p>}
      {children && <div className="mt-4 flex justify-center gap-2">{children}</div>}
    </div>
  );
}

/** Labelled input with an associated error message (AC-03). */
export function Field({ id, label, error, hint, className, children, ...inputProps }) {
  // Link the input to its hint and error so screen readers read them out with the label.
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children ?? <Input id={id} aria-invalid={!!error} aria-describedby={describedBy} {...inputProps} />}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * A row of toggle buttons for switching a view or filter (List / Map, Pending / Reviewed). Real tabs need
 * tab panels; these just change what the page shows, so they are buttons with aria-pressed.
 * Styled like the binder tabs in ui/tabs.jsx.
 */
export function SegmentedControl({ label, value, onChange, options, className }) {
  // Unique per control, so two controls on one page each slide their own pill.
  const pill = useId();
  return (
    <div role="group" aria-label={label} className={cn("inline-flex w-fit items-center gap-0.5 rounded-lg bg-pocket p-1 shadow-[inset_0_0_0_1px_var(--pocket-edge)]", className)}>
      {options.map(({ value: v, label: text, icon: Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "relative inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            value === v && "text-foreground",
          )}
        >
          {/* The selected background is one shared element that springs to whichever option is chosen. */}
          {value === v && (
            <motion.span
              layoutId={pill}
              transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
              className="absolute inset-0 rounded-md bg-card shadow-[0_1px_2px_rgb(var(--shadow)/0.12),inset_0_-2px_0_var(--primary)]"
            />
          )}
          <span className="relative inline-flex items-center gap-1.5">
            {Icon && <Icon className="size-4" aria-hidden="true" />}
            {text}
          </span>
        </button>
      ))}
    </div>
  );
}

// Badge colours for each trade status, borrowed from card rarity: pending is gold (rare), countered is
// silver-blue (uncommon), accepted is the brand teal and declined fades to the page.
const STATUS_STYLES = {
  pending: "bg-rare text-rare-ink border-rare-ink/25",
  accepted: "bg-accent text-accent-foreground border-primary/30",
  declined: "bg-muted text-muted-foreground border-border",
  countered: "bg-uncommon text-uncommon-ink border-uncommon-ink/25",
};
const STATUS_LABELS = { pending: "Pending", accepted: "Offer accepted", declined: "Declined", countered: "Countered" };

export function StatusBadge({ status }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

// Short code like "NM", with the full name as a tooltip.
export function ConditionBadge({ condition }) {
  return (
    <Badge variant="secondary" title={CONDITION_LABELS[condition]}>
      {condition}
    </Badge>
  );
}

/**
 * Finish dropdown (non-foil, foil, etched) limited to the finishes a printing was made in. With `anyLabel` it
 * starts with an "any finish" choice (value "any"), as on the want list; without one it's disabled when the
 * printing only comes in one finish, since there's nothing to choose.
 */
export function FinishSelect({ id, value, onChange, finishes = FINISHES, anyLabel, className }) {
  return (
    <NativeSelect id={id} value={value ?? "any"} onChange={onChange} disabled={!anyLabel && finishes.length < 2} className={cn("w-full", className)}>
      {anyLabel && <NativeSelectOption value="any">{anyLabel}</NativeSelectOption>}
      {finishes.map((f) => (
        <NativeSelectOption key={f} value={f}>
          {FINISH_LABELS[f]}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

// Foil or etched tag. Non-foil is the normal case, so it gets no badge (older snapshots have no finish at all).
export function FinishBadge({ finish }) {
  if (!finish || finish === "nonfoil") return null;
  return (
    <Badge variant="outline" className="border-transparent bg-mythic text-mythic-ink">
      {FINISH_LABELS[finish]}
    </Badge>
  );
}

/**
 * A player's trading record from other players' feedback: stars and completed trades, or "New trader".
 * `compact` drops the words for tight spots like a listing card.
 */
export function Reputation({ reputation, compact = false, className }) {
  if (!reputation) return null;
  const { completedTrades, rating } = reputation;
  if (!completedTrades) {
    return compact ? null : <span className={cn("text-sm text-muted-foreground", className)}>New trader, no completed trades yet</span>;
  }
  const trades = `${completedTrades} completed trade${completedTrades === 1 ? "" : "s"}`;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm text-muted-foreground", className)} title={`Rated ${rating} out of 5 · ${trades}`}>
      <Star className="size-3.5 fill-rare-ink text-rare-ink" aria-hidden="true" />
      <span className="sr-only">Rated </span>
      <strong className="text-foreground">{rating.toFixed(1)}</strong>
      <span className="sr-only"> out of 5,</span>
      {compact ? (
        <>
          <span aria-hidden="true">({completedTrades})</span>
          <span className="sr-only">{trades}</span>
        </>
      ) : (
        <span>· {trades}</span>
      )}
    </span>
  );
}

/**
 * An <img> that tries again when a download fails (a dropped connection, a CDN hiccup): twice, a moment apart,
 * then it calls onGiveUp. It fades in once loaded, so a half-loaded or retrying image never shows a broken icon.
 * Callers key it by src, so a new picture starts fresh.
 */
export function RetryImage({ src, onGiveUp, className, ...props }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const retry = () => (attempt < 2 ? setTimeout(() => setAttempt((n) => n + 1), 500 * (attempt + 1)) : onGiveUp?.());
  // A throwaway query parameter makes the browser fetch the image again instead of reusing the failure.
  const url = attempt ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;
  return (
    <img
      src={url}
      onError={retry}
      onLoad={() => setLoaded(true)}
      className={cn("transition-opacity duration-500 ease-out", !loaded && "opacity-0", className)}
      {...props}
    />
  );
}

// Opens the zoomed-in card view: open(printingId, siblingIds). Provided by CardDetails.jsx inside the layout.
export const CardViewerContext = createContext(null);
const useCardViewer = () => useContext(CardViewerContext);

/**
 * Card image in a clear sleeve, with descriptive alt text (AC-05); falls back to a tile with the card's name.
 * Foil and etched printings get a rainbow (or silver-gold) film, like Moxfield. Hovering a parent `.group` sweeps the sheen.
 * With a printingId (and a card viewer on the page) it's a button that zooms into the card's details;
 * `siblings` are the other printing ids on screen, for the viewer's Previous and Next.
 * `onGiveUp` replaces the name tile, e.g. to swap in a different showcase card.
 * `tabIndex={-1}` keeps a visual repeat (a marquee copy) clickable but out of the keyboard's tab order.
 */
export function CardImage({ name, setCode, imageUrl, finish, className, printingId, siblings, onGiveUp, decorative = false, tabIndex }) {
  const viewer = useCardViewer();
  const [broken, setBroken] = useState(false);
  const alt = decorative ? "" : `${name}${setCode ? ` (${setCode.toUpperCase()})` : ""} card image`;
  const zoom = printingId && viewer;
  const sleeve = cn("sleeve aspect-[488/680] bg-muted", finish === "foil" && "sleeve--foil", finish === "etched" && "sleeve--etched", zoom ? "w-full" : className);
  const art =
    imageUrl && !broken ? (
      <div className={sleeve}>
        <RetryImage key={imageUrl} src={imageUrl} alt={zoom ? "" : alt} loading="lazy" onGiveUp={onGiveUp ?? (() => setBroken(true))} className="size-full object-cover" />
      </div>
    ) : (
      <div role={zoom || decorative ? undefined : "img"} aria-label={zoom || decorative ? undefined : alt} className={cn(sleeve, "flex items-center justify-center p-2 text-center text-xs text-muted-foreground")}>
        {name}
      </div>
    );
  if (!zoom) return art;
  return (
    <button
      type="button"
      tabIndex={tabIndex}
      onClick={() => viewer(printingId, siblings)}
      aria-label={`Zoom in on ${name}${setCode ? ` (${setCode.toUpperCase()})` : ""}`}
      className={cn("block cursor-zoom-in rounded-[4.5%/3.25%] transition-transform duration-200 active:scale-[0.97]", className)}
    >
      {art}
    </button>
  );
}

// e.g. "LEA #161", the set code and collector number that identify a printing.
export const printingLabel = (p) => `${p.setCode?.toUpperCase()} #${p.collectorNumber}`;

/** "Official store account" badge beside a player's name, linking to the store's page. */
export function StoreBadge({ store, className }) {
  if (!store) return null;
  return (
    <Badge asChild variant="outline" className={cn("max-w-full gap-1 border-primary/30 text-primary", className)}>
      <Link to={store.path} title={`Official account of ${store.name}`}>
        <BadgeCheck aria-hidden="true" /> <span className="truncate">{store.name}</span>
      </Link>
    </Badge>
  );
}
