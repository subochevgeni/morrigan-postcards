-- Tracks how many user-uploaded offer photos were attached to an exchange proposal.
ALTER TABLE exchange_proposals ADD COLUMN offer_photo_count INTEGER NOT NULL DEFAULT 0;
