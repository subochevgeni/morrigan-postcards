-- For existing DB only. Do NOT run full schema.sql — run this file instead.
-- Adds structured exchange proposals submitted from website users.
CREATE TABLE IF NOT EXISTS exchange_proposals (
  proposal_id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_ids_json TEXT NOT NULL,
  offered_cards_json TEXT NOT NULL,
  name TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_proposals_created_at
  ON exchange_proposals(created_at DESC);
