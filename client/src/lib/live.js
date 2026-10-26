import { useEffect, useRef } from "react";

// One live connection per trade (server/lib/live.js), shared by everything on the page that listens to it.
const connections = new Map(); // tradeId -> { source, handlers: Set }

function connect(tradeId) {
  let c = connections.get(tradeId);
  if (c) return c;
  const source = new EventSource(`/api/trades/${tradeId}/live`);
  c = { source, handlers: new Set(), opened: false };
  const fire = (type, data) => c.handlers.forEach((h) => h.current[type]?.(data));
  for (const type of ["message", "meetup"]) source.addEventListener(type, (e) => fire(type, JSON.parse(e.data)));
  // EventSource reconnects by itself; after a reconnect, listeners catch up on anything sent while it was down.
  source.addEventListener("open", () => {
    if (c.opened) fire("reconnect");
    c.opened = true;
  });
  connections.set(tradeId, c);
  return c;
}

/**
 * Calls handlers.message(message), handlers.meetup(meetup) and handlers.reconnect() as the other player acts,
 * while `enabled`. Returns false in browsers without EventSource, so the caller can fall back to polling.
 */
export function useTradeLive(tradeId, handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  const supported = typeof window !== "undefined" && "EventSource" in window;
  useEffect(() => {
    if (!enabled || !supported) return;
    const c = connect(tradeId);
    c.handlers.add(ref);
    return () => {
      c.handlers.delete(ref);
      if (!c.handlers.size) {
        c.source.close();
        connections.delete(tradeId);
      }
    };
  }, [tradeId, enabled, supported]);
  return supported;
}
