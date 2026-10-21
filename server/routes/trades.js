import { Router } from "express";
import { query, tx, valuesList } from "../db.js";
import { checkFields, HttpError, idParam } from "../lib/http.js";
import { canTransition, lineShapeError, stockErrors } from "../lib/trades.js";
import { feedbackError } from "../lib/reputation.js";
import { tradeNotice, tradeUpdate } from "../lib/notify.js";
import { meetupCalendar, zonedToUtc } from "../lib/events.js";
import { siteUrl } from "../lib/seo.js";
import { formatMeetup, MEETUP_DAYS_AHEAD, meetupProblems } from "../../shared/meetups.js";
import { hasSlur, SLUR_MESSAGE } from "../lib/slurs.js";
import { messageLimiter, requireAuth } from "../middleware.js";

// Trade lifecycle: send -> negotiate with counters -> accept/decline -> report what happened after meeting.
// Each proposal version and its card snapshots are stored in PostgreSQL (4.5.1–4.5.7).
// Stock policy: ARRANGEMENT-ONLY (section 9.2 fallback).
// Acceptance rechecks stock but never reserves or decrements it. Once a player confirms the trade happened,
// the cards they gave leave their inventory and the cards they got are added (see the feedback route at the bottom).
const router = Router();
router.use(requireAuth);

/** Whether `userId` is one of the two players on trade row `t` (its sender or its receiver). */
const isParty = (t, userId) => t.sender_id === userId || t.receiver_id === userId;

// Base query for trade rows, with both players' names and cities joined in for display.
const TRADE_SELECT = `
  SELECT t.*, s.username AS sender_username, s.city AS sender_city,
         r.username AS receiver_username, r.city AS receiver_city,
         st.name AS store_name, st.address AS store_address, st.city AS store_city, st.website AS store_website
    FROM trade_requests t
    JOIN users s ON s.id = t.sender_id
    JOIN users r ON r.id = t.receiver_id
    LEFT JOIN stores st ON st.id = t.meetup_store_id`;

// Turns a snapshot row into the camelCase shape the React app expects.
const lineView = (l) => ({
  id: l.id,
  inventoryItemId: l.inventory_item_id,
  quantity: l.quantity,
  ownerId: l.owner_id,
  printingId: l.printing_id,
  cardName: l.card_name,
  setCode: l.set_code,
  collectorNumber: l.collector_number,
  condition: l.condition,
  finish: l.finish,
  imageUrl: l.image_url,
});

/** Loads trade rows (already selected with TRADE_SELECT) together with their item snapshots. */
async function withItems(rows) {
  const { rows: lines } = await query(
    "SELECT * FROM trade_request_items WHERE trade_request_id = ANY($1) ORDER BY side, card_name, id",
    [rows.map((r) => r.id)],
  );
  return rows.map((t) => {
    const mine = lines.filter((l) => l.trade_request_id === t.id);
    return {
      id: t.id,
      parentId: t.parent_id,
      status: t.status,
      message: t.message,
      // Optional partner store suggested as the meeting place for this version.
      meetupSpot: t.meetup_store_id == null
        ? null
        : { id: t.meetup_store_id, name: t.store_name, address: t.store_address, city: t.store_city, website: t.store_website },
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      sender: { id: t.sender_id, username: t.sender_username, city: t.sender_city },
      receiver: { id: t.receiver_id, username: t.receiver_username, city: t.receiver_city },
      requested: mine.filter((l) => l.side === "requested").map(lineView),
      offered: mine.filter((l) => l.side === "offered").map(lineView),
    };
  });
}

const loadTrade = async (id) => (await withItems((await query(`${TRADE_SELECT} WHERE t.id = $1`, [id])).rows))[0];

/** Reads and shape-checks { requested, offered, message, meetupStoreId } from a request body. */
export function readProposal(body = {}) {
  // Coerce every line to numbers up front; lineShapeError then rejects anything that isn't a clean integer.
  const toLines = (v) =>
    Array.isArray(v) ? v.map((l) => ({ inventoryItemId: Number(l?.inventoryItemId), quantity: Number(l?.quantity) })) : v;
  const requested = toLines(body.requested);
  const offered = toLines(body.offered ?? []);
  const shape = lineShapeError(requested, offered);
  if (shape) throw new HttpError(400, shape);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length > 500) {
    throw new HttpError(400, "Keep the message under 500 characters.", { message: "Too long (500 max)." });
  }
  if (hasSlur(message)) throw new HttpError(400, SLUR_MESSAGE, { message: SLUR_MESSAGE });
  // Optional partner store to meet at; insertProposal checks it exists and is still active.
  const raw = body.meetupStoreId;
  const meetupStoreId = raw === undefined || raw === null || raw === "" ? null : Number(raw);
  if (meetupStoreId !== null && (!Number.isInteger(meetupStoreId) || meetupStoreId <= 0)) {
    throw new HttpError(400, "Choose a meetup spot from the list.", { meetupStoreId: "Choose a meetup spot from the list." });
  }
  return { requested, offered, message: message || null, meetupStoreId };
}

/** Sending or countering a proposal needs a confirmed email, which keeps throwaway accounts from spamming players. */
function requireConfirmedEmail(user) {
  if (!user.email_verified) {
    throw new HttpError(403, "Confirm your email address before sending trade requests. Use the link we emailed you, or send a new one from the banner at the top of the page.");
  }
}

/** Trades need both players to still be active (not suspended or deleted). */
async function assertBothActive(c, a, b) {
  const { rows } = await c.query("SELECT id FROM users WHERE id = ANY($1) AND status = 'active'", [[a, b]]);
  if (rows.length !== 2) throw new HttpError(409, "That player is not available for trades right now.");
}

/**
 * Inserts one proposal version inside transaction `c`, after checking both players are active and every
 * line against current stock (4.5.7). Requested lines come from the receiver; offered lines from the sender.
 */
async function insertProposal(c, { senderId, receiverId, parentId = null, requested, offered, message, meetupStoreId = null }) {
  if (senderId === receiverId) throw new HttpError(400, "You can't send a trade request to yourself.");
  await assertBothActive(c, senderId, receiverId);
  if (meetupStoreId !== null) {
    const { rows: store } = await c.query("SELECT 1 FROM stores WHERE id = $1 AND active", [meetupStoreId]);
    if (!store[0]) throw new HttpError(400, "That meetup spot isn't available any more. Choose another one.");
  }

  // Pull every listing the proposal mentions in one query, then check each line against it.
  const { rows: items } = await c.query(
    `SELECT i.id, i.owner_id, i.quantity, i.condition, i.finish, i.available, i.printing_id,
            p.name AS card_name, p.set_code, p.collector_number, p.image_url
       FROM inventory_items i JOIN card_printings p ON p.id = i.printing_id
      WHERE i.id = ANY($1)`,
    [[...requested, ...offered].map((l) => l.inventoryItemId)],
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const errors = [
    ...stockErrors(requested, byId, receiverId, { requireAvailable: true }),
    ...stockErrors(offered, byId, senderId),
  ];
  if (errors.length) throw new HttpError(400, errors.join(" "));

  // Create the version row first so the lines have something to point at.
  const { rows } = await c.query(
    "INSERT INTO trade_requests (parent_id, sender_id, receiver_id, message, meetup_store_id) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [parentId, senderId, receiverId, message, meetupStoreId],
  );
  const tradeId = rows[0].id;
  const lines = [
    ...requested.map((l) => ["requested", l]),
    ...offered.map((l) => ["offered", l]),
  ];
  // One INSERT for all the lines. Each copies the card details in, so the proposal still reads right if the
  // listing changes or is deleted later.
  const values = valuesList(
    lines.map(([side, l]) => {
      const i = byId.get(l.inventoryItemId);
      return [tradeId, side, i.id, l.quantity, i.owner_id, i.printing_id, i.card_name, i.set_code, i.collector_number, i.condition, i.finish, i.image_url];
    }),
  );
  await c.query(
    `INSERT INTO trade_request_items (trade_request_id, side, inventory_item_id, quantity, owner_id, printing_id,
       card_name, set_code, collector_number, condition, finish, image_url) VALUES ${values.sql}`,
    values.params,
  );
  return tradeId;
}

/** Locks a version for a response. Only its current recipient may act, and only while it is pending. */
async function lockForResponse(c, id, userId, nextStatus) {
  // FOR UPDATE holds the row until the transaction ends, so two clicks on "Accept" can't both win.
  const { rows } = await c.query("SELECT * FROM trade_requests WHERE id = $1 FOR UPDATE", [id]);
  const t = rows[0];
  // Outsiders get a 404 so they can't even tell the trade exists.
  if (!t || !isParty(t, userId)) {
    throw new HttpError(404, "That proposal was not found.");
  }
  if (t.receiver_id !== userId) {
    throw new HttpError(403, "Only the player who received this proposal can respond to it.");
  }
  if (!canTransition(t.status, nextStatus)) throw new HttpError(409, `This proposal is already ${t.status}.`);
  return t;
}

// Inbox: everything the user sent or received, split into two lists for the Trades page.
router.get("/", async (req, res) => {
  // Note: newest 200 versions, no paging; add cursor paging if inboxes grow past that.
  const { rows } = await query(
    `${TRADE_SELECT} WHERE t.sender_id = $1 OR t.receiver_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT 200`,
    [req.user.id],
  );
  // Which accepted trades this player has already said happened (or didn't), so the app can ask about the rest.
  const { rows: given } = await query("SELECT trade_request_id FROM trade_feedback WHERE author_id = $1", [req.user.id]);
  const answered = new Set(given.map((g) => String(g.trade_request_id)));
  const trades = (await withItems(rows)).map((t) => ({ ...t, feedbackGiven: answered.has(String(t.id)) }));
  res.json({
    received: trades.filter((t) => t.receiver.id === req.user.id),
    sent: trades.filter((t) => t.sender.id === req.user.id),
  });
});

/**
 * Every version of the negotiation that `id` belongs to (the first request and each counter-offer), oldest first,
 * with `current` (version `id`), `root` (the first) and `latest` (the newest). Outsiders get a 404, so they can't
 * even tell the trade exists.
 */
async function loadThread(id, userId) {
  // Walk "up" parent links to find the first version, then "down" from there to collect every counter.
  const { rows: ids } = await query(
    `WITH RECURSIVE up AS (
       SELECT id, parent_id FROM trade_requests WHERE id = $1
       UNION ALL SELECT t.id, t.parent_id FROM trade_requests t JOIN up ON t.id = up.parent_id
     ), down AS (
       SELECT id FROM trade_requests WHERE id = (SELECT id FROM up WHERE parent_id IS NULL)
       UNION ALL SELECT t.id FROM trade_requests t JOIN down ON t.parent_id = down.id
     ) SELECT id FROM down`,
    [id],
  );
  const { rows } = await query(`${TRADE_SELECT} WHERE t.id = ANY($1) ORDER BY t.created_at, t.id`, [ids.map((r) => r.id)]);
  const current = rows.find((r) => r.id === id);
  if (!current || !isParty(current, userId)) throw new HttpError(404, "That proposal was not found.");
  return { rows, current, root: rows[0], latest: rows.at(-1) };
}

/** The other player on trade row `t`, seen from `userId`. */
const otherPlayer = (t, userId) =>
  t.sender_id === userId ? { id: t.receiver_id, username: t.receiver_username } : { id: t.sender_id, username: t.sender_username };

// The whole negotiation thread (original + counters), its messages and the meetup, for its two players only.
router.get("/:id", async (req, res) => {
  const id = idParam(req, "That proposal");
  const { rows, root, latest } = await loadThread(id, req.user.id);
  // The viewer's own feedback on this version, if any. The other player's feedback about them stays private.
  const { rows: given } = await query(
    "SELECT completed, rating, created_at FROM trade_feedback WHERE trade_request_id = $1 AND author_id = $2",
    [id, req.user.id],
  );
  const feedback = given[0] ? { completed: given[0].completed, rating: given[0].rating, createdAt: given[0].created_at } : null;
  res.json({
    thread: await withItems(rows),
    currentId: id,
    feedback,
    messages: await threadMessages(root.id),
    // Players can talk while a trade is pending or accepted; once it's declined it's closed.
    canMessage: latest.status === "pending" || latest.status === "accepted",
    meetup: latest.status === "accepted" ? await meetupView(latest.id) : null,
  });
});

// ---- Messages between the two players (for arranging the meetup; Milestone 4 rules out live chat) ----

const messageView = (m) => ({ id: m.id, body: m.body, createdAt: m.created_at, sender: { id: m.sender_id, username: m.username } });

/** Every message in negotiation `rootId`, oldest first. */
const threadMessages = async (rootId) =>
  (
    await query(
      "SELECT m.*, u.username FROM trade_messages m JOIN users u ON u.id = m.sender_id WHERE m.thread_id = $1 ORDER BY m.created_at, m.id",
      [rootId],
    )
  ).rows.map(messageView);

router.post("/:id/messages", messageLimiter, async (req, res) => {
  const { root, latest } = await loadThread(idParam(req, "That proposal"), req.user.id);
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) throw new HttpError(400, "Write a message first.", { body: "Write a message first." });
  if (body.length > 1000) throw new HttpError(400, "Keep messages under 1,000 characters.", { body: "Too long (1,000 max)." });
  if (hasSlur(body)) throw new HttpError(400, SLUR_MESSAGE, { body: SLUR_MESSAGE });
  if (latest.status !== "pending" && latest.status !== "accepted") {
    throw new HttpError(409, "This trade is closed, so it can't get new messages.");
  }
  const other = otherPlayer(latest, req.user.id);
  const message = await tx(async (c) => {
    await assertBothActive(c, req.user.id, other.id);
    // One email covers a burst of messages: skip it if this player already wrote here in the last half hour.
    const { rowCount: wroteRecently } = await c.query(
      "SELECT 1 FROM trade_messages WHERE thread_id = $1 AND sender_id = $2 AND created_at > now() - interval '30 minutes' LIMIT 1",
      [root.id, req.user.id],
    );
    const { rows } = await c.query("INSERT INTO trade_messages (thread_id, sender_id, body) VALUES ($1, $2, $3) RETURNING *", [
      root.id,
      req.user.id,
      body,
    ]);
    return { ...rows[0], username: req.user.username, wroteRecently };
  });
  if (!message.wroteRecently) tradeNotice("trade_message", latest.id, other.id, { from: req.user.username });
  res.status(201).json({ message: messageView(message) });
});

// ---- The meetup: where and when, confirmed by the other player (Milestone 4 section 9.2) ----

/** Where a meetup is, as one line: the partner store's name and address, or the place the players typed. */
const placeLine = (m) => (m.store_name ? `${m.store_name}, ${m.store_address}, ${m.store_city}` : m.place);

/** The meetup for accepted version `tradeId`, or null if none has been suggested. */
async function meetupView(tradeId) {
  const { rows } = await query(
    `SELECT m.*, u.username AS proposer, s.name AS store_name, s.address AS store_address, s.city AS store_city
       FROM trade_meetups m JOIN users u ON u.id = m.proposed_by LEFT JOIN stores s ON s.id = m.store_id
      WHERE m.trade_request_id = $1`,
    [tradeId],
  );
  const m = rows[0];
  if (!m) return null;
  return {
    meetAt: m.meet_at,
    timeZone: m.time_zone,
    when: formatMeetup(m.meet_at, m.time_zone),
    store: m.store_id == null ? null : { id: m.store_id, name: m.store_name, address: m.store_address, city: m.store_city },
    place: placeLine(m),
    proposedBy: { id: m.proposed_by, username: m.proposer },
    confirmedAt: m.confirmed_at,
    updatedAt: m.updated_at,
  };
}

/** The accepted version of the negotiation in the request, for the meetup routes. */
async function acceptedTrade(req) {
  const { latest } = await loadThread(idParam(req, "That proposal"), req.user.id);
  if (latest.status !== "accepted") throw new HttpError(409, "You can plan a meetup once the trade is accepted.");
  return latest;
}

/** Reads { localTime, timeZone, storeId | place } and returns { meetAt, timeZone, storeId, place }, or a 400. */
async function readMeetup(body = {}) {
  const { localTime, timeZone } = body;
  const storeId = body.storeId === undefined || body.storeId === null || body.storeId === "" ? null : Number(body.storeId);
  const place = storeId === null && typeof body.place === "string" ? body.place.trim() : null;
  const problems = meetupProblems({ localTime, timeZone, storeId, place });
  if (storeId !== null && (!Number.isInteger(storeId) || storeId <= 0)) problems.place = "Choose a partner store from the list.";
  if (place && !problems.place && hasSlur(place)) problems.place = SLUR_MESSAGE;
  let meetAt;
  if (!problems.localTime && !problems.timeZone) {
    // The wall-clock time in the chosen zone (daylight saving included), checked against the real current time.
    meetAt = zonedToUtc(...localTime.split("T"), timeZone);
    if (meetAt.getTime() < Date.now() + 30 * 60_000) problems.localTime = "Choose a time at least half an hour from now.";
    else if (meetAt.getTime() > Date.now() + MEETUP_DAYS_AHEAD * 86_400_000) problems.localTime = `Choose a time within the next ${MEETUP_DAYS_AHEAD} days.`;
  }
  checkFields(problems);
  if (storeId !== null) {
    const { rows } = await query("SELECT 1 FROM stores WHERE id = $1 AND active", [storeId]);
    if (!rows[0]) throw new HttpError(400, "That store isn't available any more. Choose another place.", { place: "Choose another place." });
  }
  return { meetAt, timeZone, storeId, place };
}

// Suggest (or change) when and where to meet. Any change needs the other player to confirm again.
router.put("/:id/meetup", async (req, res) => {
  const t = await acceptedTrade(req);
  const m = await readMeetup(req.body);
  await query(
    `INSERT INTO trade_meetups (trade_request_id, meet_at, time_zone, store_id, place, proposed_by, confirmed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, now())
     ON CONFLICT (trade_request_id) DO UPDATE SET meet_at = EXCLUDED.meet_at, time_zone = EXCLUDED.time_zone, store_id = EXCLUDED.store_id,
       place = EXCLUDED.place, proposed_by = EXCLUDED.proposed_by, confirmed_at = NULL, updated_at = now()`,
    [t.id, m.meetAt, m.timeZone, m.storeId, m.place, req.user.id],
  );
  const meetup = await meetupView(t.id);
  tradeNotice("trade_meetup", t.id, otherPlayer(t, req.user.id).id, { from: req.user.username, when: meetup.when, place: meetup.place });
  res.json({ meetup });
});

// The other player confirms the meetup as suggested.
router.post("/:id/meetup/confirm", async (req, res) => {
  const t = await acceptedTrade(req);
  const { rows } = await query(
    "UPDATE trade_meetups SET confirmed_at = now() WHERE trade_request_id = $1 AND proposed_by <> $2 AND confirmed_at IS NULL RETURNING proposed_by",
    [t.id, req.user.id],
  );
  if (!rows[0]) throw new HttpError(409, "There's no meetup waiting for you to confirm.");
  const meetup = await meetupView(t.id);
  tradeNotice("trade_meetup_confirmed", t.id, rows[0].proposed_by, { from: req.user.username, when: meetup.when, place: meetup.place });
  res.json({ meetup });
});

// A confirmed meetup as a calendar file, for either player's calendar app.
router.get("/:id/meetup.ics", async (req, res) => {
  const t = await acceptedTrade(req);
  const meetup = await meetupView(t.id);
  if (!meetup?.confirmedAt) throw new HttpError(404, "There's no confirmed meetup for this trade yet.");
  const other = otherPlayer(t, req.user.id).username;
  const ics = meetupCalendar({ tradeId: t.id, meetAt: meetup.meetAt, place: meetup.place, other, updatedAt: meetup.updatedAt }, siteUrl());
  res.type("text/calendar").set("Content-Disposition", `attachment; filename="tap-to-trade-meetup-${t.id}.ics"`).send(ics);
});

// Send a brand new request. The transaction validates both players' stock and saves the proposal plus snapshots.
router.post("/", async (req, res) => {
  requireConfirmedEmail(req.user);
  const receiverId = Number(req.body?.receiverId);
  if (!Number.isInteger(receiverId) || receiverId <= 0) throw new HttpError(400, "Choose who to trade with.");
  const proposal = readProposal(req.body);
  const tradeId = await tx((c) => insertProposal(c, { senderId: req.user.id, receiverId, ...proposal }));
  tradeUpdate("trade_request", tradeId);
  res.status(201).json({ trade: await loadTrade(tradeId) });
});

// Counter-offer: the recipient sends back a new version with the roles swapped, and the old one is closed.
router.post("/:id/counter", async (req, res) => {
  const id = idParam(req, "That proposal");
  requireConfirmedEmail(req.user);
  const proposal = readProposal(req.body);
  const tradeId = await tx(async (c) => {
    const parent = await lockForResponse(c, id, req.user.id, "countered");
    const newId = await insertProposal(c, {
      senderId: req.user.id,
      receiverId: parent.sender_id,
      parentId: parent.id,
      ...proposal,
    });
    await c.query("UPDATE trade_requests SET status = 'countered', updated_at = now() WHERE id = $1", [parent.id]);
    return newId;
  });
  tradeUpdate("trade_counter", tradeId);
  res.status(201).json({ trade: await loadTrade(tradeId) });
});

// Accept: re-check that every card is still there in the right amount. Nothing is reserved or removed yet.
router.post("/:id/accept", async (req, res) => {
  const id = idParam(req, "That proposal");
  await tx(async (c) => {
    const t = await lockForResponse(c, id, req.user.id, "accepted");
    const { rows: lines } = await c.query(
      `SELECT l.card_name, l.quantity, l.owner_id, i.quantity AS stock, i.owner_id AS stock_owner
         FROM trade_request_items l LEFT JOIN inventory_items i ON i.id = l.inventory_item_id
        WHERE l.trade_request_id = $1`,
      [t.id],
    );
    // A line is "short" if the listing was deleted, changed owner, or dropped below the agreed quantity.
    const short = lines.filter((l) => l.stock == null || l.stock_owner !== l.owner_id || l.stock < l.quantity);
    if (short.length) {
      throw new HttpError(
        409,
        `Stock changed since this proposal was sent (${short.map((l) => l.card_name).join(", ")}). Send a counter-offer instead.`,
      );
    }
    await assertBothActive(c, t.sender_id, t.receiver_id);
    await c.query("UPDATE trade_requests SET status = 'accepted', updated_at = now() WHERE id = $1", [t.id]);
  });
  tradeUpdate("trade_accepted", id);
  res.json({ trade: await loadTrade(id) });
});

// Decline: just closes the version. The sender can always start a new request.
router.post("/:id/decline", async (req, res) => {
  const id = idParam(req, "That proposal");
  await tx(async (c) => {
    await lockForResponse(c, id, req.user.id, "declined");
    await c.query("UPDATE trade_requests SET status = 'declined', updated_at = now() WHERE id = $1", [id]);
  });
  tradeUpdate("trade_declined", id);
  res.json({ trade: await loadTrade(id) });
});

// After meeting: either player says whether an accepted trade happened and, if it did, rates the other player
// 1-5 stars. One answer each, final. It counts towards the other player's completed trades and rating, and
// "it happened" also moves the cards in this player's own inventory (never the other player's).
router.post("/:id/feedback", async (req, res) => {
  const id = idParam(req, "That proposal");
  const completed = req.body?.completed;
  const rating = req.body?.rating ?? null;
  const problem = feedbackError({ completed, rating });
  if (problem) throw new HttpError(400, problem);
  const { rows } = await query("SELECT sender_id, receiver_id, status FROM trade_requests WHERE id = $1", [id]);
  const t = rows[0];
  if (!t || !isParty(t, req.user.id)) {
    throw new HttpError(404, "That proposal was not found.");
  }
  if (t.status !== "accepted") throw new HttpError(409, "You can only rate a trade after the offer is accepted.");
  const subjectId = t.sender_id === req.user.id ? t.receiver_id : t.sender_id;
  await tx(async (c) => {
    await c.query(
      "INSERT INTO trade_feedback (trade_request_id, author_id, subject_id, completed, rating) VALUES ($1, $2, $3, $4, $5)",
      [id, req.user.id, subjectId, completed, completed ? rating : null],
    ).catch((err) => {
      if (err.code === "23505") throw new HttpError(409, "You've already given feedback on this trade.");
      throw err;
    });
    if (completed) {
      await removeGivenCards(c, id, req.user.id);
      await addReceivedCards(c, id, req.user.id);
    }
  });
  res.status(201).json({ feedback: { completed, rating: completed ? rating : null } });
});

/**
 * Takes the cards `userId` gave in trade `tradeId` off their inventory: a listing they gave all of is deleted,
 * otherwise its quantity goes down (never below zero). A listing they already deleted is skipped.
 */
async function removeGivenCards(c, tradeId, userId) {
  // Each line of the trade this player gave, joined to the listing it came from (if they still own it).
  const mine = "l.trade_request_id = $1 AND l.owner_id = $2 AND i.id = l.inventory_item_id AND i.owner_id = $2";
  await c.query(`DELETE FROM inventory_items i USING trade_request_items l WHERE ${mine} AND i.quantity <= l.quantity`, [tradeId, userId]);
  await c.query(
    `UPDATE inventory_items i SET quantity = i.quantity - l.quantity, updated_at = now()
       FROM trade_request_items l WHERE ${mine} AND i.quantity > l.quantity`,
    [tradeId, userId],
  );
}

/**
 * Adds the cards `userId` got in trade `tradeId` to their inventory, as private listings so nothing shows up in
 * search until they choose to share it. Getting more of a card they already list adds to that listing instead.
 */
async function addReceivedCards(c, tradeId, userId) {
  await c.query(
    `INSERT INTO inventory_items (owner_id, printing_id, quantity, condition, finish, available)
     SELECT $2, printing_id, LEAST(quantity, 9999), condition, finish, false
       FROM trade_request_items WHERE trade_request_id = $1 AND owner_id <> $2
     ON CONFLICT (owner_id, printing_id, condition, finish)
     DO UPDATE SET quantity = LEAST(inventory_items.quantity + EXCLUDED.quantity, 9999), updated_at = now()`,
    [tradeId, userId],
  );
}

export default router;
