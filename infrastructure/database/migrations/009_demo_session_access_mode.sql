-- Sharing defaults to the three seeded GL-EYE demo accounts for legacy
-- sessions. New exclusive sessions explicitly set this to FALSE.
ALTER TABLE interactive_demo_sessions
    ADD COLUMN IF NOT EXISTS share_seeded_demo_accounts BOOLEAN NOT NULL DEFAULT TRUE;
