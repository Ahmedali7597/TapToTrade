// Partner store events: the event form, store-local times, who may edit, calendar (.ics) files, the API shape
// of an event, and the two queries that list upcoming events. Everything except those queries is unit-tested
// without a database.
import { EVENT_KINDS, eventKindLabel, timeZoneFor } from "../../shared/events.js";
import { storePath } from "../../shared/stores.js";
import { query } from "../db.js";
import { httpsLinkOrBlank } from "./http.js";

// A weekly event can be posted for up to this many weeks at once (each week becomes its own event).
const MAX_REPEAT_WEEKS = 12;
// Upcoming events one store can have, so a typo in "repeat" can't flood the page.
export const MAX_UPCOMING = 100;
// Events with no end time count as upcoming until this long after they start.
export const DEFAULT_HOURS = 3;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KINDS = new Set(EVENT_KINDS.map((k) => k.value));

/** The parts of `instant` on a wall clock in `timeZone`, as numbers. */
function wallClock(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** How far `timeZone` is ahead of UTC at `instant`, in milliseconds (negative across Canada). */
function offsetAt(instant, timeZone) {
  const w = wallClock(instant, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * "2026-10-09" + "18:00" on a wall clock in `timeZone` -> the real instant. Guesses with the offset at that time
 * as if it were UTC, then corrects once, which handles daylight saving changes.
 */
export function zonedToUtc(date, time, timeZone) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = offsetAt(new Date(guess), timeZone);
  const second = offsetAt(new Date(guess - first), timeZone);
  return new Date(guess - second);
}

const pad = (n) => String(n).padStart(2, "0");

/** { date: "2026-10-09", time: "18:00" } for `instant` in `timeZone`, for the edit form. */
export function localParts(instant, timeZone) {
  const w = wallClock(new Date(instant), timeZone);
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: `${pad(w.hour)}:${pad(w.minute)}` };
}

/** "2026-10-09T18:00:00-04:00": the store's local time with its offset (schema.org dates). */
export function isoWithOffset(instant, timeZone) {
  const at = new Date(instant);
  const { date, time } = localParts(at, timeZone);
  const minutes = Math.round(offsetAt(at, timeZone) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  return `${date}T${time}:00${sign}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;
}

/** Whether "2026-02-30" is a real day on the calendar. */
const realDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d;
};
const realTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s ?? "");

/**
 * Validates the event form. Times are the store's local time in `timeZone`; an end time earlier than the start
 * means the next day (a trade night until 1 am). `partial` lets PATCH bodies leave fields out, but the date and
 * both times always come together. Returns { values, fields } with database column names in `values`.
 */
export function readEvent(body = {}, { timeZone, partial = false, now = new Date() } = {}) {
  const values = {};
  const fields = {};
  const sent = (key) => !partial || body[key] !== undefined;
  const text = (key) => (typeof body[key] === "string" ? body[key].trim() : "");

  if (sent("title")) {
    const v = text("title");
    if (v.length < 2 || v.length > 100) fields.title = "Title must be 2-100 characters.";
    else values.title = v;
  }
  if (sent("kind")) {
    if (KINDS.has(body.kind)) values.kind = body.kind;
    else fields.kind = "Choose what kind of event it is.";
  }
  if (!partial || ["date", "startTime", "endTime"].some((k) => body[k] !== undefined)) {
    const end = body.endTime ?? "";
    if (!realDate(body.date)) fields.date = "Choose the day of the event.";
    if (!realTime(body.startTime)) fields.startTime = "Enter a start time.";
    if (end !== "" && !realTime(end)) fields.endTime = "Enter an end time, or leave it blank.";
    if (!fields.date && !fields.startTime && !fields.endTime) {
      const starts = zonedToUtc(body.date, body.startTime, timeZone);
      let ends = end ? zonedToUtc(body.date, end, timeZone) : null;
      if (ends && ends <= starts) ends = zonedToUtc(nextDay(body.date), end, timeZone);
      if (starts.getTime() < now.getTime() - 12 * HOUR) fields.date = "That day has passed.";
      else if (starts.getTime() > now.getTime() + 2 * 365 * DAY) fields.date = "Post events up to two years ahead.";
      else Object.assign(values, { starts_at: starts, ends_at: ends });
    }
  }
  // Optional text: blank means none.
  const optional = (key, column, max, message) => {
    if (!sent(key)) return;
    const v = text(key);
    if (v.length > max) fields[key] = message;
    else values[column] = v || null;
  };
  optional("details", "details", 500, "Keep the details under 500 characters.");
  optional("cost", "cost", 60, "Keep the entry fee under 60 characters.");
  if (sent("link")) {
    const link = httpsLinkOrBlank(body.link);
    if (link === undefined) fields.link = "Use a full https:// link, or leave it blank.";
    else values.link = link;
  }
  if (body.cancelled !== undefined) {
    if (typeof body.cancelled === "boolean") values.cancelled = body.cancelled;
    else fields.cancelled = "Cancelled must be true or false.";
  }
  return { values, fields };
}

/** "2026-10-09" -> "2026-10-10". */
export const nextDay = (date, days = 1) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** "Repeat weekly" from the form: a whole number of weeks from 1 (no repeat) to MAX_REPEAT_WEEKS, or null. */
export const readRepeat = (value) => {
  const n = value === undefined || value === "" ? 1 : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= MAX_REPEAT_WEEKS ? n : null;
};

/** Admins manage every store's events; a store's own player account manages that store's. */
export const canManage = (user, store) => Boolean(user && store && (user.role === "admin" || String(store.account_user_id) === String(user.id)));

// ---- The API shape and the upcoming-event queries ----

// Upcoming = not over yet. Events with no end time count as over DEFAULT_HOURS after they start.
export const UPCOMING = `coalesce(e.ends_at, e.starts_at + interval '${DEFAULT_HOURS} hours') > now()`;

/** API shape for an event, with times in the store's own time zone for display and the edit form. */
export function eventView(e, city) {
  const timeZone = timeZoneFor(city);
  const start = localParts(e.starts_at, timeZone);
  return {
    id: e.id,
    storeId: e.store_id,
    title: e.title,
    kind: e.kind,
    startsAt: new Date(e.starts_at).toISOString(),
    endsAt: e.ends_at ? new Date(e.ends_at).toISOString() : null,
    timeZone,
    date: start.date,
    startTime: start.time,
    endTime: e.ends_at ? localParts(e.ends_at, timeZone).time : "",
    details: e.details,
    cost: e.cost,
    link: e.link,
    cancelled: e.cancelled,
  };
}

/** One store's upcoming events (cancelled ones included, marked), soonest first. Rows, not views. */
export const upcomingEvents = async (storeId, limit = MAX_UPCOMING) =>
  (await query(`SELECT e.* FROM store_events e WHERE e.store_id = $1 AND ${UPCOMING} ORDER BY e.starts_at, e.id LIMIT $2`, [storeId, limit])).rows;

/** The next `perStore` events (not cancelled) within `days` for several stores: Map of store id -> rows. */
export async function nextEvents(storeIds, { perStore = 2, days = 45 } = {}) {
  const { rows } = await query(
    `SELECT * FROM (
       SELECT e.*, row_number() OVER (PARTITION BY e.store_id ORDER BY e.starts_at, e.id) AS n
         FROM store_events e
        WHERE e.store_id = ANY($1) AND NOT e.cancelled AND ${UPCOMING} AND e.starts_at < now() + make_interval(days => $2)
     ) t WHERE n <= $3 ORDER BY starts_at`,
    [storeIds, days, perStore],
  );
  const byStore = new Map();
  for (const r of rows) byStore.set(String(r.store_id), [...(byStore.get(String(r.store_id)) ?? []), r]);
  return byStore;
}

// ---- Calendar files (RFC 5545) ----

// Text values escape backslashes, semicolons, commas and line breaks.
const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// 20261009T220000Z
const icsTime = (instant) => new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Lines longer than 75 bytes continue on the next line after a space, without splitting a character. */
export function foldLine(line) {
  const out = [];
  let current = "";
  for (const ch of line) {
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (Buffer.byteLength(current + ch) > limit) {
      out.push(current);
      current = ch;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** One VEVENT. `store` is the database row, `site` the public address of the site. */
function icsEvent(event, store, site) {
  const host = new URL(site).hostname;
  const description = [eventKindLabel(event.kind), event.cost && `Entry: ${event.cost}`, event.details, event.link].filter(Boolean).join("\n");
  return [
    "BEGIN:VEVENT",
    `UID:store-event-${event.id}@${host}`,
    `DTSTAMP:${icsTime(event.updated_at ?? event.created_at)}`,
    `DTSTART:${icsTime(event.starts_at)}`,
    event.ends_at && `DTEND:${icsTime(event.ends_at)}`,
    `SUMMARY:${icsText(`${event.cancelled ? "Cancelled: " : ""}${event.title}`)}`,
    `LOCATION:${icsText(`${store.name}, ${store.address}, ${store.city}`)}`,
    `DESCRIPTION:${icsText(description)}`,
    `URL:${site}${storePath(store)}`,
    `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
  ].filter(Boolean);
}

/** A whole calendar file for `events` at `store`, with CRLF line endings as the format requires. */
export function icsCalendar(store, events, site) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tap to Trade//Store events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`${store.name} events`)}`,
    // Subscribed calendars check back twice a day.
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
    "X-PUBLISHED-TTL:PT12H",
    ...events.flatMap((e) => icsEvent(e, store, site)),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
