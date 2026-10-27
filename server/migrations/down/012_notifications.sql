-- Undoes 012: in-app notifications and per-kind email choices (everyone goes back to the one trade-email switch).
ALTER TABLE users DROP COLUMN email_prefs;
DROP TABLE notifications;
