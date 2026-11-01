-- Deck cards get a finish and a condition, like Moxfield's deck editor. A foil and a non-foil copy of the same
-- printing are separate rows, so the finish joins the unique key. Existing rows become non-foil, near mint.
ALTER TABLE deck_cards
  ADD COLUMN finish    text NOT NULL DEFAULT 'nonfoil' CHECK (finish IN ('nonfoil', 'foil', 'etched')),
  ADD COLUMN condition text NOT NULL DEFAULT 'NM' CHECK (condition IN ('NM', 'LP', 'MP', 'HP', 'DMG')),
  DROP CONSTRAINT deck_cards_deck_id_printing_id_board_key,
  ADD CONSTRAINT deck_cards_deck_id_printing_id_board_finish_key UNIQUE (deck_id, printing_id, board, finish);
