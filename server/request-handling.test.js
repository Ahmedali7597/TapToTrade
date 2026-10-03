// Unit tests for how the API handles a request around the route itself: CSRF and role guards
// (middleware.js), the body parsers some routes export, and the error handler (lib/http.js). No database needed.

import { errorHandler, HttpError } from "./lib/http.js";
import { csrf, requireAuth, requireRole } from "./middleware.js";
import { readItemFields } from "./routes/inventory.js";
import { outranks } from "../shared/validation.js";
import { readProposal } from "./routes/trades.js";
import { duplicateAccountError } from "./routes/auth.js";

const req = (over = {}) => ({ method: "GET", session: {}, get: () => undefined, ...over });

describe("csrf", () => {
  test("issues a token and lets safe methods through", () => {
    const r = req();
    const next = jest.fn();
    csrf(r, {}, next);
    expect(r.session.csrfToken).toMatch(/^[\w-]{43}$/);
    expect(next).toHaveBeenCalled();
  });

  test("rejects unsafe methods without the matching header", () => {
    const r = req({ method: "POST", session: { csrfToken: "right" }, get: () => "wrong" });
    expect(() => csrf(r, {}, jest.fn())).toThrow(HttpError);
    const ok = jest.fn();
    csrf(req({ method: "POST", session: { csrfToken: "right" }, get: () => "right" }), {}, ok);
    expect(ok).toHaveBeenCalled();
  });
});

describe("authorization (4.1.8, 4.6, 4.7)", () => {
  test("requireAuth rejects anonymous requests with 401", () => {
    expect(() => requireAuth(req(), {}, jest.fn())).toThrow(expect.objectContaining({ status: 401 }));
  });

  test("requireRole allows listed roles only", () => {
    const mod = requireRole("moderator", "admin");
    expect(() => mod(req({ user: { role: "user" } }), {}, jest.fn())).toThrow(expect.objectContaining({ status: 403 }));
    const next = jest.fn();
    mod(req({ user: { role: "admin" } }), {}, next);
    expect(next).toHaveBeenCalled();
  });

  test("moderators act on users, admins on moderators, nobody on admins", () => {
    expect(outranks("moderator", "user")).toBe(true);
    expect(outranks("moderator", "moderator")).toBe(false);
    expect(outranks("admin", "moderator")).toBe(true);
    expect(outranks("admin", "admin")).toBe(false);
  });
});

describe("request parsing", () => {
  test("inventory fields: defaults on create, partial on edit", () => {
    expect(readItemFields({ quantity: 5 })).toEqual({ quantity: 5, condition: "NM", available: true });
    expect(readItemFields({ available: false }, true)).toEqual({ available: false });
    expect(() => readItemFields({ quantity: 0 })).toThrow(expect.objectContaining({ status: 400, fields: expect.objectContaining({ quantity: expect.any(String) }) }));
    expect(() => readItemFields({ quantity: 1, condition: "Mint" })).toThrow(HttpError);
  });

  test("trade proposals coerce numbers and keep messages as plain text", () => {
    const p = readProposal({ requested: [{ inventoryItemId: "4", quantity: "2" }], message: "  <b>hi</b>  " });
    expect(p).toEqual({ requested: [{ inventoryItemId: 4, quantity: 2 }], offered: [], message: "<b>hi</b>", meetupStoreId: null });
    expect(readProposal({ requested: [{ inventoryItemId: 1, quantity: 1 }], meetupStoreId: "7" }).meetupStoreId).toBe(7);
    expect(() => readProposal({ requested: [{ inventoryItemId: 1, quantity: 1 }], meetupStoreId: "x" })).toThrow(/meetup spot/);
    expect(() => readProposal({ requested: [] })).toThrow(/at least one/);
    expect(() => readProposal({ requested: [{ inventoryItemId: 1, quantity: 1 }], message: "x".repeat(501) })).toThrow(/500/);
  });

  test("duplicate-account violations become 409 field errors", () => {
    expect(duplicateAccountError({ code: "23505", constraint: "users_email_key" })).toMatchObject({ status: 409, fields: { email: expect.any(String) } });
    expect(duplicateAccountError({ code: "23505", constraint: "users_username_lower_key" }).fields).toHaveProperty("username");
    const other = new Error("boom");
    expect(duplicateAccountError(other)).toBe(other);
  });
});

describe("errorHandler (5.2.2)", () => {
  const res = () => {
    const r = { status: jest.fn(() => r), json: jest.fn(() => r) };
    return r;
  };

  test("shows HttpError messages and field errors", () => {
    const r = res();
    errorHandler(new HttpError(400, "Nope", { a: "b" }), {}, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith({ error: "Nope", fields: { a: "b" } });
  });

  test("hides internals of unexpected errors", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = res();
    errorHandler(new Error('relation "users" does not exist'), {}, r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(r.json.mock.calls[0][0])).not.toContain("relation");
  });
});
