ALTER TABLE assertion_results
  ADD COLUMN IF NOT EXISTS assertion_type TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'error'
    CHECK (severity IN ('error', 'warning')),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB;
UPDATE assertion_results SET assertion_type=COALESCE(assertion_type,'legacy') WHERE assertion_type IS NULL;
ALTER TABLE assertion_results ALTER COLUMN assertion_type SET NOT NULL;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS observation_id TEXT;
UPDATE observations SET observation_id=COALESCE(observation_id,'observation-'||id::TEXT) WHERE observation_id IS NULL;
ALTER TABLE observations ALTER COLUMN observation_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS observations_run_observation_id_idx ON observations(run_id,observation_id);
CREATE INDEX IF NOT EXISTS assertion_results_run_passed_severity_idx ON assertion_results(run_id,passed,severity,asserted_at);
CREATE INDEX IF NOT EXISTS provider_calls_run_vendor_operation_idx ON provider_calls(run_id,vendor_id,operation_id,occurred_at);
CREATE INDEX IF NOT EXISTS browser_actions_run_journey_step_idx ON browser_actions(run_id,journey_id,step_id,started_at);
CREATE INDEX IF NOT EXISTS observations_run_type_status_idx ON observations(run_id,observation_type,status,observed_at);
