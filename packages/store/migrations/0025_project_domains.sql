CREATE TABLE project_domains (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 environment_id uuid NOT NULL REFERENCES environments(id),
 hostname text NOT NULL CHECK(hostname = lower(hostname) AND length(hostname) BETWEEN 4 AND 253),
 state text NOT NULL CHECK(state IN('pending_verification','verified','active','failed','removed')),
 method text NOT NULL CHECK(method IN('dns','txt')),
 challenge_token text NOT NULL CHECK(challenge_token ~ '^[a-f0-9]{32}$'),
 revision integer NOT NULL CHECK(revision>0),
 failure_code text CHECK(failure_code IN('DNS_NOT_FOUND','DNS_POINTS_ELSEWHERE','TXT_NOT_FOUND','TXT_MISMATCH','PUBLISH_FAILED')),
 last_checked_at timestamptz,
 verified_at timestamptz,
 activated_at timestamptz,
 removed_at timestamptz,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 CHECK((state='removed')=(removed_at IS NOT NULL)),
 CHECK(state NOT IN('verified','active') OR verified_at IS NOT NULL),
 CHECK(state<>'active' OR activated_at IS NOT NULL)
);
-- One live binding per hostname across the whole platform; removed rows are history.
CREATE UNIQUE INDEX project_domains_live_hostname_idx ON project_domains(hostname) WHERE state<>'removed';
CREATE INDEX project_domains_project_idx ON project_domains(project_id,created_at);
CREATE INDEX project_domains_environment_idx ON project_domains(environment_id) WHERE state IN('verified','active');
