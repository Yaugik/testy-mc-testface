ALTER TABLE interactive_demo_sessions
  ADD COLUMN IF NOT EXISTS visitor_started_at TIMESTAMPTZ;
