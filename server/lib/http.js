/** An error whose message is safe to show to the user (5.2.2). `fields` maps form fields to messages. */
export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

/** Throws one 400 listing every form field that failed, e.g. { email: "Enter a valid email address." }. */
export function checkFields(fields) {
  if (Object.keys(fields).length) throw new HttpError(400, "Please fix the highlighted fields.", fields);
}

/** True for a UUID such as a Scryfall card id ("0000579f-7b35-4ed3-b44c-db2a538066fe"). */
export const isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * A web address typed into a form: null when left blank, the address when it's a full https:// link of at most
 * 300 characters, and undefined when it's neither (so the caller can show an error).
 */
export function httpsLinkOrBlank(value) {
  const v = typeof value === "string" ? value.trim() : "";
  if (v === "") return null;
  try {
    return new URL(v).protocol === "https:" && v.length <= 300 ? v : undefined;
  } catch {
    return undefined; // not a URL at all
  }
}

/** A numeric id from the URL, e.g. "42". A garbage id gets the same 404 as an id that doesn't exist. */
export function idFrom(value, what = "That listing") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, `${what} was not found.`);
  return id;
}

/** The :id part of the URL, e.g. /api/inventory/42. */
export const idParam = (req, what) => idFrom(req.params.id, what);

// Last stop for every error thrown in a route. Express knows it's an error handler because it takes 4 args,
// which is why `next` has to stay even though it's never called.
export function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...(err.fields && { fields: err.fields }) });
  }
  // body-parser tags its own errors with a type, so bad JSON and huge bodies get a proper 4xx.
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body is not valid JSON." });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large." });
  console.error(err.stack); // internals stay in server logs, never in the response
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}

/**
 * Structured security log line (5.2.1). Callers pass ids only: never passwords, tokens, cookies or emails.
 * Retention follows the host's log retention (Render: plan-dependent); see README "Operational records".
 */
export function logEvent(event, fields = {}) {
  console.warn(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}
