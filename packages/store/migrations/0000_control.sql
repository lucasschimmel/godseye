CREATE TABLE IF NOT EXISTS control_lock (id integer PRIMARY KEY CHECK (id = 1));
INSERT INTO control_lock (id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('web','api','worker')),
  description text NOT NULL DEFAULT '', status text NOT NULL CHECK (status IN ('draft','validated','suspended')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0), repository jsonb,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS environments (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
  kind text NOT NULL CHECK (kind IN ('development','production','preview')),
  memory_mib integer NOT NULL CHECK (memory_mib > 0), cpu_millicores integer NOT NULL CHECK (cpu_millicores > 0),
  disk_gib integer NOT NULL CHECK (disk_gib > 0), UNIQUE(project_id, kind)
);
CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id), action text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','validating','running','waiting','awaiting_approval','cancel_requested','reconciling','succeeded','failed','cancelled','unknown')),
  revision integer NOT NULL CHECK (revision >= 0), error_code text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  key text PRIMARY KEY, fingerprint text NOT NULL, resource_id uuid NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind IN ('project','operation')), created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id uuid PRIMARY KEY, sequence integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  actor_id text NOT NULL, project_id uuid, action text NOT NULL, summary text NOT NULL,
  previous_hash text NOT NULL, hash text NOT NULL, occurred_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS github_deliveries (
  id text PRIMARY KEY, payload_hash text NOT NULL, outcome text NOT NULL, received_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ci_runs (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), delivery_id text,
  branch text NOT NULL, commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
  status text NOT NULL CHECK (status IN ('pending_verification','queued','running','succeeded','failed','cancelled','superseded','unavailable')),
  trigger text NOT NULL CHECK (trigger IN ('push','manual','scheduled')), provider_ref text, error_code text,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS operations_project_idx ON operations(project_id, created_at);
CREATE INDEX IF NOT EXISTS ci_runs_project_idx ON ci_runs(project_id, created_at);
ALTER TABLE ci_runs DROP CONSTRAINT IF EXISTS ci_runs_delivery_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ci_runs_delivery_project_idx ON ci_runs(delivery_id, project_id);
