-- Undoes 002: the meetup spot on proposals, partner stores, Google sign-in and the meetup range.
ALTER TABLE trade_requests DROP COLUMN meetup_store_id;
DROP TABLE stores;
ALTER TABLE users DROP COLUMN google_sub;
ALTER TABLE users DROP COLUMN travel_km;
