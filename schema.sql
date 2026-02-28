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

-- Structured exchange offers from website users.
CREATE TABLE IF NOT EXISTS exchange_proposals (
  proposal_id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_ids_json TEXT NOT NULL,
  offered_cards_json TEXT NOT NULL,
  name TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  decided_at INTEGER,
  decided_by_chat_id TEXT,
  decision_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_exchange_proposals_created_at
  ON exchange_proposals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exchange_proposals_status_created_at
  ON exchange_proposals(status, created_at DESC);

-- Request anti-spam state keyed by anonymized visitor IP fingerprint.
CREATE TABLE IF NOT EXISTS request_rate_limits (
  rate_key TEXT PRIMARY KEY,
  last_request_at INTEGER NOT NULL,
  window_start_at INTEGER NOT NULL,
  window_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_request_rate_limits_last_request_at
  ON request_rate_limits(last_request_at);

-- Error alert throttle state to avoid Telegram spam while keeping visibility.
CREATE TABLE IF NOT EXISTS error_alerts (
  fingerprint TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL,
  total_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_error_alerts_last_seen_at
  ON error_alerts(last_seen_at);

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

-- Runtime-managed access phrase state (used by Telegram admin rotation commands)
CREATE TABLE IF NOT EXISTS site_access_state (
  key TEXT PRIMARY KEY,
  current_phrase TEXT NOT NULL,
  previous_phrase TEXT,
  updated_at INTEGER NOT NULL,
  updated_by_chat_id TEXT
);
