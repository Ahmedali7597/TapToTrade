-- Messages between the two players on a trade, and the meetup they agree on (Milestone 4 sections 2 and 9.2: a
-- public place, a time with its time zone, and the other player's confirmation; any change needs confirming again).
-- Additive only, so the previous release keeps working against this schema.

-- A message belongs to the whole negotiation (thread_id is its first proposal), so counter-offers keep the history.
CREATE TABLE trade_messages (
  id         bigserial PRIMARY KEY,
  thread_id  bigint NOT NULL REFERENCES trade_requests (id) ON DELETE CASCADE,
  sender_id  bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trade_messages_thread_idx ON trade_messages (thread_id, created_at);

-- One meetup per accepted proposal: a partner store or any other public place, and a time in a named time zone.
CREATE TABLE trade_meetups (
  trade_request_id bigint PRIMARY KEY REFERENCES trade_requests (id) ON DELETE CASCADE,
  meet_at          timestamptz NOT NULL,
  time_zone        text NOT NULL CHECK (char_length(time_zone) BETWEEN 3 AND 60),
  store_id         bigint REFERENCES stores (id),
  place            text CHECK (char_length(place) BETWEEN 2 AND 200),
  proposed_by      bigint NOT NULL REFERENCES users (id),
  confirmed_at     timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (store_id IS NOT NULL OR place IS NOT NULL)
);
