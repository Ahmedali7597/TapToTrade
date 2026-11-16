import { useEffect, useState } from "react";

// The display and accessibility choices /theme-init.js keeps (text size, motion, contrast, link underlines),
// plus the theme. theme-init applies them to <html> before the page paints; this hook lets React show and
// change them. Every change fires a "ttt:display" event on window.

// Keep in step with DEFAULTS in client/public/theme-init.js, which can't import this (it runs before the app loads).
const DEFAULTS = { text: "default", motion: "device", contrast: "default", links: "default" };
const read = () => ({ ...DEFAULTS, ...window.tttDisplay?.get(), theme: window.tttTheme?.get() ?? "system" });

/** [choices, set(key, value)]. `theme` is "system" | "light" | "dark"; the rest are described in DisplayMenu.jsx (Settings). */
export function useDisplay() {
  const [choices, setChoices] = useState(read);
  useEffect(() => {
    const update = () => setChoices(read());
    window.addEventListener("ttt:display", update);
    return () => window.removeEventListener("ttt:display", update);
  }, []);
  const set = (key, value) => {
    if (key === "theme") window.tttTheme?.set(value);
    else window.tttDisplay?.set(key, value);
    setChoices(read());
  };
  return [choices, set];
}

/**
 * A display choice (view, sort, grouping, card size) remembered on this device under ttt-<prefix>-<key>. Only a saved
 * value in `allowed` is used, so a stale one falls back to `initial`. `initial` can be a function.
 */
export function useStoredChoice(prefix, key, initial, allowed) {
  const [value, setValue] = useState(() => {
    const fallback = typeof initial === "function" ? initial() : initial;
    try {
      const saved = localStorage.getItem(`ttt-${prefix}-${key}`);
      return allowed.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v) => {
    setValue(v);
    try {
      localStorage.setItem(`ttt-${prefix}-${key}`, v);
    } catch {
      /* not remembered, but still applied */
    }
  };
  return [value, set];
}

/** True when motion should be kept to a minimum: the player chose it here, or their device asks for it. */
export const motionReduced = () =>
  typeof document !== "undefined" &&
  (document.documentElement.dataset.motion === "reduce" || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches));
