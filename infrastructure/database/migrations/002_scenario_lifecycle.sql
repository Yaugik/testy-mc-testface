ALTER TABLE test_runs
  ADD COLUMN IF NOT EXISTS resolved_scenario JSONB,
  ADD COLUMN IF NOT EXISTS outcome_status TEXT CHECK (
    outcome_status IS NULL OR outcome_status IN ('PASSED', 'FAILED', 'CANCELLED')
  ),
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS run_steps (
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  phase TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('RUNNING', 'PASSED', 'FAILED', 'CANCELLED', 'SKIPPED')
  ),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  output_fingerprint CHAR(64),
  error JSONB,
  PRIMARY KEY (run_id, step_id, attempt)
);

CREATE INDEX IF NOT EXISTS run_steps_run_started_idx
  ON run_steps (run_id, started_at, step_id);

CREATE TABLE IF NOT EXISTS timeline_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS timeline_events_run_order_idx
  ON timeline_events (run_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS resource_leases (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_leases_active_key_idx
  ON resource_leases (resource_type, resource_key)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS resource_leases_run_status_idx
  ON resource_leases (run_id, status, expires_at);

CREATE TABLE IF NOT EXISTS runtime_instances (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  runtime_type TEXT NOT NULL,
  runtime_key TEXT NOT NULL,
  status TEXT NOT NULL,
  endpoint_fingerprint CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS runtime_instances_run_status_idx
  ON runtime_instances (run_id, status, created_at);

CREATE TABLE IF NOT EXISTS provider_calls (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  vendor_id TEXT NOT NULL,
  operation_id TEXT,
  case_id TEXT,
  correlation_id TEXT,
  sequence_index INTEGER,
  status_code INTEGER,
  duration_ms INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_calls_run_order_idx
  ON provider_calls (run_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS browser_actions (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  journey_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  page_fingerprint CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS browser_actions_run_order_idx
  ON browser_actions (run_id, started_at, id);

CREATE TABLE IF NOT EXISTS observations (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  observation_type TEXT NOT NULL,
  status TEXT NOT NULL,
  value JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  observed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS observations_run_order_idx
  ON observations (run_id, observed_at, id);

CREATE TABLE IF NOT EXISTS assertion_results (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  assertion_id TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  expected JSONB,
  actual JSONB,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  asserted_at TIMESTAMPTZ NOT NULL,
  UNIQUE (run_id, assertion_id)
);

CREATE INDEX IF NOT EXISTS assertion_results_run_passed_idx
  ON assertion_results (run_id, passed, asserted_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  media_type TEXT NOT NULL,
  location TEXT NOT NULL,
  sha256 CHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifacts_run_created_idx
  ON artifacts (run_id, created_at, id);
