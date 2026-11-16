-- Owner-confirmed activation of a verified held restore. One row per restored environment: it is the
-- durable intent (fence first, promote second, designate last) so a crash or lost provider acknowledgment
-- stays visible and is resumed, never replayed blindly.
CREATE TABLE recovery_activations (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id),
 environment_id uuid NOT NULL UNIQUE REFERENCES environments(id),
 source_environment_id uuid NOT NULL REFERENCES environments(id),
 preparation_id uuid NOT NULL REFERENCES recovery_preparations(id),
 state text NOT NULL CHECK(state IN('fenced','unknown','activated')),
 epoch integer NOT NULL CHECK(epoch>0),
 acknowledged jsonb NOT NULL,
 reason text,
 evidence text,
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 activated_at timestamptz,
 CHECK((state='activated')=(activated_at IS NOT NULL))
);
CREATE INDEX recovery_activations_project_idx ON recovery_activations(project_id,created_at);
