-- Want lists with automatic matches, and trader reputation from feedback on accepted trades.
-- Everything here is additive, so the previous release keeps working against this schema.

-- Cards a player is looking for. printing_id is the printing they picked in the card search (for the picture);
-- any_printing = true matches every printing with the same name, false only that exact printing.
-- finish NULL = any finish.
CREATE TABLE want_items (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  printing_id  uuid NOT NULL REFERENCES card_printings (id),
  any_printing boolean NOT NULL DEFAULT true,
  finish       text CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  quantity     integer NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 9999),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, printing_id)
);
CREATE INDEX want_items_printing_idx ON want_items (printing_id);
-- Matching joins listings to wants by card name, so look names up by exact value too (the trigram index is for ILIKE).
CREATE INDEX card_printings_name_idx ON card_printings (name);

-- One answer per player per accepted trade: did it happen, and if so how it went (1-5 stars).
-- The other player's feedback is what counts towards a player's completed trades and rating.
CREATE TABLE trade_feedback (
  id               bigserial PRIMARY KEY,
  trade_request_id bigint NOT NULL REFERENCES trade_requests (id),
  author_id        bigint NOT NULL REFERENCES users (id),
  subject_id       bigint NOT NULL REFERENCES users (id),
  completed        boolean NOT NULL,
  rating           smallint CHECK (rating BETWEEN 1 AND 5),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_request_id, author_id),
  CHECK (author_id <> subject_id),
  CHECK (completed = (rating IS NOT NULL))  -- a rating only for trades that happened, and always for those
);
CREATE INDEX trade_feedback_subject_idx ON trade_feedback (subject_id);
