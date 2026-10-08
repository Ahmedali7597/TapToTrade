import { useEffect, useRef, useState } from "react";
import { motionReduced } from "@/lib/display";

// Scroll-driven hero: the Blender card-sort film is played frame by frame as the user scrolls.
// Frames: client/public/hero/frames/frame_001.webp … frame_150.webp (every 2nd frame of the 300-frame
// render, 1280 px wide). Regenerate them with the ffmpeg command in the README ("Hero frames").
export const FRAME_COUNT = 150;
export const frameSrc = (index) => `/hero/frames/frame_${String(index + 1).padStart(3, "0")}.webp`;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** 0 when the section's top reaches the viewport top, 1 when its bottom reaches the viewport bottom. */
export function progressFor(sectionTop, sectionHeight, viewportHeight) {
  const scrollable = sectionHeight - viewportHeight;
  return scrollable <= 0 ? 1 : clamp(-sectionTop / scrollable, 0, 1);
}

// Maps 0..1 progress to a frame index, never going past the last frame.
export const frameFor = (progress, count = FRAME_COUNT) => clamp(Math.floor(progress * count), 0, count - 1);

/** Draws an image like CSS object-fit: cover. */
export function drawCover(ctx, img, width, height) {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
}

// True when the device or the site's Reduce motion switch asks for less motion. Also follows either one
// changing while the page is open.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(motionReduced);
  useEffect(() => {
    const onChange = () => setReduced(motionReduced());
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    mq?.addEventListener("change", onChange);
    window.addEventListener("ttt:display", onChange);
    return () => {
      mq?.removeEventListener("change", onChange);
      window.removeEventListener("ttt:display", onChange);
    };
  }, []);
  return reduced;
}

/**
 * `captions`: [{ from, to, content }] shown while progress is inside [from, to).
 * `finale`: content revealed at the end (and shown immediately for reduced-motion users).
 * `hint`: a "scroll down" nudge under the intro. Left out for reduced motion, where there's nothing to scroll through.
 */
export default function ScrollHero({ captions = [], finale, intro, hint }) {
  const sectionRef = useRef(null);
  const canvasRef = useRef(null);
  const [progress, setProgress] = useState(0);
  const reduced = usePrefersReducedMotion();

  // Sets up the canvas, preloads every frame and redraws on scroll. Skipped entirely for reduced motion.
  useEffect(() => {
    if (reduced) return;
    const section = sectionRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const images = [];
    let shown = -1;
    let wanted = 0;
    let raf = 0;

    // Draw the wanted frame, or the nearest earlier frame that has finished loading.
    const paint = () => {
      for (let i = wanted; i >= 0; i--) {
        const img = images[i];
        if (img?.complete && img.naturalWidth) {
          if (i !== shown) {
            drawCover(ctx, img, canvas.width, canvas.height);
            shown = i;
          }
          return;
        }
      }
    };

    // Work out how far through the section we are and paint the matching frame.
    const update = () => {
      raf = 0;
      const rect = section.getBoundingClientRect();
      const p = progressFor(rect.top, rect.height, window.innerHeight);
      setProgress(p);
      wanted = frameFor(p);
      paint();
    };
    // Scroll can fire many times per frame; only schedule one update per animation frame.
    const onScroll = () => {
      raf ||= requestAnimationFrame(update);
    };
    // Match the canvas to its on-screen size (capped at 2x for high-DPI screens) so frames stay sharp.
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      shown = -1;
      update();
    };

    // Start loading all frames now. When one arrives that we're waiting on, paint it.
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => i <= wanted && i > shown && paint();
      img.src = frameSrc(i);
      images.push(img);
    }

    resize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
      for (const img of images) img.onload = null;
    };
  }, [reduced]);

  if (reduced) {
    // No scroll-jacking: a single still of the finished sort with the full message.
    return (
      <section aria-label="Introduction" className="relative flex min-h-[85svh] items-end overflow-hidden">
        <img src={frameSrc(FRAME_COUNT - 1)} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-8 px-4 pt-24 pb-16 sm:px-6">
          {intro}
          {finale}
        </div>
      </section>
    );
  }

  // The call-to-action fades in for the last fifth of the scroll. The section is 4.2 screens tall
  // and the inner div sticks to the top, so the film "plays" while you scroll through it.
  const finaleVisible = progress > 0.8;
  return (
    <section ref={sectionRef} aria-label="Introduction" className="relative h-[420svh]" data-testid="scroll-hero">
      <div className="sticky top-0 h-svh overflow-hidden">
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 size-full bg-[#9fb5ad]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/45" />

        <div className="relative mx-auto flex h-full max-w-6xl flex-col px-4 sm:px-6">
          <div
            className="pt-16 transition-opacity duration-500 sm:pt-24"
            style={{ opacity: progress < 0.06 ? 1 : 0 }}
            aria-hidden={progress >= 0.06}
          >
            {intro}
            {hint}
          </div>

          {/* Each caption only shows during its slice of the scroll. */}
          {captions.map((c, i) => {
            const on = progress >= c.from && progress < c.to;
            return (
              <div
                key={i}
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-4 bottom-24 transition-all duration-500 sm:inset-x-6"
                style={{ opacity: on ? 1 : 0, transform: `translateY(${on ? 0 : 16}px)` }}
              >
                {c.content}
              </div>
            );
          })}

          <div
            className={`absolute inset-x-4 bottom-16 transition-all duration-700 sm:inset-x-6 ${finaleVisible ? "" : "pointer-events-none"}`}
            style={{ opacity: finaleVisible ? 1 : 0, transform: `translateY(${finaleVisible ? 0 : 24}px)` }}
            inert={!finaleVisible}
          >
            {finale}
          </div>
        </div>

        {/* Thin progress bar along the bottom. */}
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20" aria-hidden="true">
          <div className="h-full origin-left bg-primary" style={{ transform: `scaleX(${progress})` }} />
        </div>
      </div>
    </section>
  );
}
