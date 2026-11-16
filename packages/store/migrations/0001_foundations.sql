CREATE TABLE control_resources (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), environment_id uuid NOT NULL REFERENCES environments(id),
 kind text NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE execution_plans (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), environment_id uuid NOT NULL REFERENCES environments(id), target_id uuid NOT NULL,
 expected_revision integer NOT NULL CHECK(expected_revision>=0), adapter_id text NOT NULL, command jsonb NOT NULL, hash text NOT NULL,
 max_cost_micros bigint NOT NULL CHECK(max_cost_micros>=0), tools jsonb NOT NULL, destinations jsonb NOT NULL,
 requires_approval boolean NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE control_approvals (
 id uuid PRIMARY KEY, plan_id uuid NOT NULL UNIQUE REFERENCES execution_plans(id), plan_hash text NOT NULL,
 owner_id text NOT NULL, session_id text NOT NULL, authenticated_at timestamptz NOT NULL, approved_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE activation_epochs (environment_id uuid PRIMARY KEY REFERENCES environments(id), epoch integer NOT NULL CHECK(epoch>0));
CREATE TABLE budget_accounts (
 project_id uuid PRIMARY KEY REFERENCES projects(id), limit_micros bigint NOT NULL CHECK(limit_micros>=0),
 reserved_micros bigint NOT NULL CHECK(reserved_micros>=0), spent_micros bigint NOT NULL CHECK(spent_micros>=0), revision integer NOT NULL CHECK(revision>=0)
);
CREATE TABLE execution_runs (
 id uuid PRIMARY KEY REFERENCES operations(id), plan_id uuid NOT NULL REFERENCES execution_plans(id),
 project_id uuid NOT NULL REFERENCES projects(id), environment_id uuid NOT NULL REFERENCES environments(id), epoch integer NOT NULL CHECK(epoch>0),
 fence integer NOT NULL CHECK(fence>=0), worker_id text, lease_expires_at timestamptz, grant_id uuid,
 cleanup_state text NOT NULL CHECK(cleanup_state IN ('not_required','pending','running','complete','failed')),
 reserved_micros bigint NOT NULL CHECK(reserved_micros>=0), charged_micros bigint NOT NULL CHECK(charged_micros>=0), terminal_at timestamptz, created_at timestamptz NOT NULL
);
CREATE TABLE effect_journal (
 id uuid PRIMARY KEY, run_id uuid NOT NULL UNIQUE REFERENCES execution_runs(id), effect_key text NOT NULL UNIQUE,
 fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('intent','succeeded','failed','unknown')),
 evidence_ref text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE task_grants (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES execution_runs(id), actor_id text NOT NULL, environment_id uuid NOT NULL REFERENCES environments(id),
 epoch integer NOT NULL CHECK(epoch>0), fence integer NOT NULL CHECK(fence>0), tools jsonb NOT NULL, destinations jsonb NOT NULL,
 max_cost_micros bigint NOT NULL CHECK(max_cost_micros>=0), used_micros bigint NOT NULL CHECK(used_micros>=0), expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE foundation_requests (
 key text PRIMARY KEY, fingerprint text NOT NULL, resource_id text NOT NULL, kind text NOT NULL, terminal_at timestamptz, created_at timestamptz NOT NULL
);
CREATE INDEX execution_runs_queue_idx ON execution_runs(created_at);
CREATE INDEX foundation_requests_terminal_idx ON foundation_requests(terminal_at);
