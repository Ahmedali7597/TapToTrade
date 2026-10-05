// API integration tests against a real PostgreSQL database (TEST_DATABASE_URL). IDs map to Milestone 4 section 6.
import request from "supertest";
import { pool } from "../db.js";
import { migrate } from "../migrate.js";
import { createApp } from "../app.js";
import { sendEmail } from "../lib/email.js";
import { settle } from "../lib/notify.js";
import { exchangeCode } from "../lib/google.js";
import { autocompleteNames, cardDetails, lookupCollection, searchPrintings, showcasePool } from "../lib/scryfall.js";
import { localParts, nextDay } from "../lib/events.js";
import { TERMS_UPDATED } from "../../shared/pages.js";

jest.mock("../lib/email.js", () => ({ ...jest.requireActual("../lib/email.js"), sendEmail: jest.fn().mockResolvedValue(true) }));
// Google and Scryfall are external services; the tests stand in for their answers.
jest.mock("../lib/google.js", () => ({ ...jest.requireActual("../lib/google.js"), googleConfigured: () => true, exchangeCode: jest.fn() }));
jest.mock("../lib/scryfall.js", () => ({
  ...jest.requireActual("../lib/scryfall.js"),
  lookupCollection: jest.fn(),
  searchPrintings: jest.fn(),
  autocompleteNames: jest.fn(),
  cardDetails: jest.fn(),
  showcasePool: jest.fn(),
}));

const PASSWORD = "Secure@123";
const BOLT = "435589bb-27c6-4a6d-9d63-394d5092b9d8";
const LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe";
const RING = "4cbc6901-6a4a-4d0a-83ea-7eefa3b35021";
let app;

/** A logged-in (or anonymous) browser: keeps cookies and the CSRF token. */
class Player {
  constructor() {
    this.agent = request.agent(app);
  }
  async init() {
    this.csrf = (await this.agent.get("/api/auth/me")).body.csrfToken;
    return this;
  }
  send(method, url, body) {
    return this.agent[method](url).set("X-CSRF-Token", this.csrf ?? "").send(body);
  }
  get(url) {
    return this.agent.get(url);
  }
  track(res) {
    if (res.body?.csrfToken) this.csrf = res.body.csrfToken;
    if (res.body?.user) this.user = res.body.user;
    return res;
  }
  async register(username, city = "Hamilton, ON") {
    await this.init();
    this.email = `${username}@example.test`;
    return this.track(await this.send("post", "/api/auth/register", { email: this.email, username, password: PASSWORD, city }));
  }
  async login(email = this.email, password = PASSWORD) {
    await this.init();
    return this.track(await this.send("post", "/api/auth/login", { email, password }));
  }
  async add(printingId, quantity = 4, extra = {}) {
    return (await this.send("post", "/api/inventory", { printingId, quantity, condition: "NM", ...extra })).body.item;
  }
}

/** The last email sent to `to` (after background sends finish). */
async function lastEmailTo(to) {
  await settle();
  return sendEmail.mock.calls.map(([m]) => m).findLast((m) => m.to === to);
}
const tokenIn = (email) => email.text.match(/token=([\w-]+)/)[1];

/** A signed-up player who has confirmed their email with the link from the welcome email (unless confirmed: false). */
const newPlayer = async (username, city, { confirmed = true } = {}) => {
  const p = new Player();
  const res = await p.register(username, city);
  expect(res.status).toBe(201);
  if (confirmed) {
    const welcome = await lastEmailTo(p.email);
    expect((await p.send("post", "/api/auth/verify-email", { token: tokenIn(welcome) })).status).toBe(200);
    p.user.emailVerified = true;
  }
  return p;
};

async function setRole(player, role) {
  await pool.query("UPDATE users SET role = $1 WHERE id = $2", [role, player.user.id]);
}

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate();
  await pool.query(
    `INSERT INTO card_printings (id, name, set_code, set_name, collector_number, image_url, finishes) VALUES
      ($1, 'Lightning Bolt', 'm10', 'Magic 2010', '146', null, '{nonfoil,foil}'),
      ($2, 'Black Lotus', 'lea', 'Limited Edition Alpha', '232', null, '{nonfoil}'),
      ($3, 'Sol Ring', 'c21', 'Commander 2021', '263', null, '{nonfoil,etched}')`,
    [BOLT, LOTUS, RING],
  );
  app = createApp();
  jest.spyOn(console, "warn").mockImplementation(() => {}); // auth-failure log lines
});

afterAll(() => pool.end());

describe("authentication (4.1)", () => {
  test("AT-01 register returns 201 with the user and a protected session cookie (ST-05)", async () => {
    const p = new Player();
    const res = await p.register("at01_user");
    expect(res.status).toBe(201);
    expect(res.body.user).toEqual({
      id: expect.any(Number),
      email: "at01_user@example.test",
      username: "at01_user",
      city: "Hamilton, ON",
      role: "user",
      travelKm: null,
      emailLogin: true,
      googleLinked: false,
      emailVerified: false,
      emailTrades: true,
    });
    // Signing up records which version of the terms and privacy policy the player agreed to (4.2.1).
    const { rows } = await pool.query("SELECT terms_version, terms_accepted_at FROM users WHERE id = $1", [res.body.user.id]);
    expect(rows[0].terms_version).toBe(TERMS_UPDATED);
    expect(rows[0].terms_accepted_at).toBeInstanceOf(Date);
    const cookie = res.headers["set-cookie"].join(";");
    expect(cookie).toMatch(/ttt\.sid=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const expires = new Date(cookie.match(/Expires=([^;]+)/)[1]).getTime() - Date.now();
    expect(expires / 60_000).toBeGreaterThan(29); // ST-03 30-minute idle timeout (rolling)
    expect(expires / 60_000).toBeLessThanOrEqual(30);
  });

  test("AT-02 duplicate email returns 409; UT-03 missing city returns 400", async () => {
    const p = await new Player().init();
    await newPlayer("at02_first");
    const dup = await p.send("post", "/api/auth/register", { email: "AT02_first@example.test", username: "at02_other", password: PASSWORD, city: "Hamilton, ON" });
    expect(dup.status).toBe(409);
    expect(dup.body.fields).toHaveProperty("email");
    const noCity = await p.send("post", "/api/auth/register", { email: "x@example.test", username: "x_user", password: PASSWORD });
    expect(noCity.status).toBe(400);
    expect(noCity.body.fields.city).toBe("City is required.");
  });

  test("AT-03 login returns 200 without exposing the password hash", async () => {
    const p = await newPlayer("at03_user");
    const res = await p.login();
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon/i);
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [p.user.id]);
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/); // 5.1.1 never plain text
  });

  test("AT-04 wrong password and unknown email both return the same 401", async () => {
    await newPlayer("at04_user");
    const a = await new Player().login("at04_user@example.test", "Wrong@1234");
    const b = await new Player().login("nobody@example.test", "Wrong@1234");
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"event":"auth.login_failed"'));
    expect(console.warn.mock.calls.flat().join()).not.toContain("Wrong@1234"); // 5.2.1 no passwords in logs
  });

  test("AT-09 protected endpoints return 401 without a session", async () => {
    const anon = await new Player().init();
    expect((await anon.get("/api/inventory")).status).toBe(401);
    expect((await anon.get("/api/trades")).status).toBe(401);
    expect((await anon.get("/api/suggestions/mine")).status).toBe(401);
  });

  test("unsafe requests without the CSRF token are rejected", async () => {
    const p = await newPlayer("csrf_user");
    const res = await p.agent.post("/api/inventory").send({ printingId: BOLT, quantity: 1 });
    expect(res.status).toBe(403);
  });

  test("logout ends the session", async () => {
    const p = await newPlayer("logout_user");
    expect((await p.send("post", "/api/auth/logout")).status).toBe(204);
    expect((await p.get("/api/inventory")).status).toBe(401);
  });
});

describe("password reset (4.1.5) and account settings (4.1.7, 4.2)", () => {
  test("a reset link works once, expires, and signs out other sessions", async () => {
    const p = await newPlayer("reset_user");
    const other = new Player();
    await other.login(p.email);
    const anon = await new Player().init();
    sendEmail.mockClear();
    expect((await anon.send("post", "/api/auth/forgot-password", { email: p.email })).status).toBe(202);
    expect((await anon.send("post", "/api/auth/forgot-password", { email: "ghost@example.test" })).status).toBe(202);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const token = sendEmail.mock.calls[0][0].text.match(/token=([\w-]+)/)[1];
    const { rows } = await pool.query("SELECT token_hash FROM password_resets WHERE user_id = $1", [p.user.id]);
    expect(rows[0].token_hash).not.toBe(token); // only the hash is stored

    const reset = await anon.send("post", "/api/auth/reset-password", { token, password: "Brand@New1" });
    expect(reset.status).toBe(200);
    expect((await other.get("/api/inventory")).status).toBe(401); // sessions revoked
    expect((await anon.send("post", "/api/auth/reset-password", { token, password: "Again@New1" })).status).toBe(400); // reused
    expect((await new Player().login(p.email, PASSWORD)).status).toBe(401);
    expect((await new Player().login(p.email, "Brand@New1")).status).toBe(200);

    await anon.send("post", "/api/auth/forgot-password", { email: p.email });
    const expired = sendEmail.mock.calls.at(-1)[0].text.match(/token=([\w-]+)/)[1];
    await pool.query("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = $1", [p.user.id]);
    expect((await anon.send("post", "/api/auth/reset-password", { token: expired, password: "Late@Reset1" })).status).toBe(400);
  });

  test("city, email and password changes require the right inputs", async () => {
    const p = await newPlayer("settings_user");
    expect((await p.send("patch", "/api/account/city", { city: "Mars" })).status).toBe(400);
    expect((await p.send("patch", "/api/account/city", { city: "Guelph, ON" })).body.user.city).toBe("Guelph, ON");
    expect((await p.send("patch", "/api/account/email", { email: "new@example.test", currentPassword: "nope" })).status).toBe(400);
    expect((await p.send("patch", "/api/account/email", { email: "settings_new@example.test", currentPassword: PASSWORD })).body.user.email).toBe("settings_new@example.test");
    expect((await p.send("patch", "/api/account/password", { currentPassword: PASSWORD, newPassword: "weak" })).status).toBe(400);
    expect((await p.send("patch", "/api/account/password", { currentPassword: PASSWORD, newPassword: "Changed@123" })).status).toBe(200);
    expect((await p.get("/api/inventory")).status).toBe(200); // current session kept
  });

  test("username changes are validated, unique regardless of case, and follow through to the profile", async () => {
    const p = await newPlayer("typo_nmae");
    await newPlayer("taken_name");
    expect((await p.send("patch", "/api/account/username", { username: "a b" })).status).toBe(400);
    const dup = await p.send("patch", "/api/account/username", { username: "TAKEN_name" });
    expect(dup.status).toBe(409);
    expect(dup.body.fields.username).toBe("That username is taken.");
    expect((await p.send("patch", "/api/account/username", { username: "typo_name" })).body.user.username).toBe("typo_name");
    expect((await p.get("/api/users/typo_name")).status).toBe(200);
    expect((await p.get("/api/users/typo_nmae")).status).toBe(404);
  });
});

describe("inventory (4.3)", () => {
  test("AT-05 add a card with quantity 5 → 201; AT-06 quantity 0 → 400", async () => {
    const p = await newPlayer("inv_user");
    const ok = await p.send("post", "/api/inventory", { printingId: BOLT, quantity: 5, condition: "LP" });
    expect(ok.status).toBe(201);
    expect(ok.body.item).toMatchObject({ quantity: 5, condition: "LP", available: true, printing: { name: "Lightning Bolt" } });
    const zero = await p.send("post", "/api/inventory", { printingId: RING, quantity: 0 });
    expect(zero.status).toBe(400);
    expect(zero.body.fields).toHaveProperty("quantity");
    expect((await p.send("post", "/api/inventory", { printingId: BOLT, quantity: 1, condition: "LP" })).status).toBe(409);
    expect((await p.send("post", "/api/inventory", { printingId: "00000000-0000-0000-0000-000000000000", quantity: 1 })).status).toBe(400);
  });

  test("finish: defaults to the printing's first finish, must exist for that printing, and is part of the listing's identity", async () => {
    const p = await newPlayer("finish_user");
    expect((await p.add(BOLT, 2)).finish).toBe("nonfoil");
    const foil = await p.send("post", "/api/inventory", { printingId: BOLT, quantity: 1, condition: "NM", finish: "foil" });
    expect(foil.status).toBe(201); // same printing and condition, different finish = separate listing
    expect(foil.body.item).toMatchObject({ finish: "foil", printing: { finishes: ["nonfoil", "foil"] } });
    expect((await p.send("post", "/api/inventory", { printingId: BOLT, quantity: 1, finish: "foil" })).status).toBe(409);

    const lotus = await p.send("post", "/api/inventory", { printingId: LOTUS, quantity: 1, finish: "foil" });
    expect(lotus.status).toBe(400);
    expect(lotus.body.fields).toHaveProperty("finish");
    expect((await p.send("post", "/api/inventory", { printingId: RING, quantity: 1, finish: "shiny" })).status).toBe(400);

    const ring = await p.add(RING, 1, { finish: "etched" });
    expect((await p.send("patch", `/api/inventory/${ring.id}`, { finish: "foil" })).status).toBe(400);
    expect((await p.send("patch", `/api/inventory/${ring.id}`, { finish: "nonfoil" })).body.item.finish).toBe("nonfoil");

    const viewer = await newPlayer("finish_viewer");
    const foils = (await viewer.get("/api/search?name=bolt&finish=foil")).body.results;
    expect(foils.some((r) => r.id === foil.body.item.id)).toBe(true);
    expect(foils.every((r) => r.finish === "foil")).toBe(true);

    const trade = await viewer.send("post", "/api/trades", {
      receiverId: p.user.id,
      requested: [{ inventoryItemId: foil.body.item.id, quantity: 1 }],
    });
    expect(trade.body.trade.requested[0].finish).toBe("foil"); // the snapshot keeps the finish
  });

  test("owners can edit and delete; other players get 404 (ownership)", async () => {
    const owner = await newPlayer("inv_owner");
    const other = await newPlayer("inv_other");
    const item = await owner.add(RING, 3);
    expect((await other.send("patch", `/api/inventory/${item.id}`, { quantity: 1 })).status).toBe(404);
    expect((await other.send("delete", `/api/inventory/${item.id}`)).status).toBe(404);
    expect((await owner.send("patch", `/api/inventory/${item.id}`, { quantity: 7, available: false })).body.item).toMatchObject({ quantity: 7, available: false });
    expect((await owner.send("patch", `/api/inventory/${item.id}`, { quantity: -5 })).status).toBe(400); // UT-04 via API
    expect((await owner.send("delete", `/api/inventory/${item.id}`)).status).toBe(204);
    expect((await owner.get("/api/inventory")).body.items).toHaveLength(0);
  });
});

describe("search (4.4) and profiles (4.2.1)", () => {
  let viewer;
  beforeAll(async () => {
    viewer = await newPlayer("search_viewer", "Hamilton, ON");
    const a = await newPlayer("search_hamilton", "Hamilton, ON");
    const b = await newPlayer("search_toronto", "Toronto, ON");
    await a.add(BOLT, 4);
    await a.add(LOTUS, 1);
    await b.add(BOLT, 1, { condition: "HP" });
    await b.add(RING, 2, { available: false }); // private: never searchable
  });

  test("AT-07 search by name returns matching players", async () => {
    const res = await viewer.get("/api/search?name=Lightning%20Bolt");
    expect(res.status).toBe(200);
    const owners = res.body.results.map((r) => r.owner.username);
    expect(owners).toEqual(expect.arrayContaining(["search_hamilton", "search_toronto"]));
    expect(res.body.results[0]).not.toHaveProperty("owner.email");
  });

  test("filters by city, minimum quantity and condition; private cards stay hidden", async () => {
    const byCity = (await viewer.get("/api/search?name=bolt&city=Toronto%2C%20ON")).body.results;
    expect(byCity.every((r) => r.owner.city === "Toronto, ON")).toBe(true);
    const minQty = (await viewer.get("/api/search?name=bolt&minQty=3")).body.results;
    expect(minQty.every((r) => r.quantity >= 3)).toBe(true);
    const hp = (await viewer.get("/api/search?name=bolt&condition=HP")).body.results;
    expect(hp.map((r) => r.owner.username)).toContain("search_toronto");
    expect((await viewer.get("/api/search?name=sol%20ring")).body.results.map((r) => r.owner.username)).not.toContain("search_toronto");
  });

  test("ST-01 SQL injection text is matched literally and harms nothing", async () => {
    const res = await viewer.get(`/api/search?name=${encodeURIComponent("'; DROP TABLE users;--")}&sort=${encodeURIComponent("name; DROP TABLE users")}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect((await pool.query("SELECT count(*) FROM users")).rows[0].count).not.toBe("0");
  });

  test("pagination is deterministic", async () => {
    const res = await viewer.get("/api/search?page=1");
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, totalPages: expect.any(Number) });
    const again = await viewer.get("/api/search?page=1");
    expect(again.body.results.map((r) => r.id)).toEqual(res.body.results.map((r) => r.id));
  });

  test("public profiles show username, city and shared inventory only", async () => {
    const res = await viewer.get("/api/users/search_toronto");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.user).sort()).toEqual(["city", "distanceKm", "id", "memberSince", "reputation", "store", "travelKm", "username"]); // no email, role or reports
    expect(res.body.inventory.map((i) => i.printing.name)).toEqual(["Lightning Bolt"]);
    expect((await viewer.get("/api/users/nobody_here")).status).toBe(404);
  });
});

describe("trades (4.5)", () => {
  let alice;
  let bob;
  let carol;
  let aliceRing;
  let bobBolt;
  let bobLotus;
  beforeAll(async () => {
    alice = await newPlayer("trade_alice");
    bob = await newPlayer("trade_bob", "Burlington, ON");
    carol = await newPlayer("trade_carol");
    aliceRing = await alice.add(RING, 3);
    bobBolt = await bob.add(BOLT, 4);
    bobLotus = await bob.add(LOTUS, 1);
  });

  const propose = (from, to, requested, offered = [], message) =>
    from.send("post", "/api/trades", { receiverId: to.user.id, requested, offered, message });

  test("AT-08 a request with an offer returns 201 and shows in both inboxes (4.5.6)", async () => {
    const res = await propose(alice, bob, [{ inventoryItemId: bobBolt.id, quantity: 2 }], [{ inventoryItemId: aliceRing.id, quantity: 1 }], "<script>alert(1)</script>");
    expect(res.status).toBe(201);
    expect(res.body.trade).toMatchObject({
      status: "pending",
      sender: { username: "trade_alice" },
      receiver: { username: "trade_bob", city: "Burlington, ON" },
      requested: [{ cardName: "Lightning Bolt", quantity: 2 }],
      offered: [{ cardName: "Sol Ring", quantity: 1 }],
      message: "<script>alert(1)</script>", // ST-02 stored as plain text; React renders it inert
    });
    expect((await bob.get("/api/trades")).body.received.map((t) => t.id)).toContain(res.body.trade.id);
    expect((await alice.get("/api/trades")).body.sent.map((t) => t.id)).toContain(res.body.trade.id);
  });

  test("UT-09 via API: offering more than you own is rejected; request-only is allowed", async () => {
    const tooMany = await propose(alice, bob, [{ inventoryItemId: bobBolt.id, quantity: 1 }], [{ inventoryItemId: aliceRing.id, quantity: 10 }]);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatch(/Only 3 × Sol Ring/);
    expect((await propose(alice, bob, [{ inventoryItemId: bobLotus.id, quantity: 1 }])).status).toBe(201);
  });

  test("rejects self-trades, empty requests and someone else's cards", async () => {
    expect((await propose(alice, alice, [{ inventoryItemId: aliceRing.id, quantity: 1 }])).status).toBe(400);
    expect((await propose(alice, bob, [])).status).toBe(400);
    expect((await propose(alice, bob, [{ inventoryItemId: aliceRing.id, quantity: 1 }])).status).toBe(400); // not bob's
  });

  test("counter-offers create a new version; stale versions can't be accepted", async () => {
    const t1 = (await propose(alice, bob, [{ inventoryItemId: bobBolt.id, quantity: 1 }])).body.trade;
    expect((await alice.send("post", `/api/trades/${t1.id}/accept`)).status).toBe(403); // sender can't accept
    expect((await carol.get(`/api/trades/${t1.id}`)).status).toBe(404); // outsiders can't see it

    const counter = await bob.send("post", `/api/trades/${t1.id}/counter`, {
      requested: [{ inventoryItemId: aliceRing.id, quantity: 1 }],
      offered: [{ inventoryItemId: bobBolt.id, quantity: 2 }],
    });
    expect(counter.status).toBe(201);
    const t2 = counter.body.trade;
    expect(t2).toMatchObject({ parentId: t1.id, status: "pending", sender: { username: "trade_bob" }, receiver: { username: "trade_alice" } });

    expect((await bob.send("post", `/api/trades/${t1.id}/accept`)).status).toBe(409); // stale counter
    expect((await bob.send("post", `/api/trades/${t1.id}/counter`, { requested: [{ inventoryItemId: aliceRing.id, quantity: 1 }] })).status).toBe(409);

    const thread = (await alice.get(`/api/trades/${t2.id}`)).body.thread;
    expect(thread.map((v) => [v.id, v.status])).toEqual([
      [t1.id, "countered"],
      [t2.id, "pending"],
    ]);
  });

  test("UT-06/07 via API: accept once; repeated and concurrent acceptance fail", async () => {
    const t = (await propose(carol, bob, [{ inventoryItemId: bobBolt.id, quantity: 1 }])).body.trade;
    const results = await Promise.all([bob.send("post", `/api/trades/${t.id}/accept`), bob.send("post", `/api/trades/${t.id}/accept`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await bob.send("post", `/api/trades/${t.id}/decline`)).status).toBe(409); // accepted → declined is invalid
  });

  test("acceptance rechecks stock (arrangement-only policy)", async () => {
    const t = (await propose(carol, bob, [{ inventoryItemId: bobBolt.id, quantity: 4 }])).body.trade;
    await bob.send("patch", `/api/inventory/${bobBolt.id}`, { quantity: 2 });
    const res = await bob.send("post", `/api/trades/${t.id}/accept`);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Stock changed/);
    expect((await bob.send("post", `/api/trades/${t.id}/decline`)).body.trade.status).toBe("declined");
  });
});

describe("moderation (4.6) and roles (4.7)", () => {
  let mod;
  let admin;
  let seller;
  let reporter;
  let listing;
  beforeAll(async () => {
    mod = await newPlayer("mod_user");
    admin = await newPlayer("admin_user");
    seller = await newPlayer("shady_seller");
    reporter = await newPlayer("honest_reporter");
    await setRole(mod, "moderator");
    await setRole(admin, "admin");
    listing = await seller.add(LOTUS, 1);
  });

  test("players report listings; only moderators see the queue", async () => {
    const report = await reporter.send("post", "/api/reports", { inventoryItemId: listing.id, reason: "Looks like a proxy." });
    expect(report.status).toBe(201);
    expect((await reporter.send("post", "/api/reports", { reportedUserId: reporter.user.id, reason: "testing self" })).status).toBe(400);
    expect((await reporter.get("/api/moderation/reports")).status).toBe(403);
    const queue = (await mod.get("/api/moderation/reports")).body.reports;
    expect(queue.find((r) => r.id === report.body.report.id)).toMatchObject({ item: { label: expect.stringContaining("Black Lotus") }, target: { username: "shady_seller" } });
  });

  test("AT-10 a moderator removes a listing; proposal snapshots and the audit log remain", async () => {
    const trade = (await reporter.send("post", "/api/trades", { receiverId: seller.user.id, requested: [{ inventoryItemId: listing.id, quantity: 1 }] })).body.trade;
    const res = await mod.send("delete", `/api/moderation/inventory/${listing.id}`, { reason: "Counterfeit listing." });
    expect(res.status).toBe(200);
    expect((await seller.get("/api/inventory")).body.items).toHaveLength(0);
    const snapshot = (await reporter.get(`/api/trades/${trade.id}`)).body.thread[0].requested[0];
    expect(snapshot).toMatchObject({ cardName: "Black Lotus", inventoryItemId: null });
    const { rows } = await pool.query("SELECT action, reason FROM mod_actions WHERE target_item_id = $1", [listing.id]);
    expect(rows).toEqual([{ action: "remove_item", reason: "Counterfeit listing." }]); // 5.2.3
  });

  test("suspension ends sessions and blocks login; moderators can't suspend admins", async () => {
    expect((await mod.send("post", `/api/moderation/users/${admin.user.id}/suspend`, { reason: "Not allowed." })).status).toBe(403);
    expect((await mod.send("post", `/api/moderation/users/${seller.user.id}/suspend`, { reason: "Repeated fakes." })).status).toBe(200);
    expect((await seller.get("/api/inventory")).status).toBe(401);
    expect((await new Player().login(seller.email)).status).toBe(403);
    expect((await mod.get("/api/users/shady_seller")).status).toBe(404);
    expect((await mod.send("post", `/api/moderation/users/${seller.user.id}/unsuspend`, { reason: "Appeal accepted." })).status).toBe(200);
    expect((await new Player().login(seller.email)).status).toBe(200);
  });

  test("admins promote and revoke moderators; others can't", async () => {
    expect((await mod.get("/api/admin/users")).status).toBe(403);
    expect((await admin.send("patch", `/api/admin/users/${reporter.user.id}/role`, { role: "moderator" })).body.user.role).toBe("moderator");
    expect((await reporter.get("/api/moderation/reports")).status).toBe(200);
    expect((await admin.send("patch", `/api/admin/users/${reporter.user.id}/role`, { role: "user" })).body.user.role).toBe("user");
    expect((await reporter.get("/api/moderation/reports")).status).toBe(403);
    expect((await admin.send("patch", `/api/admin/users/${admin.user.id}/role`, { role: "user" })).status).toBe(400);
    expect((await admin.send("patch", `/api/admin/users/${reporter.user.id}/role`, { role: "admin" })).status).toBe(400);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM mod_actions WHERE action = 'set_role'");
    expect(rows[0].n).toBe(2);
  });
});

describe("account deletion (4.2.4)", () => {
  test("anonymizes the account, removes listings and keeps trade snapshots", async () => {
    const leaver = await newPlayer("leaving_user");
    const partner = await newPlayer("leaving_partner");
    const ring = await leaver.add(RING, 2);
    const trade = (await partner.send("post", "/api/trades", { receiverId: leaver.user.id, requested: [{ inventoryItemId: ring.id, quantity: 1 }] })).body.trade;

    expect((await leaver.send("delete", "/api/account", { password: "wrong" })).status).toBe(400);
    expect((await leaver.send("delete", "/api/account", { password: PASSWORD })).status).toBe(204);
    expect((await leaver.get("/api/inventory")).status).toBe(401);
    expect((await new Player().login(leaver.email)).status).toBe(401);
    expect((await partner.get("/api/users/leaving_user")).status).toBe(404);
    const thread = (await partner.get(`/api/trades/${trade.id}`)).body.thread;
    expect(thread[0]).toMatchObject({ status: "declined", receiver: { username: `deleted-${leaver.user.id}` }, requested: [{ cardName: "Sol Ring" }] });
  });

  test("the want list goes with the account", async () => {
    const leaver = await newPlayer("leaving_wanter");
    await leaver.send("post", "/api/wants", { printingId: LOTUS });
    expect((await leaver.send("delete", "/api/account", { password: PASSWORD })).status).toBe(204);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM want_items WHERE user_id = $1", [leaver.user.id]);
    expect(rows[0].n).toBe(0);
  });
});

describe("Canada-wide distance search and meetup ranges", () => {
  let viewer;
  beforeAll(async () => {
    viewer = await newPlayer("radius_viewer", "Hamilton, ON");
    const near = await newPlayer("radius_burlington", "Burlington, ON"); // about 15 km away
    const far = await newPlayer("radius_toronto", "Toronto, ON"); // about 60 km away
    const west = await newPlayer("radius_vancouver", "Vancouver, BC");
    for (const p of [near, far, west]) await p.add(RING, 1, { condition: "LP" });
  });
  const ringSearch = async (q) => (await viewer.get(`/api/search?name=sol%20ring&condition=LP&${q}`)).body;

  test("a radius around a city includes nearby cities only, with distances", async () => {
    const res = await ringSearch("city=Hamilton%2C%20ON&radius=25");
    expect(res.results.map((r) => r.owner.username)).toEqual(["radius_burlington"]);
    expect(res.results[0].distanceKm).toBeGreaterThan(5);
    expect(res.results[0].distanceKm).toBeLessThan(25);
    expect((await ringSearch("city=Hamilton%2C%20ON&radius=100")).results.map((r) => r.owner.username).sort()).toEqual(["radius_burlington", "radius_toronto"]);
  });

  test("nearest first works from the viewer's own city across the country", async () => {
    const names = (await ringSearch("sort=distance")).results.map((r) => r.owner.username);
    expect(names).toEqual(["radius_burlington", "radius_toronto", "radius_vancouver"]);
  });

  test("the map gets per-city totals for the same filters", async () => {
    const { cities } = (await viewer.get("/api/search/cities?name=sol%20ring&condition=LP")).body;
    expect(cities).toEqual(expect.arrayContaining([{ city: "Vancouver, BC", listings: 1, players: 1 }]));
  });

  test("players set a meetup range that shows on their profile", async () => {
    expect((await viewer.send("patch", "/api/account/travel", { travelKm: 0 })).status).toBe(400);
    expect((await viewer.send("patch", "/api/account/travel", { travelKm: 50 })).body.user.travelKm).toBe(50);
    const other = await newPlayer("radius_profile_check", "Burlington, ON");
    const profile = (await other.get("/api/users/radius_viewer")).body.user;
    expect(profile).toMatchObject({ travelKm: 50, city: "Hamilton, ON" });
    expect(profile.distanceKm).toBeGreaterThan(5);
    expect((await viewer.send("patch", "/api/account/travel", { travelKm: null })).body.user.travelKm).toBeNull();
  });
});

describe("partner game stores as meetup spots", () => {
  let admin;
  let alice;
  let bob;
  let store;
  beforeAll(async () => {
    admin = await newPlayer("store_admin");
    await setRole(admin, "admin");
    alice = await newPlayer("store_alice", "Hamilton, ON");
    bob = await newPlayer("store_bob", "Burlington, ON");
    bob.item = await bob.add(BOLT, 2);
  });

  test("only admins add stores; input is validated; every change is logged", async () => {
    const body = { name: "Hammer Games", address: "1 King St W", city: "Hamilton, ON", website: "https://example.test", lat: "43.26", lng: "-79.87" };
    expect((await alice.send("post", "/api/stores", body)).status).toBe(403);
    const bad = await admin.send("post", "/api/stores", { ...body, city: "Gotham", website: "http://insecure.test", lat: "43", lng: "" });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(["city", "lat", "website"]);
    const res = await admin.send("post", "/api/stores", body);
    expect(res.status).toBe(201);
    store = res.body.store;
    expect(store).toMatchObject({ name: "Hammer Games", lat: 43.26, lng: -79.87, active: true });
    const { rows } = await pool.query("SELECT action FROM mod_actions WHERE actor_id = $1", [admin.user.id]);
    expect(rows.map((r) => r.action)).toContain("store_added");
  });

  test("stores list what they offer, a perk, hours and the account the store runs, on their own page", async () => {
    const owner = await newPlayer("hammer_games_owner", "Hamilton, ON");
    await owner.add(RING, 1);
    const bad = await admin.send("patch", `/api/stores/${store.id}`, { tags: ["trade_night", "casino"], perk: "x".repeat(201), accountUsername: "nobody_at_all" });
    expect(Object.keys(bad.body.fields).sort()).toEqual(["perk", "tags"]);
    expect((await admin.send("patch", `/api/stores/${store.id}`, { accountUsername: "nobody_at_all" })).body.fields).toHaveProperty("accountUsername");
    const res = await admin.send("patch", `/api/stores/${store.id}`, {
      tags: ["trade_night", "commander", "trade_night"],
      featured: true,
      perk: "10% off singles for Tap to Trade players",
      hours: "Trade night Fridays 6-10 pm",
      accountUsername: "Hammer_Games_Owner",
    });
    expect(res.status).toBe(200);
    expect(res.body.store).toMatchObject({ tags: ["trade_night", "commander"], featured: true, account: "hammer_games_owner", path: `/stores/${store.id}-hammer-games` });

    // A second store can't claim the same account.
    const other = await admin.send("post", "/api/stores", { name: "Other Games", address: "2 Main St E", city: "Hamilton, ON", accountUsername: "hammer_games_owner" });
    expect(other.status).toBe(409);

    const page = await new Player().get(`/api/stores/${store.id}-any-old-name`);
    expect(page.status).toBe(200);
    expect(page.body.store).toMatchObject({ name: "Hammer Games", perk: "10% off singles for Tap to Trade players", hours: "Trade night Fridays 6-10 pm" });
    expect(page.body.nearby).toMatchObject({ radiusKm: 25, players: expect.any(Number), listings: expect.any(Number) });
    expect(page.body.nearby.listings).toBeGreaterThan(0);
    expect((await new Player().get("/api/stores/999999")).status).toBe(404);
    expect((await new Player().get("/api/stores?featured=1")).body.stores.map((s) => s.name)).toEqual(["Hammer Games"]);

    // The store's account gets a badge on its profile and its listings.
    expect((await alice.get("/api/users/hammer_games_owner")).body.user.store).toEqual({ id: store.id, name: "Hammer Games", path: `/stores/${store.id}-hammer-games` });
    const found = (await alice.get("/api/search?name=Sol%20Ring")).body.results.find((r) => r.owner.username === "hammer_games_owner");
    expect(found.owner.store.name).toBe("Hammer Games");
    expect((await new Player().get("/sitemap.xml")).text).toContain(`/stores/${store.id}-hammer-games</loc>`);
  });

  test("players see active stores near a city, nearest first", async () => {
    const near = (await bob.get("/api/stores?city=Burlington%2C%20ON&radius=25")).body.stores;
    expect(near.map((s) => s.name)).toEqual(["Hammer Games"]);
    expect(near[0].distanceKm).toBeGreaterThan(5);
    expect((await bob.get("/api/stores?city=Vancouver%2C%20BC&radius=50")).body.stores).toEqual([]);
  });

  test("a proposal can suggest a store; retired stores can't be picked", async () => {
    const lines = [{ inventoryItemId: bob.item.id, quantity: 1 }];
    const res = await alice.send("post", "/api/trades", { receiverId: bob.user.id, requested: lines, meetupStoreId: store.id });
    expect(res.status).toBe(201);
    expect(res.body.trade.meetupSpot).toMatchObject({ id: store.id, name: "Hammer Games", city: "Hamilton, ON" });
    expect((await bob.get(`/api/trades/${res.body.trade.id}`)).body.thread[0].meetupSpot.name).toBe("Hammer Games");

    expect((await admin.send("patch", `/api/stores/${store.id}`, { active: false })).body.store.active).toBe(false);
    const retired = await alice.send("post", "/api/trades", { receiverId: bob.user.id, requested: lines, meetupStoreId: store.id });
    expect(retired.status).toBe(400);
    expect((await bob.get("/api/stores")).body.stores).toEqual([]);
    expect((await admin.get("/api/stores/all")).body.stores).toHaveLength(1);
  });
});

describe("store events calendar", () => {
  let admin;
  let owner;
  let stranger;
  let store;
  // A few days from now, in the store's own time zone.
  const soon = nextDay(localParts(new Date(), "America/Toronto").date, 3);
  const night = { title: "Friday trade night", kind: "trade_night", date: soon, startTime: "18:00", endTime: "22:00", cost: "Free" };
  beforeAll(async () => {
    admin = await newPlayer("events_admin");
    await setRole(admin, "admin");
    owner = await newPlayer("knight_store_owner", "Hamilton, ON");
    stranger = await newPlayer("events_stranger", "Hamilton, ON");
    store = (await admin.send("post", "/api/stores", { name: "Knight Games", address: "10 James St N", city: "Hamilton, ON", accountUsername: "knight_store_owner" })).body.store;
  });

  test("only admins and the store's own account post events; input is validated", async () => {
    expect((await new Player().init().then((p) => p.send("post", `/api/stores/${store.id}/events`, night))).status).toBe(401);
    expect((await stranger.send("post", `/api/stores/${store.id}/events`, night)).status).toBe(403);
    const bad = await owner.send("post", `/api/stores/${store.id}/events`, { ...night, kind: "rave", date: "2020-01-01", repeatWeeks: 40 });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(["date", "kind", "repeatWeeks"]);
    expect((await owner.send("post", "/api/stores/999999/events", night)).status).toBe(404);

    const res = await owner.send("post", `/api/stores/${store.id}/events`, { ...night, repeatWeeks: 3 });
    expect(res.status).toBe(201);
    expect(res.body.events.map((e) => e.date)).toEqual([soon, nextDay(soon, 7), nextDay(soon, 14)]);
    // Same local time every week, even if daylight saving time ends in between.
    expect(res.body.events.every((e) => e.startTime === "18:00" && e.endTime === "22:00" && e.timeZone === "America/Toronto")).toBe(true);
    const admins = await admin.send("post", `/api/stores/${store.id}/events`, { ...night, title: "Prerelease", kind: "prerelease", date: nextDay(soon, 1), startTime: "10:00", endTime: "" });
    expect(admins.status).toBe(201);
    const { rows } = await pool.query("SELECT action FROM mod_actions WHERE actor_id = ANY($1)", [[owner.user.id, admin.user.id]]);
    expect(rows.map((r) => r.action)).toContain("store_event_added");
  });

  test("store pages and the directory show upcoming events; managers get edit rights", async () => {
    const page = (await new Player().get(`/api/stores/${store.id}`)).body;
    expect(page.canManage).toBe(false);
    expect(page.events.map((e) => e.title)).toEqual(["Friday trade night", "Prerelease", "Friday trade night", "Friday trade night"]);
    expect(page.events[1]).toMatchObject({ kind: "prerelease", startTime: "10:00", endTime: "", endsAt: null });
    expect((await owner.get(`/api/stores/${store.id}`)).body.canManage).toBe(true);
    expect((await admin.get(`/api/stores/${store.id}`)).body.canManage).toBe(true);
    expect((await stranger.get(`/api/stores/${store.id}`)).body.canManage).toBe(false);

    const listed = (await new Player().get("/api/stores")).body.stores.find((s) => s.id === store.id);
    expect(listed.nextEvents.map((e) => e.title)).toEqual(["Friday trade night", "Prerelease"]);
    // Store pages carry the events as schema.org data for search engines.
    expect((await new Player().get(`/stores/${store.id}-knight-games`)).text).toContain('"@type":"Event"');
  });

  test("events can be edited, cancelled and removed, by managers only", async () => {
    const [first, prerelease] = (await owner.get(`/api/stores/${store.id}`)).body.events;
    expect((await stranger.send("patch", `/api/stores/${store.id}/events/${first.id}`, { cancelled: true })).status).toBe(403);
    expect((await owner.send("patch", `/api/stores/${store.id}/events/${first.id}`, { startTime: "19:00" })).status).toBe(400); // needs the date too
    const moved = await owner.send("patch", `/api/stores/${store.id}/events/${first.id}`, { date: first.date, startTime: "19:00", endTime: "01:00", title: "Late trade night" });
    expect(moved.body.event).toMatchObject({ title: "Late trade night", startTime: "19:00", endTime: "01:00" });
    expect(new Date(moved.body.event.endsAt) - new Date(moved.body.event.startsAt)).toBe(6 * 3600_000);
    expect((await owner.send("patch", `/api/stores/${store.id}/events/${prerelease.id}`, { cancelled: true })).body.event.cancelled).toBe(true);
    // Cancelled events stay on the store page (marked) but leave the directory's "next events".
    const listed = (await new Player().get("/api/stores")).body.stores.find((s) => s.id === store.id);
    expect(listed.nextEvents.map((e) => e.title)).not.toContain("Prerelease");

    expect((await stranger.send("delete", `/api/stores/${store.id}/events/${first.id}`)).status).toBe(403);
    expect((await owner.send("delete", `/api/stores/${store.id}/events/${first.id}`)).status).toBe(204);
    expect((await owner.send("delete", `/api/stores/${store.id}/events/${first.id}`)).status).toBe(404);
    // Another store's event can't be reached through this store.
    const other = (await admin.send("post", "/api/stores", { name: "Other Knight", address: "11 James St N", city: "Hamilton, ON" })).body.store;
    expect((await admin.send("patch", `/api/stores/${other.id}/events/${prerelease.id}`, { cancelled: false })).status).toBe(404);
  });

  test("anyone can subscribe to a store's events or download one as a calendar file", async () => {
    const feed = await new Player().get(`/api/stores/${store.id}/events.ics`);
    expect(feed.status).toBe(200);
    expect(feed.headers["content-type"]).toMatch(/^text\/calendar/);
    expect(feed.text).toContain("X-WR-CALNAME:Knight Games events");
    expect(feed.text).toContain("STATUS:CANCELLED");
    expect(feed.text.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    const [one] = (await new Player().get(`/api/stores/${store.id}`)).body.events;
    const single = await new Player().get(`/api/stores/${store.id}/events/${one.id}.ics`);
    expect(single.status).toBe(200);
    expect(single.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect((await new Player().get(`/api/stores/${store.id}/events/999999.ics`)).status).toBe(404);

    // Retired stores take their events with them.
    await admin.send("patch", `/api/stores/${store.id}`, { active: false });
    expect((await new Player().get(`/api/stores/${store.id}/events.ics`)).status).toBe(404);
    expect((await owner.send("post", `/api/stores/${store.id}/events`, night)).status).toBe(404);
  });
});

describe("Continue with Google", () => {
  // Starts a sign-in and returns the state the server sent to "Google".
  const start = async (p) => {
    const res = await p.get("/api/auth/google");
    expect(res.status).toBe(302);
    return new URL(res.headers.location).searchParams.get("state");
  };
  const callback = (p, state, code = "one-time-code") => p.get(`/api/auth/google/callback?code=${code}&state=${state}`);

  test("a new player confirms a username and city, and gets an account without a password", async () => {
    const p = await new Player().init();
    exchangeCode.mockResolvedValueOnce({ sub: "g-new-1", email: "New.Player@Gmail.com" });
    const res = await callback(p, await start(p));
    expect(res.headers.location).toBe("/register/google");
    expect((await p.get("/api/auth/google/pending")).body.email).toBe("new.player@gmail.com");
    await p.init(); // pick up the CSRF token for this session
    const bad = await p.send("post", "/api/auth/google/complete", { username: "x", city: "Gotham" });
    expect(Object.keys(bad.body.fields).sort()).toEqual(["city", "username"]);
    const done = p.track(await p.send("post", "/api/auth/google/complete", { username: "google_newbie", city: "Halifax, NS" }));
    expect(done.status).toBe(201);
    expect(done.body.user).toMatchObject({ email: "new.player@gmail.com", emailLogin: false, googleLinked: true, emailVerified: true });
    const { rows: terms } = await pool.query("SELECT terms_version FROM users WHERE id = $1", [done.body.user.id]);
    expect(terms[0].terms_version).toBe(TERMS_UPDATED);
    const welcome = await lastEmailTo("new.player@gmail.com");
    expect(welcome.subject).toBe("Welcome to Tap to Trade, google_newbie");
    expect(welcome.text).not.toContain("verify-email"); // Google already confirmed the address
    // No password yet, so password login can't work, but they can set one without a current password.
    expect((await new Player().login("new.player@gmail.com", "")).status).toBe(400);
    expect((await p.send("patch", "/api/account/email", { email: "other@example.test", currentPassword: "x" })).body.error).toMatch(/Set a password/);
    expect((await p.send("patch", "/api/account/password", { newPassword: "Google@Set1" })).status).toBe(200);
    expect((await new Player().login("new.player@gmail.com", "Google@Set1")).status).toBe(200);
  });

  test("an existing account with the same verified email is linked and signed in", async () => {
    const existing = await newPlayer("google_linker");
    const p = await new Player().init();
    exchangeCode.mockResolvedValueOnce({ sub: "g-link-1", email: existing.email });
    const res = await callback(p, await start(p));
    expect(res.headers.location).toBe("/dashboard");
    expect((await p.get("/api/auth/me")).body.user).toMatchObject({ username: "google_linker", googleLinked: true, emailLogin: true });
    // A different Google account with that email is refused.
    const q = await new Player().init();
    exchangeCode.mockResolvedValueOnce({ sub: "g-someone-else", email: existing.email });
    expect((await callback(q, await start(q))).headers.location).toBe("/login?google=other");
  });

  test("forged state, replayed callbacks and suspended accounts are refused", async () => {
    const p = await new Player().init();
    const state = await start(p);
    expect((await callback(p, "forged")).headers.location).toBe("/login?google=failed");
    expect((await callback(p, state)).headers.location).toBe("/login?google=expired"); // state is single-use

    const suspended = await newPlayer("google_suspended");
    await pool.query("UPDATE users SET status = 'suspended' WHERE id = $1", [suspended.user.id]);
    const q = await new Player().init();
    exchangeCode.mockResolvedValueOnce({ sub: "g-susp-1", email: suspended.email });
    expect((await callback(q, await start(q))).headers.location).toBe("/login?google=suspended");
    expect((await q.get("/api/inventory")).status).toBe(401);
  });
});

describe("collection import and export", () => {
  let p;
  const printing = (id, name, setCode, collectorNumber, finishes) => ({ id, name, setCode, setName: setCode, collectorNumber, imageUrl: null, finishes });
  beforeAll(async () => {
    p = await newPlayer("importer");
    await p.add(BOLT, 1, { finish: "foil" });
  });

  test("imports a Moxfield export, merges with existing listings and reports what it skipped", async () => {
    lookupCollection.mockImplementationOnce(async (entries) => {
      const known = { "sc:m10:146": printing(BOLT, "Lightning Bolt", "m10", "146", ["nonfoil", "foil"]), "sc:c21:263": printing(RING, "Sol Ring", "c21", "263", ["nonfoil", "etched"]) };
      return new Map(entries.filter(([k]) => known[k]).map(([k]) => [k, known[k]]));
    });
    const csv = [
      '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"',
      '"2","0","Lightning Bolt","m10","Near Mint","English","foil","","","146","False","False",""',
      '"1","0","Lightning Bolt","m10","Near Mint","English","foil","","","146","False","False",""',
      '"3","0","Sol Ring","c21","Played","English","foil","","","263","False","False",""',
      '"1","0","Made Up Card","zzz","Near Mint","English","","","","1","False","False",""',
    ].join("\n");
    const res = await p.send("post", "/api/inventory/import", { text: csv, available: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ format: "Moxfield", listings: 2, cards: 6, adjustedFinish: 3, skippedCount: 1 });
    expect(res.body.skipped[0]).toMatchObject({ line: 5, name: "Made Up Card" });

    const items = (await p.get("/api/inventory")).body.items;
    const bolt = items.find((i) => i.printing.id === BOLT);
    expect(bolt).toMatchObject({ quantity: 4, finish: "foil", available: true }); // 1 already listed + 3 imported; visibility kept
    // Sol Ring doesn't come in plain foil, so the import used its first finish, and kept the new listing hidden.
    expect(items.find((i) => i.printing.id === RING)).toMatchObject({ quantity: 3, finish: "nonfoil", condition: "MP", available: false });
  });

  test("rejects empty input and explains when Scryfall is down", async () => {
    expect((await p.send("post", "/api/inventory/import", { text: "   " })).status).toBe(400);
    lookupCollection.mockRejectedValueOnce(new Error("timeout"));
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const res = await p.send("post", "/api/inventory/import", { text: "1 Sol Ring" });
    expect(res.status).toBe(503);
  });

  test("exports a CSV other sites can import", async () => {
    const res = await p.get("/api/inventory/export");
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="taptotrade-collection.csv"/);
    const lines = res.text.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Count,Tradelist Count,Name,Edition,Condition/);
    expect(lines).toEqual(expect.arrayContaining(["4,4,Lightning Bolt,m10,Near Mint,English,foil,,,146,False,False,", "3,0,Sol Ring,c21,Played,English,,,,263,False,False,"]));
  });
});

describe("browsing without an account (Fan Content Policy)", () => {
  beforeAll(async () => {
    const owner = await newPlayer("guest_view_owner", "Guelph, ON");
    await owner.add(BOLT, 2);
  });

  test("visitors can search listings, see the map totals, open profiles and see stores", async () => {
    const anon = await new Player().init();
    const res = await anon.get("/api/search?name=Lightning%20Bolt");
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.owner.username)).toContain("guest_view_owner");
    expect(res.body.results[0].distanceKm).toBeNull(); // no viewer city and no searched city
    expect((await anon.get("/api/search/cities?name=bolt")).status).toBe(200);
    const profile = await anon.get("/api/users/guest_view_owner");
    expect(profile.status).toBe(200);
    expect(profile.body.user.distanceKm).toBeNull();
    expect((await anon.get("/api/stores")).status).toBe(200);
  });

  test("signed-in players still never see their own listings in search", async () => {
    const p = new Player();
    expect((await p.login("guest_view_owner@example.test")).status).toBe(200);
    const res = await p.get("/api/search?name=Lightning%20Bolt");
    expect(res.body.results.map((r) => r.owner.username)).not.toContain("guest_view_owner");
  });

  test("anyone can browse cards and see how many players have each one shared", async () => {
    searchPrintings.mockResolvedValueOnce([
      { id: BOLT, name: "Lightning Bolt", setCode: "m10", imageUrl: null, finishes: ["nonfoil"] },
      { id: RING, name: "Some Unlisted Card", setCode: "c21", imageUrl: null, finishes: ["nonfoil"] },
    ]);
    const anon = await new Player().init();
    const res = await anon.get("/api/cards/browse?q=bolt");
    expect(res.status).toBe(200);
    expect(searchPrintings).toHaveBeenLastCalledWith("bolt", { unique: "cards" });
    expect(res.body.cards[0].players).toBeGreaterThan(0);
    expect(res.body.cards[1].players).toBe(0);
    expect((await anon.get("/api/cards/browse?q=b")).status).toBe(400);
    expect((await anon.get("/api/cards/search?q=bolt")).status).toBe(401); // the add-card search needs a login
  });

  test("card name suggestions are public, with saved names when Scryfall is down", async () => {
    const anon = await new Player().init();
    autocompleteNames.mockResolvedValueOnce(Array.from({ length: 20 }, (_, i) => `Lightning Card ${i}`));
    const res = await anon.get("/api/cards/autocomplete?q=light");
    expect(res.body.names).toHaveLength(10); // trimmed to ten
    expect(autocompleteNames).toHaveBeenLastCalledWith("light");
    autocompleteNames.mockRejectedValueOnce(new Error("Scryfall responded 503"));
    expect((await anon.get("/api/cards/autocomplete?q=lightning%20b")).body.names).toEqual(["Lightning Bolt"]);
    expect((await anon.get("/api/cards/autocomplete?q=l")).body.names).toEqual([]); // too short: no request
    expect(autocompleteNames).toHaveBeenCalledTimes(2);
  });

  test("card details are public; bad ids 404 and a Scryfall outage is a 503", async () => {
    const anon = await new Player().init();
    cardDetails.mockResolvedValueOnce({ id: BOLT, name: "Lightning Bolt", rulings: [] });
    expect((await anon.get(`/api/cards/${BOLT}`)).body.card.name).toBe("Lightning Bolt");
    expect((await anon.get("/api/cards/not-a-uuid")).status).toBe(404);
    cardDetails.mockResolvedValueOnce(null);
    expect((await anon.get(`/api/cards/${LOTUS}`)).status).toBe(404);
    cardDetails.mockRejectedValueOnce(new Error("timeout"));
    expect((await anon.get(`/api/cards/${RING}`)).status).toBe(503);
  });

  test("the showcase sends random cards, falling back to cards in our own database", async () => {
    const anon = await new Player().init();
    showcasePool.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, name: `Card ${i}`, setCode: "abc", imageUrl: `https://cards.scryfall.io/${i}.jpg` })));
    const res = await anon.get("/api/cards/showcase?count=5");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.cards).toHaveLength(5);
    expect(new Set(res.body.cards.map((c) => c.id)).size).toBe(5);
    await pool.query("UPDATE card_printings SET image_url = 'https://cards.scryfall.io/x.jpg' WHERE id = $1", [BOLT]);
    showcasePool.mockRejectedValueOnce(new Error("down"));
    const fallback = await anon.get("/api/cards/showcase?count=5");
    expect(fallback.status).toBe(200);
    expect(fallback.body.cards.map((c) => c.name)).toEqual(["Lightning Bolt"]);
  });
});

describe("suggestions", () => {
  let player;
  let mod;
  beforeAll(async () => {
    player = await newPlayer("ideas_player");
    mod = await newPlayer("ideas_mod");
    await setRole(mod, "moderator");
  });

  test("players send suggestions and see them; input is validated", async () => {
    expect((await player.send("post", "/api/suggestions", { topic: "feature", message: "short" })).body.fields.message).toBeDefined();
    expect((await player.send("post", "/api/suggestions", { topic: "nonsense", message: "A long enough message." })).body.fields.topic).toBeDefined();
    const res = await player.send("post", "/api/suggestions", { topic: "feature", message: "  Please add a filter by set.  " });
    expect(res.status).toBe(201);
    expect(res.body.suggestion).toMatchObject({ topic: "feature", message: "Please add a filter by set.", status: "new" });
    expect(res.body.suggestion.from).toBeUndefined();
    const mine = await player.get("/api/suggestions/mine");
    expect(mine.body.suggestions.map((s) => s.message)).toEqual(["Please add a filter by set."]);
  });

  test("only staff read the inbox and mark suggestions reviewed, once", async () => {
    expect((await player.get("/api/moderation/suggestions")).status).toBe(403);
    const inbox = await mod.get("/api/moderation/suggestions");
    const s = inbox.body.suggestions.find((x) => x.from === "ideas_player");
    expect(s).toBeDefined();
    expect((await player.send("post", `/api/moderation/suggestions/${s.id}/review`)).status).toBe(403);
    expect((await mod.send("post", `/api/moderation/suggestions/${s.id}/review`)).status).toBe(200);
    expect((await mod.send("post", `/api/moderation/suggestions/${s.id}/review`)).status).toBe(409);
    expect((await mod.get("/api/moderation/suggestions?status=reviewed")).body.suggestions.map((x) => x.id)).toContain(s.id);
    expect((await player.get("/api/suggestions/mine")).body.suggestions[0].status).toBe("reviewed");
  });
});

describe("email confirmation and the site's emails", () => {
  test("sign-up sends a thank-you with a confirm link; trades wait for a confirmed email", async () => {
    const owner = await newPlayer("confirm_owner");
    const item = await owner.add(BOLT, 1);
    const p = await newPlayer("confirm_me", "Hamilton, ON", { confirmed: false });
    const welcome = await lastEmailTo(p.email);
    expect(welcome.subject).toBe("Welcome to Tap to Trade, confirm_me");
    expect(welcome.html).toContain("Thanks for joining, confirm_me!");
    expect(welcome.html).toContain("Confirm my email");
    const token = tokenIn(welcome);
    const { rows } = await pool.query("SELECT token_hash FROM email_verifications WHERE user_id = $1", [p.user.id]);
    expect(rows[0].token_hash).not.toBe(token); // only the hash is stored

    const proposal = { receiverId: owner.user.id, requested: [{ inventoryItemId: item.id, quantity: 1 }] };
    const blocked = await p.send("post", "/api/trades", proposal);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/Confirm your email/);

    // A fresh link replaces the old one; links work signed out, once.
    expect((await p.send("post", "/api/account/verify-email")).body.message).toMatch(/We sent a new link/);
    const fresh = tokenIn(await lastEmailTo(p.email));
    const anon = await new Player().init();
    expect((await anon.send("post", "/api/auth/verify-email", { token })).status).toBe(400);
    expect((await anon.send("post", "/api/auth/verify-email", { token: "made-up" })).status).toBe(400);
    expect((await anon.send("post", "/api/auth/verify-email", { token: fresh })).body.message).toMatch(/Email confirmed/);
    expect((await anon.send("post", "/api/auth/verify-email", { token: fresh })).body.message).toMatch(/already confirmed/);
    expect((await p.get("/api/auth/me")).body.user.emailVerified).toBe(true);
    expect((await p.send("post", "/api/account/verify-email")).body.message).toMatch(/already confirmed/);
    expect((await p.send("post", "/api/trades", proposal)).status).toBe(201);
  });

  test("a new email address has to be confirmed again, and links for the old one stop working", async () => {
    const p = await newPlayer("email_mover");
    sendEmail.mockClear();
    const res = await p.send("patch", "/api/account/email", { email: "email_mover_new@example.test", currentPassword: PASSWORD });
    expect(res.body.user).toMatchObject({ email: "email_mover_new@example.test", emailVerified: false });
    const email = await lastEmailTo("email_mover_new@example.test");
    expect(email.subject).toBe("Confirm your email for Tap to Trade");
    // An old unused link (made before the change) no longer confirms anything.
    await pool.query("UPDATE email_verifications SET email = 'email_mover@example.test' WHERE user_id = $1 AND used_at IS NULL", [p.user.id]);
    expect((await p.send("post", "/api/auth/verify-email", { token: tokenIn(email) })).status).toBe(400);
  });

  test("trade emails reach the other player, and respect the opt-out", async () => {
    const a = await newPlayer("mail_alice");
    const b = await newPlayer("mail_bob", "Burlington, ON");
    const bolt = await b.add(BOLT, 2);
    const ring = await a.add(RING, 1);
    sendEmail.mockClear();
    const sent = await a.send("post", "/api/trades", { receiverId: b.user.id, requested: [{ inventoryItemId: bolt.id, quantity: 1 }], message: "Friday at the store?" });
    const toBob = await lastEmailTo(b.email);
    expect(toBob.subject).toBe("mail_alice sent you a trade request");
    expect(toBob.text).toContain("1 × Lightning Bolt (M10 #146, NM)");
    expect(toBob.text).toContain('Message: "Friday at the store?"');
    expect(toBob.text).toContain(`/trades/${sent.body.trade.id}`);

    const counter = await b.send("post", `/api/trades/${sent.body.trade.id}/counter`, {
      requested: [{ inventoryItemId: ring.id, quantity: 1 }],
      offered: [{ inventoryItemId: bolt.id, quantity: 1 }],
    });
    expect((await lastEmailTo(a.email)).subject).toBe("mail_bob sent you a counter-offer");

    // Bob turns trade emails off, so Alice accepting his counter doesn't email him.
    expect((await b.send("patch", "/api/account/notifications", { emailTrades: "no" })).status).toBe(400);
    expect((await b.send("patch", "/api/account/notifications", { emailTrades: false })).body.user.emailTrades).toBe(false);
    sendEmail.mockClear();
    expect((await a.send("post", `/api/trades/${counter.body.trade.id}/accept`)).status).toBe(200);
    expect(await lastEmailTo(b.email)).toBeUndefined();
  });

  test("a new moderator gets an email; admins add text to emails and send themselves a test", async () => {
    const boss = await newPlayer("email_admin");
    await setRole(boss, "admin");
    const helper = await newPlayer("email_helper");
    sendEmail.mockClear();
    const promote = await boss.send("patch", `/api/admin/users/${helper.user.id}/role`, { role: "moderator" });
    expect(promote.body.emailed).toBe(true);
    expect((await lastEmailTo(helper.email)).subject).toBe("You're now a Tap to Trade moderator");

    expect((await helper.get("/api/admin/emails")).status).toBe(403);
    expect((await boss.send("put", "/api/admin/emails/nope", { body: "x" })).status).toBe(404);
    expect((await boss.send("put", "/api/admin/emails/welcome", { body: "x".repeat(1001) })).status).toBe(400);
    expect((await boss.send("put", "/api/admin/emails/welcome", { body: "Thanks {username}! See you at trade night." })).status).toBe(200);
    expect((await boss.send("put", "/api/admin/emails/footer", { body: "Proud partner of Hammer Games." })).status).toBe(200);
    const texts = (await boss.get("/api/admin/emails")).body.texts;
    expect(texts.welcome).toMatchObject({ body: "Thanks {username}! See you at trade night.", updatedBy: "email_admin" });

    const newcomer = await newPlayer("email_newcomer");
    const welcome = sendEmail.mock.calls.map(([m]) => m).find((m) => m.to === newcomer.email && m.subject.startsWith("Welcome"));
    expect(welcome.html).toContain("Thanks email_newcomer! See you at trade night.");
    expect(welcome.text).toContain("Proud partner of Hammer Games.");

    const test = await boss.send("post", "/api/admin/emails/trade_request/test", { body: "Draft text" });
    expect(test.body.message).toMatch(/Test sent to email_admin@example.test/);
    const sample = await lastEmailTo(boss.email);
    expect(sample.subject).toBe("[Test] bolt_burlington sent you a trade request");
    expect(sample.text).toContain("Draft text");
    expect(sample.text).toContain("Proud partner of Hammer Games.");

    expect((await boss.send("put", "/api/admin/emails/footer", { body: "  " })).status).toBe(200); // blank removes it
    expect((await boss.get("/api/admin/emails")).body.texts.footer).toBeUndefined();
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM mod_actions WHERE action = 'email_text_updated' AND actor_id = $1", [boss.user.id]);
    expect(rows[0].n).toBe(3);
  });

  test("account notices: password changed, a listing removed, suspension, reinstatement and a changed email", async () => {
    const mod = await newPlayer("notice_mod");
    await setRole(mod, "moderator");
    const p = await newPlayer("notice_player");
    sendEmail.mockClear();
    expect((await p.send("patch", "/api/account/password", { currentPassword: PASSWORD, newPassword: "Changed@123" })).status).toBe(200);
    expect((await lastEmailTo(p.email)).subject).toBe("Your Tap to Trade password was changed");

    const item = await p.add(BOLT, 1);
    expect((await mod.send("delete", `/api/moderation/inventory/${item.id}`, { reason: "Proxy listed as a real card" })).status).toBe(200);
    const removed = await lastEmailTo(p.email);
    expect(removed.subject).toBe("A moderator removed one of your Tap to Trade listings");
    expect(removed.text).toContain("Lightning Bolt (M10 #146, NM)");

    expect((await mod.send("post", `/api/moderation/users/${p.user.id}/suspend`, { reason: "Repeated proxies" })).status).toBe(200);
    expect((await lastEmailTo(p.email)).subject).toBe("Your Tap to Trade account was suspended");
    expect((await mod.send("post", `/api/moderation/users/${p.user.id}/unsuspend`, { reason: "Appeal accepted" })).status).toBe(200);
    expect((await lastEmailTo(p.email)).subject).toBe("Your Tap to Trade account is active again");

    // The old address hears about an email change, in case someone else made it.
    const oldEmail = p.email;
    await p.login(oldEmail, "Changed@123");
    expect((await p.send("patch", "/api/account/email", { email: "notice_moved@example.test", currentPassword: "Changed@123" })).status).toBe(200);
    const moved = await lastEmailTo(oldEmail);
    expect(moved.subject).toBe("Your Tap to Trade email address was changed");
    expect(moved.text).toContain("notice_moved@example.test");
  });

  test("a declined request tells the sender, reports are acknowledged, and deleting an account says goodbye", async () => {
    const a = await newPlayer("decline_alice");
    const b = await newPlayer("decline_bob");
    const bolt = await b.add(BOLT, 2);
    const sent = await a.send("post", "/api/trades", { receiverId: b.user.id, requested: [{ inventoryItemId: bolt.id, quantity: 1 }] });
    sendEmail.mockClear();
    expect((await b.send("post", `/api/trades/${sent.body.trade.id}/decline`)).status).toBe(200);
    const declined = await lastEmailTo(a.email);
    expect(declined.subject).toBe("decline_bob declined your trade request");
    expect(declined.text).toContain("You asked for:\n- 1 × Lightning Bolt (M10 #146, NM)");

    expect((await a.send("post", "/api/reports", { reportedUserId: b.user.id, reason: "Rude messages" })).status).toBe(201);
    expect((await lastEmailTo(a.email)).text).toContain("thanks for reporting the player decline_bob");

    expect((await a.send("delete", "/api/account", { password: PASSWORD })).status).toBe(204);
    expect((await lastEmailTo(a.email)).subject).toBe("Your Tap to Trade account was deleted");
  });

  test("with Resend templates on, emails name the template; if Resend refuses it, the built-in copy goes instead", async () => {
    const p = await newPlayer("resend_player");
    Object.assign(process.env, { EMAIL_TEMPLATES: "resend", EMAIL_API_KEY: "test-key" });
    try {
      sendEmail.mockClear();
      expect((await p.send("patch", "/api/account/password", { currentPassword: PASSWORD, newPassword: "Resend@123" })).status).toBe(200);
      const first = await lastEmailTo(p.email);
      expect(first.template).toMatchObject({ id: "ttt-password-changed", variables: { USERNAME: "resend_player" } });
      expect(first.subject).toBeUndefined(); // the subject comes from the template in Resend

      sendEmail.mockClear();
      sendEmail.mockResolvedValueOnce(false); // Resend refuses the template (missing, or a value too long)
      expect((await p.send("patch", "/api/account/password", { currentPassword: "Resend@123", newPassword: "Resend@456" })).status).toBe(200);
      await settle();
      const calls = sendEmail.mock.calls.map(([m]) => m).filter((m) => m.to === p.email);
      expect(calls.map((m) => Boolean(m.template))).toEqual([true, false]);
      expect(calls[1].subject).toBe("Your Tap to Trade password was changed");
    } finally {
      Object.assign(process.env, { EMAIL_TEMPLATES: "", EMAIL_API_KEY: "" });
    }
  });
});

describe("want lists and automatic matches", () => {
  const BOLT_2ED = "f29ba16f-c8fb-42fe-aabf-87089cb214a7"; // a second printing of Lightning Bolt
  let wanter;
  let trader;
  let farAway;
  beforeAll(async () => {
    await pool.query(
      "INSERT INTO card_printings (id, name, set_code, set_name, collector_number, finishes) VALUES ($1, 'Lightning Bolt', '2ed', 'Unlimited Edition', '162', '{nonfoil}')",
      [BOLT_2ED],
    );
    // Nova Scotia, away from every other test's players.
    wanter = await newPlayer("want_halifax", "Halifax, NS");
    trader = await newPlayer("want_dartmouth", "Dartmouth, NS");
    farAway = await newPlayer("want_sydney", "Sydney, NS"); // about 300 km from Halifax
  });

  test("players add, edit and remove wants; input is validated and wants are private", async () => {
    expect((await new Player().init().then((p) => p.get("/api/wants"))).status).toBe(401);
    expect((await wanter.send("post", "/api/wants", { printingId: "nope" })).status).toBe(400);
    expect((await wanter.send("post", "/api/wants", { printingId: LOTUS, quantity: 0 })).body.fields).toHaveProperty("quantity");
    expect((await wanter.send("post", "/api/wants", { printingId: LOTUS, anyPrinting: false, finish: "foil" })).status).toBe(400); // no foil Alpha Lotus

    const res = await wanter.send("post", "/api/wants", { printingId: BOLT, quantity: 4 });
    expect(res.status).toBe(201);
    expect(res.body.want).toMatchObject({ quantity: 4, finish: null, anyPrinting: true, printing: { name: "Lightning Bolt" } });
    // Any printing of the same card is already covered.
    expect((await wanter.send("post", "/api/wants", { printingId: BOLT_2ED })).status).toBe(409);

    const ring = (await wanter.send("post", "/api/wants", { printingId: RING, anyPrinting: false })).body.want;
    expect((await wanter.send("patch", `/api/wants/${ring.id}`, { finish: "etched", quantity: 2 })).body.want).toMatchObject({ finish: "etched", quantity: 2 });
    expect((await trader.send("patch", `/api/wants/${ring.id}`, { quantity: 1 })).status).toBe(404); // not theirs
    expect((await trader.send("delete", `/api/wants/${ring.id}`)).status).toBe(404);
    expect((await wanter.send("delete", `/api/wants/${ring.id}`)).status).toBe(204);
    expect((await wanter.get("/api/wants")).body.wants.map((w) => w.printing.name)).toEqual(["Lightning Bolt"]);
  });

  test("matches show nearby players with any printing you want, and who wants your cards", async () => {
    const old = await trader.add(BOLT_2ED, 1); // another printing still fills an any-printing want
    await trader.add(BOLT, 2, { available: false }); // private listings never match
    await farAway.add(BOLT, 4); // outside the range
    const ring = await wanter.add(RING, 1);
    await trader.send("post", "/api/wants", { printingId: RING, anyPrinting: false, finish: "nonfoil" });

    const { body } = await wanter.get("/api/wants/matches?radius=50");
    expect(body.radius).toBe(50);
    expect(body.players).toHaveLength(1);
    expect(body.players[0]).toMatchObject({
      player: { username: "want_dartmouth", city: "Dartmouth, NS", reputation: { completedTrades: 0, rating: null } },
      mutual: true,
      theyHave: [{ id: old.id, printing: { setCode: "2ed" } }],
      theyWant: [{ id: ring.id, printing: { name: "Sol Ring" } }],
    });
    // The same match from the other side.
    const theirs = (await trader.get("/api/wants/matches?radius=50")).body.players;
    expect(theirs[0]).toMatchObject({ player: { username: "want_halifax" }, theyHave: [{ id: ring.id }], theyWant: [{ id: old.id }] });
    // A wider radius reaches Sydney too.
    expect((await wanter.get("/api/wants/matches?radius=250")).body.players.map((p) => p.player.username)).toEqual(["want_dartmouth"]);
    expect((await wanter.get("/api/wants/matches?radius=500")).body.radius).not.toBe(500); // only the listed radii
  });

  test("players rate accepted trades once; ratings build a public reputation", async () => {
    const lotus = await trader.add(LOTUS, 1);
    const trade = (await wanter.send("post", "/api/trades", { receiverId: trader.user.id, requested: [{ inventoryItemId: lotus.id, quantity: 1 }] })).body.trade;
    expect((await wanter.send("post", `/api/trades/${trade.id}/feedback`, { completed: true, rating: 5 })).status).toBe(409); // not accepted yet
    expect((await trader.send("post", `/api/trades/${trade.id}/accept`)).status).toBe(200);

    const outsider = await newPlayer("want_outsider", "Halifax, NS");
    expect((await outsider.send("post", `/api/trades/${trade.id}/feedback`, { completed: true, rating: 1 })).status).toBe(404);
    expect((await wanter.send("post", `/api/trades/${trade.id}/feedback`, { completed: true, rating: 9 })).status).toBe(400);
    expect((await wanter.send("post", `/api/trades/${trade.id}/feedback`, { completed: true, rating: 4 })).status).toBe(201);
    expect((await wanter.send("post", `/api/trades/${trade.id}/feedback`, { completed: true, rating: 5 })).status).toBe(409); // once
    expect((await trader.send("post", `/api/trades/${trade.id}/feedback`, { completed: false })).status).toBe(201);

    expect((await wanter.get(`/api/trades/${trade.id}`)).body.feedback).toMatchObject({ completed: true, rating: 4 });
    expect((await wanter.get("/api/trades")).body.sent.find((t) => t.id === trade.id).feedbackGiven).toBe(true);
    // The rating shows on the rated player's profile and search results; "didn't happen" never counts.
    expect((await outsider.get("/api/users/want_dartmouth")).body.user.reputation).toEqual({ completedTrades: 1, rating: 4 });
    expect((await outsider.get("/api/users/want_halifax")).body.user.reputation).toEqual({ completedTrades: 0, rating: null });
    const hit = (await outsider.get("/api/search?name=black%20lotus&city=Dartmouth%2C%20NS")).body.results[0];
    expect(hit.owner.reputation).toEqual({ completedTrades: 1, rating: 4 });
  });

  test("confirming a trade happened moves the cards in your own inventory", async () => {
    const rings = await trader.add(RING, 3);
    const bolt = await trader.add(BOLT, 1, { condition: "LP" });
    // The wanter got this Lotus in the rating test above, and it arrived as a private listing.
    const lotus = (await wanter.get("/api/inventory")).body.items.find((i) => i.printing.id === LOTUS);
    expect(lotus).toMatchObject({ quantity: 1, available: false });
    const worn = await wanter.add(BOLT, 2, { condition: "HP" });
    const traderLotus = (await trader.get("/api/inventory")).body.items.find((i) => i.printing.id === LOTUS); // from the rating test
    const trade = (await wanter.send("post", "/api/trades", {
      receiverId: trader.user.id,
      requested: [{ inventoryItemId: rings.id, quantity: 2 }, { inventoryItemId: bolt.id, quantity: 1 }],
      offered: [{ inventoryItemId: lotus.id, quantity: 1 }, { inventoryItemId: worn.id, quantity: 2 }],
    })).body.trade;
    expect((await trader.send("post", `/api/trades/${trade.id}/accept`)).status).toBe(200);
    const has = async (p, item) => (await p.get("/api/inventory")).body.items.find((i) => i.id === item.id);
    expect((await has(trader, rings)).quantity).toBe(3); // accepting removes nothing

    // "It didn't happen" changes nothing; "we traded" removes only that player's own side.
    expect((await wanter.send("post", `/api/trades/${trade.id}/feedback`, { completed: false })).status).toBe(201);
    expect((await has(wanter, lotus)).quantity).toBe(1);
    expect((await trader.send("post", `/api/trades/${trade.id}/feedback`, { completed: true, rating: 5 })).status).toBe(201);
    expect((await has(trader, rings)).quantity).toBe(1); // gave 2 of 3
    expect(await has(trader, bolt)).toBeUndefined(); // gave the only one
    expect((await has(trader, traderLotus)).quantity).toBe(traderLotus.quantity + 1); // got one more of a card they list
    const got = (await trader.get("/api/inventory")).body.items.find((i) => i.printing.id === BOLT && i.condition === "HP");
    expect(got).toMatchObject({ quantity: 2, finish: "nonfoil", available: false }); // new cards start private
    expect(await has(wanter, lotus)).toBeDefined(); // never touches the other player's inventory
    const wanterItems = (await wanter.get("/api/inventory")).body.items;
    expect(wanterItems.find((i) => i.printing.id === RING).quantity).toBe(1); // wanter said it didn't happen: no rings added
    // The proposal keeps its snapshot of the removed listing.
    expect((await trader.get(`/api/trades/${trade.id}`)).body.thread[0].requested.map((l) => l.cardName)).toContain("Lightning Bolt");
  });
});

test("robots.txt, sitemap.xml and llms.txt are real files, not the app page", async () => {
  const p = await new Player().init();
  const robots = await p.get("/robots.txt");
  expect(robots.headers["content-type"]).toMatch(/text\/plain/);
  expect(robots.text).toContain("Disallow: /api/");
  const sitemap = await p.get("/sitemap.xml");
  expect(sitemap.headers["content-type"]).toMatch(/application\/xml/);
  expect(sitemap.text).toContain("<urlset");
  expect((await p.get("/llms.txt")).text).toMatch(/^# Tap to Trade/);
  // Email apps load the logo from their own pages, so brand images allow cross-origin use; the rest don't.
  expect((await p.get("/brand/email-logo.png")).headers["cross-origin-resource-policy"]).toBe("cross-origin");
  expect((await p.get("/robots.txt")).headers["cross-origin-resource-policy"]).toBe("same-origin");
});

test("unknown API routes return a JSON 404 and errors never leak internals (5.2.2)", async () => {
  const p = await new Player().init();
  const res = await p.get("/api/nope");
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: "Not found." });
  const bad = await p.agent.post("/api/auth/login").set("X-CSRF-Token", p.csrf).set("Content-Type", "application/json").send("{bad json");
  expect(bad.status).toBe(400);
  expect(bad.body.error).toBe("Request body is not valid JSON.");
});
