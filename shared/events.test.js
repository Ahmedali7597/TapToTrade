import { eventDay, eventKindLabel, eventTimes, timeZoneFor } from "./events.js";

describe("store event basics", () => {
  test("each store's events use its province's time zone, with the cities that differ", () => {
    expect(timeZoneFor("Hamilton, ON")).toBe("America/Toronto");
    expect(timeZoneFor("Vancouver, BC")).toBe("America/Vancouver");
    expect(timeZoneFor("Regina, SK")).toBe("America/Regina");
    expect(timeZoneFor("Kenora, ON")).toBe("America/Winnipeg");
    expect(timeZoneFor("Cranbrook, BC")).toBe("America/Edmonton");
    expect(timeZoneFor("")).toBe("America/Toronto");
  });

  test("kinds have labels; unknown kinds read as other events", () => {
    expect(eventKindLabel("prerelease")).toBe("Prerelease");
    expect(eventKindLabel("mystery")).toBe("Other event");
  });

  test("days and times are shown in the store's time zone, wherever the viewer is", () => {
    // 22:00 UTC is 6 pm in Toronto (daylight time) and 3 pm in Vancouver.
    const toronto = { startsAt: "2026-10-09T22:00:00.000Z", endsAt: "2026-10-10T02:00:00.000Z", timeZone: "America/Toronto" };
    expect(eventDay(toronto, "en-CA")).toBe("Fri, Oct 9");
    expect(eventTimes(toronto, "en-CA")).toMatch(/^6:00\s?–\s?10:00\sp\.m\.$/u);
    expect(eventTimes({ ...toronto, endsAt: null, timeZone: "America/Vancouver" }, "en-CA")).toMatch(/^3:00\sp\.m\.$/u);
  });
});
