-- Undoes 011: decks and their cards (and everything players built), and the card rules details.
DROP TABLE deck_cards;
DROP TABLE decks;
ALTER TABLE card_printings
  DROP COLUMN mana_value,
  DROP COLUMN mana_cost,
  DROP COLUMN color_identity,
  DROP COLUMN legalities;
