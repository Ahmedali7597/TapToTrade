// Meetups for accepted trades: when (a date and time in a named time zone) and where. Shared so the trade page,
// the server and the emails check and write them the same way.

/** Canada's main time zones, as [IANA name, label], for the meetup form. The form starts on the zone of the
 * player's city (timeZoneFor in shared/events.js), which is added to the list if it's a local one like Moncton's. */
export const TIME_ZONES = [
  ["America/St_Johns", "Newfoundland time"],
  ["America/Halifax", "Atlantic time (NS, NB, PEI)"],
  ["America/Toronto", "Eastern time (ON, QC, NU)"],
  ["America/Winnipeg", "Central time (MB)"],
  ["America/Regina", "Saskatchewan time"],
  ["America/Edmonton", "Mountain time (AB, NT)"],
  ["America/Vancouver", "Pacific time (BC)"],
  ["America/Whitehorse", "Yukon time"],
];

/** Whether `zone` is a real IANA time zone name, like "America/Halifax". */
export function isTimeZone(zone) {
  if (typeof zone !== "string" || !zone.includes("/")) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** How far ahead a meetup can be set. */
export const MEETUP_DAYS_AHEAD = 120;

/** "Saturday, October 25, 2026 at 2:00 p.m. EDT": the moment `iso` as clocks show it in `timeZone`. */
export const formatMeetup = (iso, timeZone) =>
  new Intl.DateTimeFormat("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(iso));

/**
 * Problems with a suggested meetup, as { field: message } (empty when it's fine). `localTime` is "YYYY-MM-DDTHH:MM"
 * (what a datetime-local input gives), read in `timeZone`. A place is either a partner `storeId` or `place` text.
 * Whether the time is in the future is checked by the server, which knows the exact current time.
 */
export function meetupProblems({ localTime, timeZone, storeId, place }) {
  const problems = {};
  if (typeof localTime !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localTime) || Number.isNaN(Date.parse(`${localTime}:00Z`))) {
    problems.localTime = "Choose a date and time.";
  }
  if (!isTimeZone(timeZone)) problems.timeZone = "Choose a time zone from the list.";
  const text = typeof place === "string" ? place.trim() : "";
  if (storeId == null && text.length < 2) problems.place = "Choose a partner store or describe a public place to meet.";
  if (text.length > 200) problems.place = "Keep the place under 200 characters.";
  return problems;
}
