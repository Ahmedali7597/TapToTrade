-- Deck building (after Moxfield): a player's decks and the cards in each, plus the card rules details a deck needs
-- (mana value, mana cost, colour identity and format legality, all from Scryfall). Additive only.
ALTER TABLE card_printings
  ADD COLUMN mana_value     numeric,
  ADD COLUMN mana_cost      text,
  ADD COLUMN color_identity text[],
  ADD COLUMN legalities     jsonb;

-- private: only the owner; unlisted: anyone with the link; public: also listed on the owner's profile.
CREATE TABLE decks (
  id          bigserial PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  format      text NOT NULL CHECK (format IN ('commander', 'standard', 'pioneer', 'modern', 'legacy', 'vintage', 'pauper', 'casual')),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  visibility  text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decks_owner_idx ON decks (owner_id, updated_at DESC);

-- One row per printing per board. Basic lands can run into the dozens, so the cap is 99, not 4.
CREATE TABLE deck_cards (
  id          bigserial PRIMARY KEY,
  deck_id     bigint NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  printing_id uuid NOT NULL REFERENCES card_printings (id),
  board       text NOT NULL CHECK (board IN ('commander', 'main', 'side', 'maybe')),
  quantity    integer NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  UNIQUE (deck_id, printing_id, board)
);
