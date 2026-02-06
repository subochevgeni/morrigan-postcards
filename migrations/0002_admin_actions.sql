-- For existing DB only. Do NOT run full schema.sql — run this file instead.
-- Adds table for short-lived admin callback actions (e.g. bulk delete).
CREATE TABLE IF NOT EXISTS admin_actions (
  token TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_expires_at
  ON admin_actions(expires_at);
