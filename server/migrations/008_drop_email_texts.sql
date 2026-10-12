-- Email wording is edited only in the Resend templates now, so the Admin page's extra email text (added in 004)
-- is gone, and so is its table. Run this after the release that stopped reading it.
DROP TABLE IF EXISTS email_texts;
