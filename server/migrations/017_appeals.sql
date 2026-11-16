-- Appeals: a suspended player asks the moderators to look at their suspension again. Additive.
CREATE TABLE appeals (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users (id),
  message     text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by bigint REFERENCES users (id)
);
-- One open appeal per player at a time.
CREATE UNIQUE INDEX appeals_one_pending_idx ON appeals (user_id) WHERE status = 'pending';
CREATE INDEX appeals_status_idx ON appeals (status, created_at);
