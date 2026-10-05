CREATE TABLE IF NOT EXISTS interactive_demo_sessions (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL UNIQUE REFERENCES test_runs(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (
    status IN ('CREATE','PROVISIONING','READY','ACTIVE','STOPPING','STOPPED','FAILED')
  ),
  customer_package TEXT NOT NULL,
  website_hostname TEXT NOT NULL,
  network_identity_id TEXT,
  person_identity_id TEXT,
  browser_identity_id TEXT,
  reset_version INTEGER NOT NULL DEFAULT 0 CHECK (reset_version >= 0),
  active_gateway_route_id TEXT,
  target_run_id TEXT,
  tenant_id TEXT,
  site_id TEXT,
  enrichment_triggered_at TIMESTAMPTZ,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS interactive_demo_sessions_status_expiry_idx
  ON interactive_demo_sessions (status, expires_at);

CREATE INDEX IF NOT EXISTS interactive_demo_sessions_run_idx
  ON interactive_demo_sessions (run_id);
