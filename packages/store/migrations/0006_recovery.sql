ALTER TABLE environments ADD COLUMN recovery_hold boolean NOT NULL DEFAULT false;
ALTER TABLE environments DROP CONSTRAINT environments_kind_check;
ALTER TABLE environments ADD CONSTRAINT environments_kind_check CHECK(kind IN('development','production','preview','recovery'));
ALTER TABLE environments ADD CONSTRAINT environments_recovery_hold_check CHECK(kind<>'recovery' OR recovery_hold);
DROP INDEX environments_standard_kind_key;
CREATE UNIQUE INDEX environments_standard_kind_key ON environments(project_id,kind) WHERE kind IN('development','production');
CREATE TABLE recovery_preparations (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),source_environment_id uuid NOT NULL REFERENCES environments(id),source_allocation_id uuid NOT NULL REFERENCES database_allocations(id),
 environment_id uuid NOT NULL REFERENCES environments(id),allocation_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('full','diff','restore','check')),
 backup_id uuid,backup_snapshot jsonb,target_time text,name text,expected_project_revision integer NOT NULL,expected_environment_revision integer NOT NULL,
 policy jsonb NOT NULL,policy_version text NOT NULL,hash text NOT NULL,binding jsonb,source_hash text NOT NULL,repository_id uuid NOT NULL,
 inventory_revision integer NOT NULL,observation_revision integer NOT NULL,created_at timestamptz NOT NULL
);
CREATE TABLE recovery_runs (
 id uuid PRIMARY KEY,preparation_id uuid NOT NULL UNIQUE REFERENCES recovery_preparations(id),run_id uuid NOT NULL UNIQUE REFERENCES execution_runs(id),
 project_id uuid NOT NULL REFERENCES projects(id),environment_id uuid NOT NULL REFERENCES environments(id),allocation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('full','diff','restore','check')),state text NOT NULL CHECK(state IN('reserved','unknown','backup-created','archive-checked','restore-verified','released')),
 epoch integer NOT NULL CHECK(epoch>0),reason text,evidence jsonb,updated_at timestamptz NOT NULL
);
CREATE TABLE recovery_backups (
 id uuid PRIMARY KEY,preparation_id uuid NOT NULL UNIQUE REFERENCES recovery_preparations(id),project_id uuid NOT NULL REFERENCES projects(id),
 environment_id uuid NOT NULL REFERENCES environments(id),source_allocation_id uuid NOT NULL REFERENCES database_allocations(id),repository_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('full','diff')),metadata jsonb NOT NULL,created_at timestamptz NOT NULL,verified_at timestamptz
);
CREATE TABLE recovery_commands(plan_id uuid PRIMARY KEY REFERENCES execution_plans(id),preparation_id uuid NOT NULL REFERENCES recovery_preparations(id),epoch integer NOT NULL CHECK(epoch>0));
CREATE TABLE recovery_steps(run_id uuid PRIMARY KEY REFERENCES execution_runs(id),scope_hash text NOT NULL,state text NOT NULL CHECK(state IN('intended','inspected')),evidence text,created_at timestamptz NOT NULL);
