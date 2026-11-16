CREATE TABLE coding_preparations (
  id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
  metadata jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE coding_tasks (
  id uuid PRIMARY KEY, preparation_id uuid NOT NULL UNIQUE REFERENCES coding_preparations(id),
  project_id uuid NOT NULL REFERENCES projects(id), run_id uuid UNIQUE,
  metadata jsonb NOT NULL, result jsonb, created_at timestamptz NOT NULL
);
