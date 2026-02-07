-- For existing DB only. Do NOT run full schema.sql — run this file instead.
-- Adds reservation support, admin audit events, and aggregate analytics.

ALTER TABLE cards ADD COLUMN pending_until INTEGER;
CREATE INDEX IF NOT EXISTS idx_cards_status_pending_until ON cards(status, pending_until);
CREATE INDEX IF NOT EXISTS idx_requests_name_created_at ON requests(name, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  ids_json TEXT NOT NULL,
  admin_chat_id TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_events_created_at ON admin_events(created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_daily (
  event_date TEXT NOT NULL,
  event_name TEXT NOT NULL,
  cnt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_date, event_name)
);
