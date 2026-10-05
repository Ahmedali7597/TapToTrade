-- Email confirmation, notification settings, admin-written email text, and richer partner store pages.
-- Everything here is additive, so the previous release keeps working against this schema.

-- When the player proved they own their email address. NULL = not confirmed yet. Everyone who signed up
-- before confirmation existed is treated as confirmed.
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at = created_at WHERE status <> 'deleted';

-- Whether the player wants an email when a trade request, counter-offer or acceptance comes in.
ALTER TABLE users ADD COLUMN email_trades boolean NOT NULL DEFAULT true;

-- Single-use "confirm your email" links. Only a hash of the token is stored, like password resets.
-- `email` is the address the link was sent to, so a link stops working if the player changes address.
CREATE TABLE email_verifications (
  id         bigserial PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email      text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id);

-- Extra text admins add to the site's emails (key = which email, or 'footer' for all of them).
CREATE TABLE email_texts (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES users (id)
);

-- Partner store pages: what the store offers (tags from a fixed list in shared/stores.js), when, a perk for
-- Tap to Trade players, whether it's featured on the home page, and the player account the store runs.
ALTER TABLE stores ADD COLUMN tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 12);
ALTER TABLE stores ADD COLUMN featured boolean NOT NULL DEFAULT false;
ALTER TABLE stores ADD COLUMN perk text CHECK (char_length(perk) <= 200);
ALTER TABLE stores ADD COLUMN hours text CHECK (char_length(hours) <= 300);
ALTER TABLE stores ADD COLUMN account_user_id bigint UNIQUE REFERENCES users (id);
