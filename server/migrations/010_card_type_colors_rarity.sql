-- Card type, colours and rarity from Scryfall, so a collection can be grouped and sorted the way Moxfield and
-- Archidekt do it. Additive only. Printings saved before this have NULLs until the inventory page fills them in;
-- an empty type_line means Scryfall was asked and didn't have the card.
ALTER TABLE card_printings
  ADD COLUMN type_line text,
  ADD COLUMN colors    text[],
  ADD COLUMN rarity    text;
