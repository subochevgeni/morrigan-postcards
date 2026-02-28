-- For existing DB only. Do NOT run full schema.sql — run this file instead.
-- Adds request anti-spam state, exchange proposal lifecycle fields, and error alert throttling.

ALTER TABLE exchange_proposals ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE exchange_proposals ADD COLUMN decided_at INTEGER;
ALTER TABLE exchange_proposals ADD COLUMN decided_by_chat_id TEXT;
ALTER TABLE exchange_proposals ADD COLUMN decision_note TEXT;

CREATE INDEX IF NOT EXISTS idx_exchange_proposals_status_created_at
  ON exchange_proposals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS request_rate_limits (
  rate_key TEXT PRIMARY KEY,
  last_request_at INTEGER NOT NULL,
  window_start_at INTEGER NOT NULL,
  window_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_rate_limits_last_request_at
  ON request_rate_limits(last_request_at);

CREATE TABLE IF NOT EXISTS error_alerts (
  fingerprint TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_error_alerts_last_seen_at
  ON error_alerts(last_seen_at);
