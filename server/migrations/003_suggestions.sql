-- Suggestions players send to the moderators and admins. Additive, so the previous release keeps working.
CREATE TABLE suggestions (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users (id),          -- kept (anonymized) if the account is deleted
  topic       text NOT NULL CHECK (topic IN ('feature', 'cards', 'problem', 'other')),
  message     text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by bigint REFERENCES users (id)
);
CREATE INDEX suggestions_status_idx ON suggestions (status, created_at);
CREATE INDEX suggestions_user_idx ON suggestions (user_id, created_at DESC);
