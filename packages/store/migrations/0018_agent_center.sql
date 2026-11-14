CREATE TABLE agent_profiles (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),environment_id uuid NOT NULL REFERENCES environments(id),
 role text NOT NULL CHECK(role IN ('operations','security','research-marketing')),model text NOT NULL,
 limits jsonb NOT NULL,revision integer NOT NULL CHECK(revision>=0),project_revision integer NOT NULL,environment_revision integer NOT NULL,
 hash text NOT NULL,paused boolean NOT NULL DEFAULT false,skill jsonb NOT NULL,skill_ref uuid NOT NULL,grant_ref uuid NOT NULL,
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,
 CONSTRAINT agent_profile_scope_role UNIQUE(project_id,environment_id,role)
);
CREATE TABLE agent_tasks (
 id uuid PRIMARY KEY,profile_id uuid NOT NULL REFERENCES agent_profiles(id),project_id uuid NOT NULL REFERENCES projects(id),environment_id uuid NOT NULL REFERENCES environments(id),
 profile_revision integer NOT NULL,profile_snapshot jsonb NOT NULL,run_id uuid UNIQUE REFERENCES execution_runs(id),
 state text NOT NULL CHECK(state IN ('queued','running','cancel_requested','succeeded','failed','cancelled','unknown','reconciling')),
 provider_run_id text,input text NOT NULL,output text,reason text,input_tokens integer,output_tokens integer,
 cancel_requested boolean NOT NULL DEFAULT false,submission_intended boolean NOT NULL DEFAULT false,deadline timestamptz,
 created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,finished_at timestamptz
);
CREATE INDEX agent_task_profile_state ON agent_tasks(profile_id,state);
CREATE TABLE agent_events(id uuid PRIMARY KEY,task_id uuid NOT NULL REFERENCES agent_tasks(id),sequence integer NOT NULL,state text NOT NULL,occurred_at timestamptz NOT NULL,UNIQUE(task_id,sequence));
