ALTER TABLE interactive_demo_sessions
  ADD COLUMN IF NOT EXISTS credential_mode TEXT NOT NULL DEFAULT 'shared'
    CHECK (credential_mode IN ('shared', 'generated')),
  ADD COLUMN IF NOT EXISTS credential_email TEXT,
  ADD COLUMN IF NOT EXISTS credential_password TEXT;

UPDATE interactive_demo_sessions
SET credential_email = COALESCE(credential_email, 'admin@example.com')
WHERE credential_email IS NULL;

ALTER TABLE interactive_demo_sessions
  ALTER COLUMN credential_email SET NOT NULL;
