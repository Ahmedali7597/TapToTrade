// Live updates for a trade conversation over Server-Sent Events: the trade page keeps one connection open and
// the server pushes new messages and meetup changes the moment they're saved, so nobody has to refresh.
// ponytail: listeners live in this process's memory, which is right for one Render instance; with several
// instances, publish through Postgres LISTEN/NOTIFY (or Redis) instead so every instance hears every event.

const channels = new Map(); // thread id -> Set of open responses
const HEARTBEAT_MS = 25_000; // a comment line often enough that proxies don't close an idle connection

/** Streams events for `threadId` to `res` until the browser disconnects. */
export function subscribe(threadId, req, res) {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 5000\n\n"); // reconnect after 5 s if the connection drops
  if (!channels.has(threadId)) channels.set(threadId, new Set());
  const listeners = channels.get(threadId);
  listeners.add(res);
  const beat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(beat);
    listeners.delete(res);
    if (!listeners.size) channels.delete(threadId);
  });
}

/** Sends `data` as a `type` event to everyone watching `threadId`. */
export function publish(threadId, type, data) {
  const listeners = channels.get(threadId);
  if (!listeners) return;
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners) res.write(frame);
}

/** For the tests: how many connections are open for a thread. */
export const listenerCount = (threadId) => channels.get(threadId)?.size ?? 0;
