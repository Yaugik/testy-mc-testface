ALTER TABLE resource_leases
  ADD COLUMN IF NOT EXISTS cleanup_claimed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_cleanup_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_cleanup_error_fingerprint CHAR(64);

CREATE INDEX IF NOT EXISTS resource_leases_expiry_claim_idx
  ON resource_leases (expires_at, cleanup_claimed_until, id)
  WHERE status = 'ACTIVE';

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS retention_claimed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deletion_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_deletion_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_deletion_error_fingerprint CHAR(64);

CREATE INDEX IF NOT EXISTS artifacts_retention_claim_idx
  ON artifacts (created_at, retention_claimed_until, id);
