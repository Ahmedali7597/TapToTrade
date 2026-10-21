-- Undoes 007: which version of the terms each player accepted.
ALTER TABLE users DROP COLUMN terms_accepted_at;
ALTER TABLE users DROP COLUMN terms_version;
