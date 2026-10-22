-- Undoes 010: forgets card type, colours and rarity (they come back from Scryfall if 010 runs again).
ALTER TABLE card_printings
  DROP COLUMN type_line,
  DROP COLUMN colors,
  DROP COLUMN rarity;
