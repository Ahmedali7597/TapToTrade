-- What players did with the deck optimizer's suggested swaps: took it (applied it, or saved it as a deck) or rejected
-- it. The optimizer learns from these: a swap players keep turning down stops being suggested, one they take ranks
-- higher, and a player's own rejections come back the next time they open the same commander. One row per player per
-- swap; the latest answer wins. cut_card or add_card is '' for a swap that only adds or only cuts.
CREATE TABLE optimizer_feedback (
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  commander  text NOT NULL,  -- the commander's name, partners joined with " + " in alphabetical order
  cut_card   text NOT NULL,
  add_card   text NOT NULL,
  accepted   boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, commander, cut_card, add_card)
);
-- Every player's answers for the cards in a deck, and for one commander.
CREATE INDEX optimizer_feedback_cut_idx ON optimizer_feedback (cut_card);
CREATE INDEX optimizer_feedback_commander_idx ON optimizer_feedback (commander);
