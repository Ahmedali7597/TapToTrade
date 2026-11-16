// Live updates for a trade conversation over Server-Sent Events: the trade page keeps one connection open and
// the server pushes new messages and meetup changes the moment they're saved, so nobody has to refresh.
// ponytail: listeners live in this process's memory, which is right for one Render instance; with several
// instances, publish through Postgres LISTEN/NOTIFY (or Redis) instead so every instance hears every event.

const channels = new Map(); // thread id -> Map of open response -> its cleanup
const HEARTBEAT_MS = 25_000; // a comment line often enough that proxies don't close an idle connection
const MAX_PER_CHANNEL = 10; // plenty of tabs for one player or trade; stops one account holding open endless sockets

/** Streams events for `threadId` to `res` until the browser disconnects. */
export function subscribe(threadId, req, res) {
  if ((channels.get(threadId)?.size ?? 0) >= MAX_PER_CHANNEL) return res.status(429).end();
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 5000\n\n"); // reconnect after 5 s if the connection drops
  if (!channels.has(threadId)) channels.set(threadId, new Map());
  const listeners = channels.get(threadId);
  const beat = setInterval(() => res.write(": keep-alive\n\n"), HEARTBEAT_MS);
  const stop = () => {
    clearInterval(beat);
    listeners.delete(res);
    if (!listeners.size && channels.get(threadId) === listeners) channels.delete(threadId);
  };
  listeners.set(res, stop);
  req.on("close", stop);
}

/** Ends every open stream for `threadId`, e.g. when the account is suspended or deleted. */
export function closeChannel(threadId) {
  for (const [res, stop] of channels.get(threadId) ?? []) {
    stop();
    res.end();
  }
}

/** Sends `data` as a `type` event to everyone watching `threadId`. */
export function publish(threadId, type, data) {
  const listeners = channels.get(threadId);
  if (!listeners) return;
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of listeners.keys()) res.write(frame);
}

/** For the tests: how many connections are open for a thread. */
export const listenerCount = (threadId) => channels.get(threadId)?.size ?? 0;
