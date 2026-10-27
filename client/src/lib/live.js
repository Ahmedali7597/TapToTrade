import { useEffect, useRef } from "react";

// The signed-in player's live connection (GET /api/live, server/routes/notifications.js): one per tab, shared by
// everything on the page that listens. It carries "notification" (the bell), "message" and "meetup" events, each
// with the threadId of the trade it belongs to.
let source = null;
let opened = false;
const listeners = new Set();
const TYPES = ["notification", "message", "meetup"];

const fire = (type, data) => listeners.forEach((l) => l.current[type]?.(data));

function open() {
  source = new EventSource("/api/live");
  for (const type of TYPES) source.addEventListener(type, (e) => fire(type, JSON.parse(e.data)));
  // EventSource reconnects by itself; after a reconnect, listeners catch up on anything sent while it was down.
  source.addEventListener("open", () => {
    if (opened) fire("reconnect");
    opened = true;
  });
}

export const liveSupported = () => typeof window !== "undefined" && "EventSource" in window;

/**
 * Calls handlers.notification(n), handlers.message(m), handlers.meetup({ threadId, meetup }) and handlers.reconnect()
 * while `enabled` (a signed-in player). Returns false in browsers without EventSource, so callers can poll instead.
 */
export function useLive(handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const supported = liveSupported();
  useEffect(() => {
    if (!enabled || !supported) return;
    listeners.add(ref);
    if (!source) open();
    return () => {
      listeners.delete(ref);
      if (!listeners.size) {
        source.close();
        source = null;
        opened = false;
      }
    };
  }, [enabled, supported]);
  return supported;
}
