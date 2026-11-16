import { EventEmitter } from "node:events";
import { closeChannel, listenerCount, publish, subscribe } from "./live.js";

const fakeStream = () => {
  const req = new EventEmitter();
  const res = { set: jest.fn(), flushHeaders: jest.fn(), write: jest.fn() };
  return { req, res };
};

test("pushes events to everyone watching a thread, and only that thread", () => {
  jest.useFakeTimers();
  const a = fakeStream();
  const b = fakeStream();
  const other = fakeStream();
  subscribe(7, a.req, a.res);
  subscribe(7, b.req, b.res);
  subscribe(8, other.req, other.res);
  expect(a.res.set).toHaveBeenCalledWith(expect.objectContaining({ "Content-Type": "text/event-stream" }));
  expect(listenerCount(7)).toBe(2);

  publish(7, "message", { id: 1, body: "Hi!" });
  expect(a.res.write).toHaveBeenLastCalledWith('event: message\ndata: {"id":1,"body":"Hi!"}\n\n');
  expect(b.res.write).toHaveBeenLastCalledWith('event: message\ndata: {"id":1,"body":"Hi!"}\n\n');
  expect(other.res.write).not.toHaveBeenCalledWith(expect.stringContaining("Hi!"));

  // A keep-alive comment every 25 s, so proxies don't drop a quiet connection.
  jest.advanceTimersByTime(25_000);
  expect(a.res.write).toHaveBeenLastCalledWith(": keep-alive\n\n");

  // Closing the tab removes the listener; the thread goes when its last one does.
  a.req.emit("close");
  b.req.emit("close");
  expect(listenerCount(7)).toBe(0);
  const writes = a.res.write.mock.calls.length;
  publish(7, "message", { id: 2 }); // nobody left: no error
  jest.advanceTimersByTime(25_000); // and the keep-alive stopped
  expect(a.res.write.mock.calls.length).toBe(writes);
  other.req.emit("close");
  jest.useRealTimers();
});

test("one thread or player gets at most 10 open streams; the 11th is refused", () => {
  const open = Array.from({ length: 10 }, () => fakeStream());
  for (const s of open) subscribe(9, s.req, s.res);
  const extra = fakeStream();
  extra.res.status = jest.fn(() => extra.res);
  extra.res.end = jest.fn();
  subscribe(9, extra.req, extra.res);
  expect(extra.res.status).toHaveBeenCalledWith(429);
  expect(listenerCount(9)).toBe(10);
  for (const s of open) s.req.emit("close");
  expect(listenerCount(9)).toBe(0);
});

test("closeChannel ends every stream for a player and stops their keep-alives", () => {
  jest.useFakeTimers();
  const a = fakeStream();
  const b = fakeStream();
  for (const s of [a, b]) {
    s.res.end = jest.fn();
    subscribe(11, s.req, s.res);
  }
  closeChannel(11);
  expect(a.res.end).toHaveBeenCalled();
  expect(b.res.end).toHaveBeenCalled();
  expect(listenerCount(11)).toBe(0);
  const writes = a.res.write.mock.calls.length;
  jest.advanceTimersByTime(25_000);
  expect(a.res.write.mock.calls.length).toBe(writes);
  a.req.emit("close"); // the browser hanging up afterwards is harmless
  closeChannel(12); // nobody watching: no error
  jest.useRealTimers();
});
