-- Undoes 001: removes the core tables, newest dependants first. Every later migration must be undone first.
DROP TABLE session;
DROP TABLE password_resets;
DROP TABLE mod_actions;
DROP TABLE reports;
DROP TABLE trade_request_items;
DROP TABLE trade_requests;
DROP TABLE inventory_items;
DROP TABLE card_printings;
DROP TABLE users;
-- pg_trgm (text search) stays: an extension belongs to the whole database, and leaving it is harmless.
