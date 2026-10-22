import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CardImage } from "@/components/common";
import { binderPages } from "@/lib/collection";
import { motionReduced } from "@/lib/display";
import { cn } from "@/lib/utils";

// The collection as a 9-pocket trade binder you flip through. Two pages side by side on wide screens, one on
// phones. A turning sheet is cut into thin vertical strips, each hinged to the one before it, so it curls as it
// turns: the free edge leads and the sheet flattens again as it lands, like a plastic binder page. Drag or swipe a
// page to turn it by hand, or use the arrow buttons and the arrow keys. Reduced motion turns pages instantly.

const STRIPS = 12;
const DURATION = 800; // ms for a whole turn
const BEND = 70; // degrees of curl across the sheet at mid-turn
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** One binder page: 9 pockets. `still` pages (inside a turning sheet) skip the zoom buttons. */
function Sheet({ page, siblings, still = false, side }) {
  return (
    <div className={cn("binder-sheet", side === "left" ? "binder-sheet--left" : "binder-sheet--right")}>
      {page?.label && <span className="binder-tab">{page.label}</span>}
      <div className="grid grid-cols-3 gap-[3cqw]">
        {Array.from({ length: 9 }, (_, n) => {
          const item = page?.items[n];
          return (
            <div key={item?.id ?? `empty-${n}`} className="binder-pocket">
              {item && (
                <>
                  <CardImage
                    name={item.printing.name}
                    setCode={item.printing.setCode}
                    imageUrl={item.printing.imageUrl}
                    finish={item.finish}
                    printingId={still ? undefined : item.printing.id}
                    siblings={siblings}
                    decorative={still}
                    tabIndex={still ? -1 : undefined}
                    instant
                    className="w-full"
                  />
                  {item.quantity > 1 && <span className="binder-count">×{item.quantity}</span>}
                  {!item.available && (
                    <span className="binder-private" title="Private">
                      <EyeOff className="size-3" aria-hidden="true" />
                      <span className="sr-only">Private</span>
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The turning sheet: STRIPS nested hinges, each showing its slice of the front page and of the back page. */
function TurningSheet({ front, back, w, h, strips, shades }) {
  const s = w / STRIPS;
  const face = (page, x0, i, isBack) => (
    <div
      className="absolute inset-y-0 left-0 overflow-hidden"
      style={{ width: s + 0.75, backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden", transform: isBack ? "rotateY(180deg)" : undefined }}
    >
      <div className="absolute top-0" style={{ left: -x0, width: w, height: h }}>
        <Sheet page={page} still side={isBack ? "left" : "right"} />
      </div>
      <div
        ref={(el) => (shades.current[i * 2 + (isBack ? 1 : 0)] = el)}
        className="pointer-events-none absolute inset-0"
        style={{ background: "rgb(0 0 0)", opacity: 0 }}
      />
    </div>
  );
  let node = null;
  for (let i = STRIPS - 1; i >= 0; i--) {
    node = (
      <div
        ref={(el) => (strips.current[i] = el)}
        className="absolute top-0"
        style={{ left: i ? s : 0, width: s, height: h, transformOrigin: "left center", transformStyle: "preserve-3d" }}
      >
        {face(front, i * s, i, false)}
        {face(back, w - (i + 1) * s, i, true)}
        {node}
      </div>
    );
  }
  return node;
}

export default function BinderView({ groups, siblings }) {
  // Page tabs name the group (Creatures, Lands...) when the collection is grouped.
  const pages = binderPages(groups).map((p) => (groups.length > 1 ? p : { ...p, label: null }));
  const stage = useRef(null);
  const pageBox = useRef(null);
  const [size, setSize] = useState({ stage: 0, w: 0, h: 0 });
  const spread = size.stage >= 640;
  const per = spread ? 2 : 1;
  const [at, setAt] = useState(0);
  const last = Math.max(0, pages.length - 1);
  const first = Math.min(spread ? at - (at % 2) : at, spread ? last - (last % 2) : last);
  // While a sheet turns: { base } is the page on the sheet's front side (spread: the page left of it).
  const [flip, setFlip] = useState(null);
  const strips = useRef([]);
  const shades = useRef([]);
  const cast = useRef(null);
  const raf = useRef(0);
  const drag = useRef(null);
  const dragged = useRef(false);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => {
      const box = pageBox.current?.getBoundingClientRect();
      // The room around the binder decides one page or two (the binder's own width depends on that choice).
      setSize({ stage: stage.current?.parentElement.clientWidth ?? 0, w: box?.width ?? 0, h: box?.height ?? 0 });
    });
    if (stage.current) ro.observe(stage.current.parentElement);
    if (pageBox.current) ro.observe(pageBox.current);
    return () => ro.disconnect();
    // The page box is a different element in the one- and two-page layouts, so watch the new one.
  }, [spread]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // Switching between one and two pages mid-turn (the window was resized) drops the turn: its pages no longer fit.
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    drag.current = null;
    setFlip(null);
  }, [spread]);

  // Load and decode the pages either side of the open ones, so a page turned to is already painted.
  const nearby = pages.slice(Math.max(0, first - 2 * per), first + 3 * per);
  const nearbyKey = nearby.flatMap((p) => p.items.map((i) => i.printing.imageUrl)).join("|");
  useEffect(() => {
    for (const src of nearbyKey.split("|")) {
      if (!src) continue;
      const img = new Image();
      img.src = src;
      img.decode?.().catch(() => {});
    }
  }, [nearbyKey]);

  const canNext = first + per < pages.length;
  const canPrev = first > 0;

  // Pose the turning sheet at t (0 = flat on the right, 1 = turned over onto the left).
  const pose = (t) => {
    const turn = 180 * t;
    const bend = BEND * Math.sin(Math.PI * t);
    let total = 0;
    strips.current.forEach((el, i) => {
      if (!el) return;
      const a = i === 0 ? -(turn - bend / 2) : -bend / (STRIPS - 1);
      total += a;
      el.style.transform = `rotateY(${a}deg)`;
      // A strip turned edge-on to the light is darker; an even tint per strip keeps the curve smooth.
      const shade = String(Math.abs(Math.sin((total * Math.PI) / 180)) * 0.38);
      if (shades.current[i * 2]) shades.current[i * 2].style.opacity = shade;
      if (shades.current[i * 2 + 1]) shades.current[i * 2 + 1].style.opacity = shade;
    });
    if (cast.current) cast.current.style.opacity = String(Math.sin(Math.PI * t) * 0.8);
  };

  // When a turn ends, the pages underneath switch to their new cards while the landed sheet (showing the same
  // cards) stays on top for two more frames, so there's never a frame of empty pockets between them.
  const finish = (base, t) => {
    setAt(t >= 1 ? base + per : base);
    setFlip((f) => f && { ...f, done: true });
    raf.current = requestAnimationFrame(() => (raf.current = requestAnimationFrame(() => setFlip(null))));
  };
  const animate = (base, from, to) => {
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    const length = DURATION * Math.max(0.25, Math.abs(to - from));
    const step = (now) => {
      const k = Math.min(1, (now - start) / length);
      pose(from + (to - from) * ease(k));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else finish(base, to);
    };
    raf.current = requestAnimationFrame(step);
  };

  // Spread: turning forward lifts the right page (base = the left page); turning back is the same sheet in reverse.
  const baseFor = (dir) => (dir === "next" ? first : first - per);
  const go = (dir) => {
    if (flip || (dir === "next" ? !canNext : !canPrev)) return;
    if (motionReduced() || !size.w) return setAt(dir === "next" ? first + per : first - per);
    setFlip({ base: baseFor(dir), from: dir === "next" ? 0 : 1, to: dir === "next" ? 1 : 0 });
  };
  useLayoutEffect(() => {
    if (!flip || flip.done) return;
    pose(flip.from);
    if (flip.to !== undefined) animate(flip.base, flip.from, flip.to);
    // pose and animate only touch refs; re-running them on every render isn't wanted.
  }, [flip]);

  // Turning a page by hand: once the pointer has moved sideways, the sheet follows it; letting go finishes or
  // drops the turn depending on how far it got. A tap still zooms in on the card under it.
  const onPointerDown = (e) => {
    dragged.current = false;
    if (flip || e.button > 0) return;
    drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, dir: null, t: 0 };
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (!d.dir) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(e.clientY - d.y)) return;
      d.dir = dx < 0 ? "next" : "prev";
      if ((d.dir === "next" ? !canNext : !canPrev) || motionReduced()) return (drag.current = null);
      dragged.current = true;
      stage.current?.setPointerCapture(e.pointerId);
      setFlip({ base: baseFor(d.dir), from: d.dir === "next" ? 0 : 1 });
    }
    const span = size.w * (spread ? 1.6 : 1.2);
    d.t = Math.min(1, Math.max(0, d.dir === "next" ? -dx / span : 1 - dx / span));
    pose(d.t);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.dir) return;
    const to = d.dir === "next" ? (d.t > 0.25 ? 1 : 0) : d.t < 0.75 ? 0 : 1;
    animate(baseFor(d.dir), d.t, to);
  };

  const shown = flip && !flip.done
    ? spread
      ? [pages[flip.base], pages[flip.base + 3]]
      : [pages[flip.base + 1]]
    : spread
      ? [pages[first], pages[first + 1]]
      : [pages[first]];
  const sheetFront = flip && pages[spread ? flip.base + 1 : flip.base];
  const sheetBack = flip && (spread ? pages[flip.base + 2] : null);
  // The 3D depth grows with the page (perspective = 8 page widths), so a lifted edge stays close to the binder.
  const label = pages.length
    ? spread && first + 1 < pages.length
      ? `Pages ${first + 1}–${first + 2} of ${pages.length}`
      : `Page ${first + 1} of ${pages.length}`
    : "No pages";

  return (
    <div className="grid gap-4">
      <div
        ref={stage}
        role="region"
        aria-roledescription="binder"
        aria-label={`Binder, ${label}. Use the left and right arrow keys to turn pages.`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go("next");
          else if (e.key === "ArrowLeft") go("prev");
          else return;
          e.preventDefault();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragStart={(e) => e.preventDefault()} // card images would otherwise start a browser drag and cancel the turn
        onClickCapture={(e) => {
          if (!dragged.current) return;
          dragged.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        className="binder mx-auto w-full touch-pan-y select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        // Two pages fill the width of the toolbar above; a single page (phones) is capped so it isn't stretched.
        style={{ maxWidth: spread ? "100%" : "min(100%, 30rem)" }}
      >
        <div className={cn("relative grid", spread ? "grid-cols-[1fr_auto_1fr]" : "grid-cols-[auto_1fr] overflow-hidden")} style={{ perspective: `${Math.max(1800, size.w * 8)}px` }}>
          {spread ? (
            <>
              <Sheet page={shown[0]} siblings={siblings} side="left" />
              <div className="binder-spine" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div ref={pageBox} className="relative">
                <Sheet page={shown[1]} siblings={siblings} side="right" />
                <div ref={cast} className="binder-cast" style={{ opacity: 0 }} />
              </div>
            </>
          ) : (
            <>
              <div className="binder-spine binder-spine--edge" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div ref={pageBox} className="relative">
                <Sheet page={shown[0]} siblings={siblings} side="right" />
                <div ref={cast} className="binder-cast" style={{ opacity: 0 }} />
              </div>
            </>
          )}
          {flip && size.w > 0 && (
            <div
              className="pointer-events-none absolute top-0 right-0"
              style={{ width: size.w, height: size.h, transformStyle: "preserve-3d", transform: "translateZ(1px)" }}
              aria-hidden="true"
            >
              <TurningSheet front={sheetFront} back={sheetBack} w={size.w} h={size.h} strips={strips} shades={shades} />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <div className="flex items-center gap-2 sm:gap-3">
          <Button variant="outline" size="icon" onClick={() => go("prev")} disabled={!canPrev || Boolean(flip)} aria-label="Previous page">
            <ChevronLeft aria-hidden="true" />
          </Button>
          <p className="min-w-0 text-center text-sm font-medium whitespace-nowrap tabular-nums sm:min-w-36" aria-live="polite">
            {label}
          </p>
          <Button variant="outline" size="icon" onClick={() => go("next")} disabled={!canNext || Boolean(flip)} aria-label="Next page">
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
        {pages.length > per * 2 && (
          <label className="flex w-full max-w-xs items-center gap-2 text-sm text-muted-foreground sm:w-auto">
            <span className="shrink-0">Jump to page</span>
            <input
              type="range"
              min={0}
              max={last}
              step={per}
              value={first}
              onChange={(e) => !flip && setAt(Number(e.target.value))}
              className="w-full min-w-0 accent-primary sm:w-32"
            />
          </label>
        )}
      </div>
    </div>
  );
}
