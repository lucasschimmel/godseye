/** Additive schema, deliberately separate from the original checked application schema hash. */
export const APPLICATION_JOBS_MIGRATION = `
CREATE TABLE IF NOT EXISTS app_job_events(id text PRIMARY KEY,event_key text NOT NULL UNIQUE,envelope jsonb NOT NULL,delivered_at timestamptz,created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS app_job_events_pending ON app_job_events(created_at) WHERE delivered_at IS NULL;
ALTER TABLE app_job_events ADD COLUMN IF NOT EXISTS settled_at timestamptz;
`;
