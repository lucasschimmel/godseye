CREATE TABLE owner_user (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL,
  image text, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE owner_identity (singleton integer PRIMARY KEY CHECK(singleton=1), user_id text NOT NULL UNIQUE REFERENCES owner_user(id));
CREATE TABLE owner_session (
  id text PRIMARY KEY, session_value text NOT NULL UNIQUE, user_id text NOT NULL REFERENCES owner_user(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
  ip_address text, user_agent text
);
CREATE TABLE owner_account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES owner_user(id),
  access_value text, refresh_value text, id_value text, password_hash text, scope text,
  access_expires_at timestamptz, refresh_expires_at timestamptz, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE owner_verification (
  id text PRIMARY KEY, identifier text NOT NULL UNIQUE, value text NOT NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE owner_passkey (
  id text PRIMARY KEY, name text, public_key text NOT NULL, user_id text NOT NULL REFERENCES owner_user(id),
  authenticator_id text NOT NULL UNIQUE, counter bigint NOT NULL CHECK(counter>=0),
  device_type text NOT NULL, backed_up boolean NOT NULL, transports text, created_at timestamptz, aaguid text
);
CREATE TABLE owner_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text NOT NULL, action text NOT NULL, entity_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE owner_receipts (id text PRIMARY KEY, fingerprint text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE owner_throttle (bucket text PRIMARY KEY, attempts integer NOT NULL CHECK(attempts>=0));
CREATE INDEX owner_session_user_idx ON owner_session(user_id);
CREATE INDEX owner_passkey_user_idx ON owner_passkey(user_id);

-- The authentication mutation and its audit outbox event share the same database commit.
CREATE FUNCTION owner_record_auth_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data record; entity_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  IF TG_TABLE_NAME = 'owner_session' THEN entity_kind := 'session'; ELSE entity_kind := 'passkey'; END IF;
  INSERT INTO owner_events(owner_id,action,entity_id)
    VALUES(row_data.user_id, 'owner.' || entity_kind || CASE WHEN TG_OP='DELETE' THEN '.revoked' ELSE '.created' END, row_data.id);
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER owner_session_events AFTER INSERT OR DELETE ON owner_session FOR EACH ROW EXECUTE FUNCTION owner_record_auth_event();
CREATE TRIGGER owner_passkey_events AFTER INSERT OR DELETE ON owner_passkey FOR EACH ROW EXECUTE FUNCTION owner_record_auth_event();
