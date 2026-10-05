-- Partner store events (trade nights, Commander nights, prereleases) shown on store pages and as calendar files.
-- Everything here is additive, so the previous release keeps working against this schema.

-- One dated event at a partner store. Admins and the store's own player account post them. Times are stored as
-- real instants; the app shows them in the store's local time zone (from its city). kind is one of
-- EVENT_KINDS in shared/events.js. A weekly event posted for several weeks is one row per week.
CREATE TABLE store_events (
  id         bigserial PRIMARY KEY,
  store_id   bigint NOT NULL REFERENCES stores (id),
  title      text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 100),
  kind       text NOT NULL CHECK (kind ~ '^[a-z_]{2,30}$'),
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '24 hours'),
  details    text CHECK (char_length(details) <= 500),
  cost       text CHECK (char_length(cost) <= 60),
  link       text CHECK (link ~ '^https://' AND char_length(link) <= 300),
  cancelled  boolean NOT NULL DEFAULT false,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX store_events_store_start_idx ON store_events (store_id, starts_at);
