-- Undoes 005: trade feedback and ratings, the card name index and want lists.
DROP TABLE trade_feedback;
DROP INDEX card_printings_name_idx;
DROP TABLE want_items;
