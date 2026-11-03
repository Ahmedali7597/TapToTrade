-- Undoes 016: brings back 013's deck card finish and condition (every row non-foil, near mint) and 015's empty
-- optimizer_feedback table.
ALTER TABLE deck_cards
  ADD COLUMN finish    text NOT NULL DEFAULT 'nonfoil' CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  ADD COLUMN condition text NOT NULL DEFAULT 'NM' CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
  DROP CONSTRAINT deck_cards_deck_id_printing_id_board_key,
  ADD CONSTRAINT deck_cards_deck_id_printing_id_board_finish_key UNIQUE (deck_id, printing_id, board, finish);
CREATE TABLE optimizer_feedback (
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  commander  text NOT NULL,  -- the commander's name, partners joined with " + " in alphabetical order
  cut_card   text NOT NULL,
  add_card   text NOT NULL,
  accepted   boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, commander, cut_card, add_card)
);
CREATE INDEX optimizer_feedback_cut_idx ON optimizer_feedback (cut_card);
CREATE INDEX optimizer_feedback_commander_idx ON optimizer_feedback (commander);
