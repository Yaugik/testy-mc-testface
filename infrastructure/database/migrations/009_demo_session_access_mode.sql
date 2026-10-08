-- New sessions share access with the three seeded GL-EYE demo accounts
-- by default. Existing sessions that generated unique credentials retain
-- their previous isolated access policy across this upgrade.
ALTER TABLE interactive_demo_sessions
    ADD COLUMN IF NOT EXISTS share_seeded_demo_accounts BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE interactive_demo_sessions
SET share_seeded_demo_accounts = (credential_mode = 'shared');
