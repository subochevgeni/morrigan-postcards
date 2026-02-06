-- For existing DB only. Do NOT run full schema.sql — run this file instead.
-- Adds category column; existing rows get 'other'.
ALTER TABLE cards ADD COLUMN category TEXT NOT NULL DEFAULT 'other';
CREATE INDEX IF NOT EXISTS idx_cards_category ON cards(category);
