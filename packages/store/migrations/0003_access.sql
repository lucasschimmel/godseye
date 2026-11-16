CREATE TABLE service_identities (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id),
 environment_id uuid NOT NULL REFERENCES environments(id),
 purpose text NOT NULL CHECK (purpose IN ('runtime','migration','deploy','backup')),
 name text NOT NULL, worker_id text, epoch integer NOT NULL CHECK(epoch>0),
 revision integer NOT NULL CHECK(revision>0), status text NOT NULL CHECK(status IN ('active','revoked')),
 proof_digest text, proof_issued boolean NOT NULL DEFAULT false,
 expires_at timestamptz, created_at timestamptz NOT NULL,
 CHECK ((purpose='runtime' AND worker_id IS NULL) OR (purpose<>'runtime' AND worker_id IS NOT NULL))
);
CREATE TABLE access_slots (
 id uuid PRIMARY KEY, identity_id uuid NOT NULL REFERENCES service_identities(id), name text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), active_version integer, staged_version integer,
 state text NOT NULL CHECK(state IN ('empty','staged','active','unknown')),
 UNIQUE(identity_id,name)
);
CREATE TABLE access_operations (
 id uuid PRIMARY KEY, slot_id uuid NOT NULL REFERENCES access_slots(id),
 kind text NOT NULL CHECK(kind IN ('stage','activate')),
 state text NOT NULL CHECK(state IN ('pending','unknown','succeeded','failed')),
 material_fingerprint text, candidate_version integer NOT NULL CHECK(candidate_version>0),
 previous_version integer, expected_provider_version integer NOT NULL CHECK(expected_provider_version>=0),
 adapter_id text, receipt text, created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX access_one_unresolved ON access_operations(slot_id) WHERE state IN ('pending','unknown');
