CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  pending_until INTEGER,
  category TEXT NOT NULL DEFAULT 'other',
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_created_at
  ON cards(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_category
  ON cards(category);

CREATE INDEX IF NOT EXISTS idx_cards_status_pending_until
  ON cards(status, pending_until);

-- Requests from the website (no email)
CREATE TABLE IF NOT EXISTS requests (
  req_id INTEGER PRIMARY KEY AUTOINCREMENT,
  postcard_id TEXT NOT NULL,
  name TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_created_at
  ON requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_requests_postcard_id
  ON requests(postcard_id);

CREATE INDEX IF NOT EXISTS idx_requests_name_created_at
  ON requests(name, created_at DESC);

-- Short-lived admin actions for Telegram callback buttons (e.g. bulk delete)
CREATE TABLE IF NOT EXISTS admin_actions (
  token TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_expires_at
  ON admin_actions(expires_at);

CREATE TABLE IF NOT EXISTS admin_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  ids_json TEXT NOT NULL,
  admin_chat_id TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_events_created_at
  ON admin_events(created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_daily (
  event_date TEXT NOT NULL,
  event_name TEXT NOT NULL,
  cnt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_date, event_name)
);
