-- The deck optimizer and per-card deck editing are gone: drop what players did with its swaps (015), and merge
-- foil and non-foil rows of one printing back into one row per board, without a finish or condition (013).
DROP TABLE optimizer_feedback;
UPDATE deck_cards c SET quantity = LEAST(99, s.n)
  FROM (SELECT min(id) AS keep, sum(quantity)::int AS n FROM deck_cards GROUP BY deck_id, printing_id, board HAVING count(*) > 1) s
 WHERE c.id = s.keep;
DELETE FROM deck_cards d USING deck_cards k
 WHERE d.deck_id = k.deck_id AND d.printing_id = k.printing_id AND d.board = k.board AND d.id > k.id;
ALTER TABLE deck_cards
  DROP CONSTRAINT deck_cards_deck_id_printing_id_board_finish_key,
  ADD CONSTRAINT deck_cards_deck_id_printing_id_board_key UNIQUE (deck_id, printing_id, board),
  DROP COLUMN finish,
  DROP COLUMN condition;
