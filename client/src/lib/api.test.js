import { api, ApiError, qs, UNAUTHORIZED_EVENT } from "./api";

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });

afterEach(() => jest.restoreAllMocks());

test("sends the CSRF token it received on unsafe requests", async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(reply(200, { user: null, csrfToken: "tok-1" })).mockResolvedValueOnce(reply(201, { ok: true }));
  await api("/auth/me");
  await api("/inventory", { method: "POST", body: { quantity: 1 } });
  const [, init] = global.fetch.mock.calls[1];
  expect(init.headers).toMatchObject({ "X-CSRF-Token": "tok-1", "Content-Type": "application/json" });
  expect(init.body).toBe('{"quantity":1}');
});

test("refreshes the token and retries once after a 403", async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(reply(403, { error: "Your session expired." }))
    .mockResolvedValueOnce(reply(200, { csrfToken: "tok-2" }))
    .mockResolvedValueOnce(reply(200, { done: true }));
  await expect(api("/trades/1/accept", { method: "POST" })).resolves.toEqual({ done: true });
  expect(global.fetch.mock.calls[2][1].headers["X-CSRF-Token"]).toBe("tok-2");
});

test("turns failures into friendly ApiErrors and announces expired sessions", async () => {
  const listener = jest.fn();
  window.addEventListener(UNAUTHORIZED_EVENT, listener);
  global.fetch = jest.fn().mockResolvedValue(reply(401, { error: "Please log in to continue." }));
  await expect(api("/inventory")).rejects.toMatchObject({ status: 401, message: "Please log in to continue." });
  expect(listener).toHaveBeenCalled();

  global.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  const err = await api("/search").catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.message).toMatch(/Can't reach Tap to Trade/);
});

test("qs skips empty values", () => {
  expect(qs({ name: "Sol Ring", city: "", page: null, minQty: 2 })).toBe("?name=Sol+Ring&minQty=2");
  expect(qs({})).toBe("");
});
