-- Add category column for existing D1 databases (run once)
ALTER TABLE cards ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
