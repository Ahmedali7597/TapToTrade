import { query } from "../db.js";
import { publish } from "./live.js";
import { listNotifications, markRead, notify, publishTo, userChannel } from "./notifications.js";

jest.mock("../db.js", () => ({ query: jest.fn() }));
jest.mock("./live.js", () => ({ publish: jest.fn() }));

const row = { id: 5, kind: "trade_message", trade_id: 12, created_at: "2026-10-27T12:00:00Z", read_at: null, actor: "alice" };
const rows = (r) => Promise.resolve({ rows: r });
beforeEach(() => jest.clearAllMocks());

test("publishes once to each player's channel", () => {
  publishTo([1, 2, 1], "message", { id: 3 });
  expect(publish.mock.calls).toEqual([
    ["user:1", "message", { id: 3 }],
    ["user:2", "message", { id: 3 }],
  ]);
  expect(userChannel(9)).toBe("user:9");
});

test("a message while an earlier one is unread moves that notice up instead of adding one", async () => {
  query.mockReturnValueOnce(rows([{ id: 5 }])).mockReturnValueOnce(rows([row])).mockReturnValueOnce(rows([{ id: 10 }]));
  await notify({ userId: 2, kind: "trade_message", tradeId: 12, actorId: 1 });
  expect(query.mock.calls[0][0]).toMatch(/^UPDATE notifications/);
  expect(query.mock.calls.some(([sql]) => /INSERT/.test(sql))).toBe(false);
  expect(publish).toHaveBeenCalledWith("user:2", "notification", {
    id: 5,
    kind: "trade_message",
    tradeId: 12,
    threadId: 10,
    actor: { username: "alice" },
    createdAt: row.created_at,
    read: false,
  });
});

test("other kinds add a notice, prune old read ones, and fall back when the actor or thread is gone", async () => {
  query
    .mockReturnValueOnce(rows([{ id: 6 }])) // insert
    .mockReturnValueOnce(rows([])) // prune
    .mockReturnValueOnce(rows([{ ...row, id: 6, kind: "trade_accepted", actor: null, read_at: "2026-10-27T13:00:00Z" }]))
    .mockReturnValueOnce(rows([])); // thread lookup
  await notify({ userId: 2, kind: "trade_accepted", tradeId: 12, actorId: null });
  expect(query.mock.calls[0][0]).toMatch(/^INSERT/);
  expect(query.mock.calls[1][0]).toMatch(/90 days/);
  expect(publish.mock.calls[0][2]).toMatchObject({ id: 6, threadId: 12, actor: { username: "A player" }, read: true });
});

test("lists the newest notices with the unread count, and marks some or all read", async () => {
  query.mockReturnValueOnce(rows([row])).mockReturnValueOnce(rows([{ n: 1 }]));
  const list = await listNotifications(2);
  expect(list).toEqual({ unread: 1, notifications: [expect.not.objectContaining({ threadId: expect.anything() })] });
  expect(list.notifications[0]).toMatchObject({ id: 5, tradeId: 12 });
  query.mockReturnValue(rows([]));
  await markRead(2);
  expect(query.mock.calls.at(-1)[1]).toEqual([2, null]);
  await markRead(2, [5]);
  expect(query.mock.calls.at(-1)[1]).toEqual([2, [5]]);
});
