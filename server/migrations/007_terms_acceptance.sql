-- Which version of the terms and privacy policy each player agreed to when they signed up, and when
-- (Milestone 4 4.2.1 and 9.2: policy acceptance is an operational record). NULL for accounts made before this
-- was recorded. Additive, so the previous release keeps working against this schema.
ALTER TABLE users ADD COLUMN terms_version text;
ALTER TABLE users ADD COLUMN terms_accepted_at timestamptz;
