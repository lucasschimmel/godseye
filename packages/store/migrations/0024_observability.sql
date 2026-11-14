CREATE TABLE telemetry_sources (
 id uuid PRIMARY KEY,name text NOT NULL,authenticated_actor_id text NOT NULL,project_id uuid REFERENCES projects(id),environment_id uuid REFERENCES environments(id),resource_id uuid REFERENCES control_resources(id),kind text NOT NULL CHECK(kind IN('service','controller','external-observer')),stale_after_seconds integer NOT NULL CHECK(stale_after_seconds BETWEEN 5 AND 86400),created_at timestamptz NOT NULL,log_floor bigint NOT NULL DEFAULT 0,metric_floor bigint NOT NULL DEFAULT 0,
 CHECK(environment_id IS NULL OR project_id IS NOT NULL),CHECK(resource_id IS NULL OR environment_id IS NOT NULL)
);
CREATE INDEX telemetry_sources_scope_idx ON telemetry_sources(project_id,environment_id);
CREATE TABLE telemetry_records (
 cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,id uuid NOT NULL UNIQUE,source_id uuid NOT NULL REFERENCES telemetry_sources(id),request_key text NOT NULL UNIQUE,digest text NOT NULL,observed_at timestamptz NOT NULL,received_at timestamptz NOT NULL,data jsonb NOT NULL
);
CREATE INDEX telemetry_records_source_cursor_idx ON telemetry_records(source_id,cursor);
CREATE INDEX telemetry_records_retention_idx ON telemetry_records(received_at);
ALTER TABLE incidents DROP CONSTRAINT incidents_kind_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_kind_check CHECK(kind IN('archive-lag','headroom','rotation-failure','health','provider','accounting','budget','external-uptime'));
ALTER TABLE incidents DROP CONSTRAINT incidents_delivery_state_check;
ALTER TABLE incidents ADD CONSTRAINT incidents_delivery_state_check CHECK(delivery_state IN('unconfigured','pending','notified','failed','unknown','delivering'));
CREATE TABLE incident_outbox (
 id uuid PRIMARY KEY,incident_id uuid NOT NULL UNIQUE REFERENCES incidents(id),payload_key text NOT NULL UNIQUE,state text NOT NULL CHECK(state IN('pending','delivering','notified','failed','unknown','suppressed')),attempts integer NOT NULL CHECK(attempts>=0),claim_id uuid,claimed_at timestamptz,updated_at timestamptz NOT NULL,receipt text
);

CREATE TABLE telemetry_metric_records (
 cursor bigint PRIMARY KEY,id uuid NOT NULL UNIQUE,source_id uuid NOT NULL REFERENCES telemetry_sources(id),request_key text NOT NULL UNIQUE,digest text NOT NULL,observed_at timestamptz NOT NULL,received_at timestamptz NOT NULL,data jsonb NOT NULL
);
CREATE INDEX telemetry_metric_records_source_cursor_idx ON telemetry_metric_records(source_id,cursor);
CREATE INDEX telemetry_metric_records_retention_idx ON telemetry_metric_records(received_at);
ALTER TABLE incidents ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE incidents ALTER COLUMN environment_id DROP NOT NULL;
ALTER TABLE incidents ADD CONSTRAINT incidents_scope_ancestry CHECK(environment_id IS NULL OR project_id IS NOT NULL);
ALTER TABLE telemetry_sources ADD COLUMN health_cursor bigint, ADD COLUMN health_state text CHECK(health_state IN('healthy','degraded','unavailable','unknown')), ADD COLUMN health_observed_at timestamptz, ADD COLUMN health_received_at timestamptz;
