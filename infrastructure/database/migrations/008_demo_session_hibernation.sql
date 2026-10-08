-- Hibernated demos retain their GL-EYE workspace until explicitly deleted.
-- STOPPED remains the terminal state for permanently deleted sessions.
ALTER TABLE interactive_demo_sessions
  DROP CONSTRAINT IF EXISTS interactive_demo_sessions_status_check;

ALTER TABLE interactive_demo_sessions
  ADD CONSTRAINT interactive_demo_sessions_status_check CHECK (
    status IN (
      'CREATE','PROVISIONING','READY','ACTIVE','HIBERNATING','HIBERNATED',
      'RESUMING','DELETING','STOPPING','STOPPED','FAILED'
    )
  );

ALTER TABLE interactive_demo_sessions
  ADD COLUMN IF NOT EXISTS keep_workspace BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS hibernated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS interactive_demo_sessions_browse_idx
  ON interactive_demo_sessions(status, updated_at DESC);
