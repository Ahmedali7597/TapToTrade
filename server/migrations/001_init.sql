-- Tap to Trade schema: the April seven-table ERD plus the section 9.1/9.2 amendments
-- (card_printings, proposal versions with snapshots, hashed reset tokens, persistent sessions).

-- pg_trgm gives us fast "contains" / fuzzy matching on card names for the search page.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Every account, including moderators and admins. Deleted users are anonymized, not removed,
-- so old trades and reports still point at a real row.
CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,              -- stored normalized (trimmed, lower-case)
  username      text NOT NULL,
  password_hash text NOT NULL,                     -- Argon2id; never plain text (5.1.1)
  city          text NOT NULL,
  role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator', 'admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Usernames are unique ignoring case ("Bob" and "bob" can't both exist).
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

-- Stable printing identity (Scryfall id). Only metadata and image URLs, never image binaries.
CREATE TABLE card_printings (
  id               uuid PRIMARY KEY,
  name             text NOT NULL,
  set_code         text NOT NULL,
  set_name         text,
  collector_number text NOT NULL,
  image_url        text,
  finishes         text[] NOT NULL DEFAULT '{nonfoil,foil}',     -- finishes this printing was made in (Scryfall)
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_printings_name_trgm ON card_printings USING gin (name gin_trgm_ops);

-- One row per card a player owns, per condition and finish (a foil and a non-foil copy are separate rows). "available" decides whether others can see it.
CREATE TABLE inventory_items (
  id          bigserial PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  printing_id uuid NOT NULL REFERENCES card_printings (id),
  quantity    integer NOT NULL CHECK (quantity > 0 AND quantity <= 9999),   -- 4.3.4
  condition   text NOT NULL CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
  finish      text NOT NULL DEFAULT 'nonfoil' CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  available   boolean NOT NULL DEFAULT true,                                  -- shared for trade
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, printing_id, condition, finish)
);
-- Search only ever looks at shared listings, so a partial index keeps it small.
CREATE INDEX inventory_items_printing_idx ON inventory_items (printing_id) WHERE available;

-- Each row is one immutable proposal version. A counter creates a child row; the parent becomes 'countered'.
CREATE TABLE trade_requests (
  id          bigserial PRIMARY KEY,
  parent_id   bigint REFERENCES trade_requests (id),
  sender_id   bigint NOT NULL REFERENCES users (id),
  receiver_id bigint NOT NULL REFERENCES users (id),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'countered')),
  message     text CHECK (char_length(message) <= 500),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> receiver_id)
);
-- A version can be countered at most once, which stops two counters racing each other.
CREATE UNIQUE INDEX trade_requests_one_continuation ON trade_requests (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX trade_requests_sender_idx ON trade_requests (sender_id, created_at DESC);
CREATE INDEX trade_requests_receiver_idx ON trade_requests (receiver_id, created_at DESC);

-- 'requested' lines come from the receiver's inventory, 'offered' lines from the sender's.
-- Snapshot columns keep what both parties reviewed readable after a listing changes or is removed.
CREATE TABLE trade_request_items (
  id                bigserial PRIMARY KEY,
  trade_request_id  bigint NOT NULL REFERENCES trade_requests (id) ON DELETE CASCADE,
  side              text NOT NULL CHECK (side IN ('requested', 'offered')),
  inventory_item_id bigint REFERENCES inventory_items (id) ON DELETE SET NULL,
  quantity          integer NOT NULL CHECK (quantity > 0),
  owner_id          bigint NOT NULL REFERENCES users (id),
  printing_id       uuid NOT NULL,
  card_name         text NOT NULL,
  set_code          text NOT NULL,
  collector_number  text NOT NULL,
  condition         text NOT NULL,
  finish            text NOT NULL DEFAULT 'nonfoil',
  image_url         text
);
CREATE INDEX trade_request_items_trade_idx ON trade_request_items (trade_request_id);

-- User reports about a player or a specific listing, worked through by moderators.
CREATE TABLE reports (
  id                bigserial PRIMARY KEY,
  reporter_id       bigint REFERENCES users (id),
  reported_user_id  bigint NOT NULL REFERENCES users (id),
  inventory_item_id bigint REFERENCES inventory_items (id) ON DELETE SET NULL,
  item_snapshot     text,                              -- card name/printing at report time
  reason            text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 1000),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  reviewed_by       bigint REFERENCES users (id)
);
CREATE INDEX reports_status_idx ON reports (status, created_at);

-- 5.2.3 accountability log. target_item_id has no FK: the item is usually deleted by the action.
CREATE TABLE mod_actions (
  id             bigserial PRIMARY KEY,
  actor_id       bigint NOT NULL REFERENCES users (id),
  report_id      bigint REFERENCES reports (id),
  action         text NOT NULL,
  target_user_id bigint REFERENCES users (id),
  target_item_id bigint,
  reason         text,
  details        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Only a SHA-256 hash of the reset token is stored; the usable token exists only in the emailed link.
CREATE TABLE password_resets (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Persistent session store (connect-pg-simple layout).
CREATE TABLE session (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON session (expire);
