CREATE TABLE application_job_events (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 environment_id uuid NOT NULL REFERENCES environments(id),
 producer_id uuid NOT NULL,
 epoch integer NOT NULL CHECK(epoch>=0),
 hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
 run_ids jsonb NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE INDEX application_job_events_cell ON application_job_events(environment_id,created_at);
