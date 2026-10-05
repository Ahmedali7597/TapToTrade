// Store events (trade nights, prereleases...) shared by the server (validation, calendar files) and the app
// (store pages, the event form). Times are always the store's own local time, since players go there in person.

/** Kinds of event a store can post. Stored by value; the label is what players see. */
export const EVENT_KINDS = [
  { value: "trade_night", label: "Trade night" },
  { value: "commander", label: "Commander night" },
  { value: "fnm", label: "Friday Night Magic" },
  { value: "prerelease", label: "Prerelease" },
  { value: "draft", label: "Draft" },
  { value: "tournament", label: "Tournament" },
  { value: "casual", label: "Casual play" },
  { value: "other", label: "Other event" },
];
const LABELS = Object.fromEntries(EVENT_KINDS.map((k) => [k.value, k.label]));
export const eventKindLabel = (value) => LABELS[value] ?? LABELS.other;

// Most of a province shares one time zone. These cities on our list don't follow their province.
const PROVINCE_ZONES = {
  AB: "America/Edmonton",
  BC: "America/Vancouver",
  MB: "America/Winnipeg",
  NB: "America/Moncton",
  NL: "America/St_Johns",
  NS: "America/Halifax",
  NT: "America/Yellowknife",
  NU: "America/Iqaluit",
  ON: "America/Toronto",
  PE: "America/Halifax",
  QC: "America/Toronto",
  SK: "America/Regina",
  YT: "America/Whitehorse",
};
const CITY_ZONES = {
  "Cranbrook, BC": "America/Edmonton",
  "Fort St. John, BC": "America/Dawson_Creek",
  "Happy Valley-Goose Bay, NL": "America/Goose_Bay",
  "Labrador City, NL": "America/Goose_Bay",
  "Kenora, ON": "America/Winnipeg",
  "Rankin Inlet, NU": "America/Rankin_Inlet",
};

/** The time zone a store's events happen in, from its "City, PROV". Defaults to Eastern time. */
export const timeZoneFor = (city = "") => CITY_ZONES[city] ?? PROVINCE_ZONES[String(city).split(", ").pop()] ?? "America/Toronto";

/** "Fri, Oct 9" in the store's time zone. */
export const eventDay = (event, locale) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: event.timeZone }).format(new Date(event.startsAt));

/** "6:00 – 10:00 p.m." (or just the start) in the store's time zone. */
export function eventTimes(event, locale) {
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: event.timeZone });
  return event.endsAt ? time.formatRange(new Date(event.startsAt), new Date(event.endsAt)) : time.format(new Date(event.startsAt));
}
