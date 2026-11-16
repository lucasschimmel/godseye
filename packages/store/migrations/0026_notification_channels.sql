-- Owner notification channels. `sealed_target` is AES-256-GCM ciphertext (URL and optional signing
-- secret) under a key that never enters this database; `host` is the only plaintext part of the target.
CREATE TABLE notification_channels (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('webhook')),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 60),
 host text NOT NULL CHECK(host = lower(host) AND length(host) BETWEEN 4 AND 253),
 signed boolean NOT NULL,
 sealed_target text NOT NULL CHECK(length(sealed_target) BETWEEN 1 AND 8192),
 state text NOT NULL CHECK(state IN('active','removed')),
 revision integer NOT NULL CHECK(revision>0),
 test_state text NOT NULL CHECK(test_state IN('never','confirmed','failed','unknown')),
 test_at timestamptz,
 test_reason text CHECK(test_reason IN('TARGET_BLOCKED','DNS_FAILED','CONNECTION_FAILED','TLS_FAILED','TIMED_OUT','REJECTED','REDIRECT_REFUSED','SERVER_ERROR','NO_CONFIRMATION')),
 test_http_status integer CHECK(test_http_status BETWEEN 100 AND 599),
 test_attempts integer NOT NULL CHECK(test_attempts BETWEEN 0 AND 5),
 delivery_state text NOT NULL CHECK(delivery_state IN('never','confirmed','failed','unknown')),
 delivery_at timestamptz,
 delivery_reason text CHECK(delivery_reason IN('TARGET_BLOCKED','DNS_FAILED','CONNECTION_FAILED','TLS_FAILED','TIMED_OUT','REJECTED','REDIRECT_REFUSED','SERVER_ERROR','NO_CONFIRMATION')),
 delivery_http_status integer CHECK(delivery_http_status BETWEEN 100 AND 599),
 delivery_attempts integer NOT NULL CHECK(delivery_attempts BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 removed_at timestamptz,
 CHECK((state='removed')=(removed_at IS NOT NULL)),
 CHECK(test_state='never' OR test_at IS NOT NULL),
 CHECK(delivery_state='never' OR delivery_at IS NOT NULL)
);
CREATE INDEX notification_channels_live_idx ON notification_channels(created_at) WHERE state='active';
