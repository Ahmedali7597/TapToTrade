-- In-app notifications (the bell in the header) and per-kind email choices. Additive only.

-- One row per thing a player should know about: a trade request, counter-offer, answer, message, meetup change
-- or the other player confirming the trade happened. A run of messages in one trade shares one unread row.
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('trade_request', 'trade_counter', 'trade_accepted', 'trade_declined', 'trade_message',
                                           'trade_meetup', 'trade_meetup_confirmed', 'trade_feedback')),
  trade_id   bigint NOT NULL REFERENCES trade_requests (id) ON DELETE CASCADE,
  actor_id   bigint REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Which trade emails a player wants, by kind: {"requests": false, ...}. A missing key means yes, so existing
-- players keep every email they had. email_trades stays the master switch.
ALTER TABLE users ADD COLUMN email_prefs jsonb NOT NULL DEFAULT '{}';
