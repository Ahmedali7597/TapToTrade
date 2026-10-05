import { canManage, foldLine, icsCalendar, isoWithOffset, localParts, nextDay, readEvent, readRepeat, zonedToUtc } from "./events.js";

const TORONTO = "America/Toronto";
const NOW = new Date("2026-10-02T12:00:00Z");
const form = { title: "Friday trade night", kind: "trade_night", date: "2026-10-09", startTime: "18:00", endTime: "22:00" };

describe("store-local times", () => {
  test("a wall-clock time in a store's zone becomes the right instant, on both sides of daylight saving", () => {
    expect(zonedToUtc("2026-10-09", "18:00", TORONTO).toISOString()).toBe("2026-10-09T22:00:00.000Z"); // EDT, UTC-4
    expect(zonedToUtc("2026-12-04", "18:00", TORONTO).toISOString()).toBe("2026-12-04T23:00:00.000Z"); // EST, UTC-5
    expect(zonedToUtc("2026-10-09", "18:00", "America/St_Johns").toISOString()).toBe("2026-10-09T20:30:00.000Z");
    expect(zonedToUtc("2026-10-09", "18:00", "America/Regina").toISOString()).toBe("2026-10-10T00:00:00.000Z"); // no DST
  });

  test("instants read back as the store's date, time and offset", () => {
    expect(localParts("2026-10-09T22:00:00Z", TORONTO)).toEqual({ date: "2026-10-09", time: "18:00" });
    expect(isoWithOffset("2026-10-09T22:00:00Z", TORONTO)).toBe("2026-10-09T18:00:00-04:00");
    expect(isoWithOffset("2026-10-09T20:30:00Z", "America/St_Johns")).toBe("2026-10-09T18:00:00-02:30");
  });

  test("next day and weekly repeats walk the calendar, across month ends", () => {
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-10-29", 7)).toBe("2026-11-05");
    expect(readRepeat(undefined)).toBe(1);
    expect(readRepeat("4")).toBe(4);
    expect(readRepeat(13)).toBeNull();
    expect(readRepeat(1.5)).toBeNull();
  });
});

describe("the event form", () => {
  test("a complete event is read into database columns", () => {
    const { values, fields } = readEvent({ ...form, cost: " $5 ", details: "", link: "https://example.test/rsvp" }, { timeZone: TORONTO, now: NOW });
    expect(fields).toEqual({});
    expect(values).toEqual({
      title: "Friday trade night",
      kind: "trade_night",
      starts_at: new Date("2026-10-09T22:00:00Z"),
      ends_at: new Date("2026-10-10T02:00:00Z"),
      details: null,
      cost: "$5",
      link: "https://example.test/rsvp",
    });
  });

  test("an end time before the start runs past midnight; no end time is fine", () => {
    expect(readEvent({ ...form, endTime: "01:00" }, { timeZone: TORONTO, now: NOW }).values.ends_at).toEqual(new Date("2026-10-10T05:00:00Z"));
    expect(readEvent({ ...form, endTime: "" }, { timeZone: TORONTO, now: NOW }).values.ends_at).toBeNull();
  });

  test("bad input gets a message per field", () => {
    const { fields } = readEvent({ title: "x", kind: "rave", date: "2026-02-30", startTime: "25:00", endTime: "7pm", link: "http://x.test", cancelled: "no" }, { timeZone: TORONTO, now: NOW });
    expect(Object.keys(fields).sort()).toEqual(["cancelled", "date", "endTime", "kind", "link", "startTime", "title"]);
  });

  test("events can't be posted in the past or years ahead", () => {
    expect(readEvent({ ...form, date: "2026-09-30" }, { timeZone: TORONTO, now: NOW }).fields.date).toMatch(/passed/);
    expect(readEvent({ ...form, date: "2029-01-01" }, { timeZone: TORONTO, now: NOW }).fields.date).toMatch(/two years/);
  });

  test("edits only read what was sent, but a new time needs its date", () => {
    expect(readEvent({ cancelled: true }, { timeZone: TORONTO, partial: true, now: NOW })).toEqual({ values: { cancelled: true }, fields: {} });
    expect(readEvent({ startTime: "19:00" }, { timeZone: TORONTO, partial: true, now: NOW }).fields).toHaveProperty("date");
  });
});

test("admins and the store's own account manage its events; nobody else does", () => {
  const store = { id: 4, account_user_id: "12" };
  expect(canManage({ id: 12, role: "user" }, store)).toBe(true);
  expect(canManage({ id: 3, role: "admin" }, store)).toBe(true);
  expect(canManage({ id: 3, role: "moderator" }, store)).toBe(false);
  expect(canManage(undefined, store)).toBe(false);
  expect(canManage({ id: 3, role: "user" }, { id: 5, account_user_id: null })).toBe(false);
});

describe("calendar files", () => {
  const store = { id: 4, name: "Hammer Games", address: "1 King St W", city: "Hamilton, ON" };
  const event = {
    id: 9,
    title: "Commander night; bring decks, sleeves",
    kind: "commander",
    starts_at: new Date("2026-10-09T22:00:00Z"),
    ends_at: new Date("2026-10-10T02:00:00Z"),
    cost: "Free",
    details: "Pods of four.\nAll power levels.",
    link: null,
    cancelled: false,
    created_at: new Date("2026-10-01T15:30:00Z"),
    updated_at: new Date("2026-10-01T16:00:00Z"),
  };

  test("a calendar holds each event in UTC, with escaped text and the store as the place", () => {
    const ics = icsCalendar(store, [event, { ...event, id: 10, ends_at: null, cancelled: true }], "https://taptotrade.ca");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:store-event-9@taptotrade.ca");
    expect(ics).toContain("DTSTART:20261009T220000Z\r\nDTEND:20261010T020000Z");
    expect(ics).toContain("SUMMARY:Commander night\\; bring decks\\, sleeves");
    expect(ics).toContain("LOCATION:Hammer Games\\, 1 King St W\\, Hamilton\\, ON");
    expect(ics).toContain("DESCRIPTION:Commander night\\nEntry: Free\\nPods of four.\\nAll power levels.");
    expect(ics).toContain("URL:https://taptotrade.ca/stores/4-hammer-games");
    expect(ics).toContain("SUMMARY:Cancelled: Commander night");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });

  test("long lines fold at 75 bytes without splitting a character", () => {
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    const lines = folded.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(lines.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(`SUMMARY:${"é".repeat(60)}`);
  });
});
