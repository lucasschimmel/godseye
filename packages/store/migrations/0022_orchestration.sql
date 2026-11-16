CREATE TABLE orchestration_plans (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 metadata jsonb NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE INDEX orchestration_plans_project ON orchestration_plans(project_id, created_at);
