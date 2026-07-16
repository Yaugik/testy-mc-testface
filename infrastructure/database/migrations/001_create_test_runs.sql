CREATE TABLE test_runs (
  id UUID PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'CREATED',
      'VALIDATING',
      'ALLOCATING',
      'COMPILING',
      'CONFIGURING',
      'RUNNING',
      'OBSERVING',
      'ASSERTING',
      'PASSED',
      'FAILED',
      'CANCELLING',
      'CANCELLED',
      'CLEANUP'
    )
  ),
  resolved_scenario_hash CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX test_runs_status_created_at_idx
  ON test_runs (status, created_at DESC);

CREATE INDEX test_runs_scenario_created_at_idx
  ON test_runs (scenario_id, created_at DESC);
