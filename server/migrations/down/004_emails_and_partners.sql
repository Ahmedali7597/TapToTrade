-- Undoes 004: email confirmation, trade-email setting, admin email text and the partner store page fields.
ALTER TABLE stores DROP COLUMN account_user_id;
ALTER TABLE stores DROP COLUMN hours;
ALTER TABLE stores DROP COLUMN perk;
ALTER TABLE stores DROP COLUMN featured;
ALTER TABLE stores DROP COLUMN tags;
DROP TABLE email_texts;
DROP TABLE email_verifications;
ALTER TABLE users DROP COLUMN email_trades;
ALTER TABLE users DROP COLUMN email_verified_at;
