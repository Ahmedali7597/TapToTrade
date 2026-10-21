import { formatMeetup, isTimeZone, meetupProblems, TIME_ZONES } from "./meetups.js";

test("meetup times are written out as clocks show them in the meetup's time zone", () => {
  // 18:00 UTC is 2 p.m. in Halifax in summer (ADT) and 2 p.m. in Toronto in winter (EST, 19:00 UTC).
  expect(formatMeetup("2026-07-11T17:00:00Z", "America/Halifax")).toBe("Saturday, July 11, 2026 at 2:00 p.m. ADT");
  expect(formatMeetup("2026-12-05T19:00:00Z", "America/Toronto")).toBe("Saturday, December 5, 2026 at 2:00 p.m. EST");
});

test("only real time zones are accepted, and every one in the list is real", () => {
  for (const [zone] of TIME_ZONES) expect(isTimeZone(zone)).toBe(true);
  expect(isTimeZone("America/Moncton")).toBe(true);
  for (const zone of ["Mars/Olympus", "EST", "", null]) expect(isTimeZone(zone)).toBe(false);
});

test("a meetup needs a date and time, a time zone and a place", () => {
  expect(meetupProblems({ localTime: "2026-12-05T14:00", timeZone: "America/Toronto", storeId: 3 })).toEqual({});
  expect(meetupProblems({ localTime: "2026-12-05T14:00", timeZone: "America/Toronto", place: "Halifax Central Library" })).toEqual({});
  expect(Object.keys(meetupProblems({ localTime: "Saturday", timeZone: "Nowhere", place: " " })).sort()).toEqual(["localTime", "place", "timeZone"]);
  expect(meetupProblems({ localTime: "2026-13-40T14:00", timeZone: "America/Toronto", storeId: 3 })).toHaveProperty("localTime");
  expect(meetupProblems({ localTime: "2026-12-05T14:00", timeZone: "America/Toronto", place: "x".repeat(201) })).toHaveProperty("place");
});
