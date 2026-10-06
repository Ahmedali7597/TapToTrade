// Tiny fetch wrapper for the same-origin JSON API. Handles the CSRF token and friendly errors.
// Last CSRF token the server gave us. Any JSON response can carry a fresh one.
let csrfToken = null;

// Thrown for any non-2xx reply. `fields` holds per-input messages so forms can show them inline.
export class ApiError extends Error {
  constructor(status, body = {}) {
    super(body.error ?? "Something went wrong. Please try again.");
    this.status = status;
    this.fields = body.fields ?? {};
  }
}

// Fired on window when the server says we're logged out, so AuthProvider can react.
export const UNAUTHORIZED_EVENT = "ttt:unauthorized";

export async function api(path, { method = "GET", body, retried = false } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(method !== "GET" && csrfToken && { "X-CSRF-Token": csrfToken }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch only rejects on network trouble (offline, server down), never on HTTP errors.
    throw new ApiError(0, { error: "Can't reach Tap to Trade. Check your connection and try again." });
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (data.csrfToken) csrfToken = data.csrfToken;

  // An expired/rotated CSRF token: refresh it once and retry.
  if (res.status === 403 && method !== "GET" && !retried) {
    await api("/auth/me");
    return api(path, { method, body, retried: true });
  }
  // Session timed out (5.1.4): tell the app so protected pages redirect to login.
  if (res.status === 401 && path !== "/auth/login") window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

/** Builds a query string, skipping empty values. */
export function qs(params) {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
  return s ? `?${s}` : "";
}
