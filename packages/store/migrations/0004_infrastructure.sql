CREATE TABLE infrastructure_inventory (
  id integer PRIMARY KEY CHECK (id=1), revision integer NOT NULL,
  desired jsonb, observation_revision integer NOT NULL, observation jsonb
);
INSERT INTO infrastructure_inventory VALUES (1,0,NULL,0,NULL);
CREATE TABLE infrastructure_preparations (
  id uuid PRIMARY KEY, allocation_id uuid NOT NULL UNIQUE, project_id uuid NOT NULL REFERENCES projects(id),
  environment_id uuid NOT NULL REFERENCES environments(id), expected_project_revision integer NOT NULL,
  hash text NOT NULL, inventory_revision integer NOT NULL, observation_revision integer NOT NULL,
  policy_version text NOT NULL, manifest jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE infrastructure_allocations (
  id uuid PRIMARY KEY, preparation_id uuid NOT NULL UNIQUE REFERENCES infrastructure_preparations(id),
  project_id uuid NOT NULL REFERENCES projects(id), environment_id uuid NOT NULL REFERENCES environments(id),
  run_id uuid UNIQUE REFERENCES execution_runs(id), state text NOT NULL CHECK(state IN ('reserved','provisioning','verified','unknown','quarantined','released')),
  cleanup_state text NOT NULL DEFAULT 'not_required' CHECK(cleanup_state IN ('not_required','pending','stopped')),
  ipv4_subnet text NOT NULL, ipv6_subnet text NOT NULL, reason text, updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX infrastructure_ipv4_reserved ON infrastructure_allocations(ipv4_subnet) WHERE state <> 'released';
CREATE UNIQUE INDEX infrastructure_ipv6_reserved ON infrastructure_allocations(ipv6_subnet) WHERE state <> 'released';
CREATE TABLE infrastructure_steps (
  id uuid PRIMARY KEY, allocation_id uuid NOT NULL REFERENCES infrastructure_allocations(id),
  run_id uuid NOT NULL REFERENCES execution_runs(id), kind text NOT NULL, state text NOT NULL,
  scope jsonb NOT NULL, provider_id text, configuration_hash text NOT NULL, evidence text, created_at timestamptz NOT NULL,
  UNIQUE(allocation_id,kind)
);
CREATE TABLE infrastructure_receipts (key text PRIMARY KEY, response jsonb NOT NULL);
