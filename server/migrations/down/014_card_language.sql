-- Undoes 014: copies of one printing in different languages merge back into one listing (the oldest row keeps them).
UPDATE inventory_items i SET quantity = LEAST(9999, s.n)
  FROM (SELECT min(id) AS keep, sum(quantity)::int AS n FROM inventory_items GROUP BY owner_id, printing_id, condition, finish HAVING count(*) > 1) s
 WHERE i.id = s.keep;
DELETE FROM inventory_items d USING inventory_items k
 WHERE d.owner_id = k.owner_id AND d.printing_id = k.printing_id AND d.condition = k.condition AND d.finish = k.finish AND d.id > k.id;
ALTER TABLE inventory_items
  DROP CONSTRAINT inventory_items_owner_id_printing_id_condition_finish_language_key,
  ADD CONSTRAINT inventory_items_owner_id_printing_id_condition_finish_key UNIQUE (owner_id, printing_id, condition, finish),
  DROP COLUMN language;
ALTER TABLE trade_request_items DROP COLUMN language;
