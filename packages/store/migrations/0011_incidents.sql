CREATE TABLE database_rotations (
 id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),environment_id uuid NOT NULL REFERENCES environments(id),
 allocation_id uuid NOT NULL REFERENCES database_allocations(id),role text NOT NULL,slot_id uuid REFERENCES access_slots(id),
 state text NOT NULL CHECK(state IN('intended','applying','succeeded','failed','unknown')),reason text,
 generation integer NOT NULL CHECK(generation>0),attempts integer NOT NULL CHECK(attempts>=0),
 previous_verifier text,next_verifier text,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,settled_at timestamptz
);
CREATE UNIQUE INDEX database_rotations_active_key ON database_rotations(allocation_id,role) WHERE state IN('intended','applying','unknown');
CREATE INDEX database_rotations_allocation_idx ON database_rotations(allocation_id,created_at);
CREATE TABLE incidents (
 id uuid PRIMARY KEY,key text NOT NULL,kind text NOT NULL CHECK(kind IN('archive-lag','headroom','rotation-failure')),
 severity text NOT NULL CHECK(severity IN('warning','critical')),project_id uuid NOT NULL REFERENCES projects(id),
 environment_id uuid NOT NULL REFERENCES environments(id),allocation_id uuid REFERENCES database_allocations(id),subject text,
 state text NOT NULL CHECK(state IN('open','acknowledged','resolved')),reason text NOT NULL,summary text NOT NULL,
 occurrences integer NOT NULL CHECK(occurrences>0),revision integer NOT NULL CHECK(revision>0),
 muted_until timestamptz,resolution text CHECK(resolution IN('manual','cleared')),
 delivery_state text NOT NULL CHECK(delivery_state IN('unconfigured','pending','notified','failed')),
 delivery_attempts integer NOT NULL CHECK(delivery_attempts>=0),delivery_attempted_at timestamptz,
 first_raised_at timestamptz NOT NULL,last_raised_at timestamptz NOT NULL,acknowledged_at timestamptz,resolved_at timestamptz
);
CREATE UNIQUE INDEX incidents_active_key ON incidents(key) WHERE state<>'resolved';
CREATE INDEX incidents_scope_idx ON incidents(project_id,environment_id,last_raised_at);
