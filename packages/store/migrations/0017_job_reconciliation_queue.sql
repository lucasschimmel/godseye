CREATE TABLE job_reconcile_requests (
  key text PRIMARY KEY,
  job_run_id uuid NOT NULL,
  foundation_run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  actor_id text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'processing', 'complete')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX job_reconcile_requests_pending_idx ON job_reconcile_requests(state, created_at);
CREATE TABLE job_worker_bindings (
  environment_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  handlers jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
