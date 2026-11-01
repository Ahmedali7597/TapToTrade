-- A copy's language, as Moxfield and most collection sites keep it (Scryfall's codes: en, ja, de...). A Japanese and
-- an English copy of the same printing are separate listings, so the language joins the unique key. Trade lines
-- snapshot it like the condition and finish. Existing rows are English.
ALTER TABLE inventory_items
  ADD COLUMN language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'ru', 'zhs', 'zht', 'he', 'la', 'grc', 'ar', 'sa', 'ph', 'qya')),
  DROP CONSTRAINT inventory_items_owner_id_printing_id_condition_finish_key,
  ADD CONSTRAINT inventory_items_owner_id_printing_id_condition_finish_language_key UNIQUE (owner_id, printing_id, condition, finish, language);
ALTER TABLE trade_request_items ADD COLUMN language text NOT NULL DEFAULT 'en';
