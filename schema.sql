CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  image_key TEXT NOT NULL,
  thumb_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_created_at
  ON cards(created_at DESC);
