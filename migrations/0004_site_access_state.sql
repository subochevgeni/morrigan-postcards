-- For existing DB only. Do NOT run full schema.sql — run this file instead.
-- Adds runtime-managed access phrase state used by Telegram admin rotation commands.
CREATE TABLE IF NOT EXISTS site_access_state (
  key TEXT PRIMARY KEY,
  current_phrase TEXT NOT NULL,
  previous_phrase TEXT,
  updated_at INTEGER NOT NULL,
  updated_by_chat_id TEXT
);
