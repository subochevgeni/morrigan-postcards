CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  category TEXT NOT NULL DEFAULT 'other',
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_created_at
  ON cards(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cards_category
  ON cards(category);

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
