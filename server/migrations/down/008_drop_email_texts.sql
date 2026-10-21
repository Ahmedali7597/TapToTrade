-- Undoes 008: brings back the (empty) table for admin-written email text, exactly as 004 created it.
CREATE TABLE email_texts (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z_]{2,40}$'),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES users (id)
);
