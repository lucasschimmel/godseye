CREATE TABLE backend_configurations (
  environment_id uuid PRIMARY KEY REFERENCES environments(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  revision integer NOT NULL CHECK (revision > 0),
  project_revision integer NOT NULL CHECK (project_revision >= 0),
  environment_revision integer NOT NULL CHECK (environment_revision >= 0),
  configuration jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);
