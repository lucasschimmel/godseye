CREATE TABLE project_lifecycles (
 project_id uuid PRIMARY KEY REFERENCES projects(id),
 phase text NOT NULL CHECK(phase IN('suspended','quarantined','purged')),
 resume_status text NOT NULL CHECK(resume_status IN('draft','validated')),
 reason text,
 revision integer NOT NULL CHECK(revision>0),
 suspended_at timestamptz NOT NULL,
 quarantined_at timestamptz,
 purge_after timestamptz,
 purged_at timestamptz,
 updated_at timestamptz NOT NULL,
 CHECK((phase='quarantined')=(purge_after IS NOT NULL AND quarantined_at IS NOT NULL) OR phase='purged'),
 CHECK((phase='purged')=(purged_at IS NOT NULL))
);
CREATE TABLE project_exports (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 project_revision integer NOT NULL CHECK(project_revision>=0),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 manifest jsonb NOT NULL,
 created_at timestamptz NOT NULL
);
CREATE INDEX project_exports_project_idx ON project_exports(project_id,created_at);
