ALTER TABLE environments ADD COLUMN name text;
UPDATE environments SET name=kind;
ALTER TABLE environments ALTER COLUMN name SET NOT NULL;
ALTER TABLE environments ALTER COLUMN name SET DEFAULT 'development';
ALTER TABLE environments ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK(revision>=0);
ALTER TABLE environments ADD COLUMN expires_at timestamptz;
ALTER TABLE environments DROP CONSTRAINT environments_project_id_kind_key;
ALTER TABLE environments ADD CONSTRAINT environments_project_id_name_key UNIQUE(project_id,name);
ALTER TABLE environments ADD CONSTRAINT environments_preview_expiry_check CHECK((kind='preview' AND expires_at IS NOT NULL) OR (kind<>'preview' AND expires_at IS NULL));
CREATE UNIQUE INDEX environments_standard_kind_key ON environments(project_id,kind) WHERE kind<>'preview';
CREATE TABLE database_preparations (
 id uuid PRIMARY KEY,allocation_id uuid NOT NULL,project_id uuid NOT NULL REFERENCES projects(id),environment_id uuid NOT NULL REFERENCES environments(id),
 expected_project_revision integer NOT NULL,expected_environment_revision integer NOT NULL,hash text NOT NULL,policy_version text NOT NULL,profile jsonb NOT NULL,binding jsonb,
 inventory_revision integer NOT NULL,observation_revision integer NOT NULL,created_at timestamptz NOT NULL
);
CREATE TABLE database_allocations (
 id uuid PRIMARY KEY,preparation_id uuid NOT NULL UNIQUE REFERENCES database_preparations(id),project_id uuid NOT NULL REFERENCES projects(id),environment_id uuid NOT NULL REFERENCES environments(id),
 run_id uuid NOT NULL UNIQUE REFERENCES execution_runs(id),state text NOT NULL CHECK(state IN('reserved','ready','suspended','unknown','quarantined','released')),
 requested_state text NOT NULL CHECK(requested_state IN('ready','suspended')),generation integer NOT NULL CHECK(generation>0),epoch integer NOT NULL CHECK(epoch>0),
 system_identifier text,verified_scope jsonb,provider_ref text,reason text,updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX database_environment_retained_key ON database_allocations(environment_id) WHERE state<>'released';
CREATE TABLE database_steps (
 id uuid PRIMARY KEY,allocation_id uuid NOT NULL REFERENCES database_allocations(id),run_id uuid NOT NULL REFERENCES execution_runs(id),
 generation integer NOT NULL,intent text NOT NULL CHECK(intent IN('provision','suspend','resume')),state text NOT NULL CHECK(state IN('intended','inspected')),
 scope_hash text NOT NULL,evidence text,created_at timestamptz NOT NULL,UNIQUE(run_id)
);
CREATE TABLE database_commands (
 plan_id uuid PRIMARY KEY REFERENCES execution_plans(id),preparation_id uuid NOT NULL REFERENCES database_preparations(id),
 intent text NOT NULL CHECK(intent IN('provision','suspend','resume')),expected_generation integer NOT NULL CHECK(expected_generation>=0),epoch integer NOT NULL CHECK(epoch>0),previous_scope jsonb
);
