-- Canada-wide locations, meetup ranges, Google sign-in and partner game stores.
-- Everything here is additive, so the previous release keeps working against this schema.

-- How far a player is willing to travel to meet, in km from their city's centre. NULL = not set.
ALTER TABLE users ADD COLUMN travel_km integer CHECK (travel_km BETWEEN 1 AND 500);

-- Google account id ("sub" claim) for players who sign in with Google. Google-only accounts keep
-- password_hash = '!', which never verifies, until they set a password.
ALTER TABLE users ADD COLUMN google_sub text UNIQUE;

-- Game stores that agreed to be official meetup spots. Admins manage the list. Stores are public
-- businesses, so unlike players they can have an exact address and map position.
CREATE TABLE stores (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  address    text NOT NULL CHECK (char_length(address) BETWEEN 5 AND 200),
  city       text NOT NULL,                                   -- one of the listed cities, "City, PROV"
  lat        double precision CHECK (lat BETWEEN 41 AND 84),  -- optional; the map falls back to the city centre
  lng        double precision CHECK (lng BETWEEN -142 AND -52),
  website    text CHECK (website ~ '^https://' AND char_length(website) <= 300),
  notes      text CHECK (char_length(notes) <= 500),         -- e.g. "Trade tables open Friday nights"
  active     boolean NOT NULL DEFAULT true,
  created_by bigint REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lat IS NULL) = (lng IS NULL))
);
CREATE INDEX stores_city_idx ON stores (city) WHERE active;

-- Optional meetup spot suggested with a proposal. Each counter-offer version carries its own choice.
ALTER TABLE trade_requests ADD COLUMN meetup_store_id bigint REFERENCES stores (id);
