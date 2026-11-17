/** Idempotent DDL applied at every start. Additive changes get a new statement, never an edit. */
export const BOARDS_MIGRATION = `
CREATE TABLE IF NOT EXISTS boards_user(id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,email_verified boolean NOT NULL DEFAULT false,image text,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS boards_session(id text PRIMARY KEY,user_id text NOT NULL REFERENCES boards_user(id) ON DELETE CASCADE,session_value text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,ip_address text,user_agent text);
CREATE TABLE IF NOT EXISTS boards_account(id text PRIMARY KEY,user_id text NOT NULL REFERENCES boards_user(id) ON DELETE CASCADE,account_id text NOT NULL,provider_id text NOT NULL,access_value text,refresh_value text,id_value text,password_hash text,scope text,access_expires_at timestamptz,refresh_expires_at timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS boards_verification(id text PRIMARY KEY,identifier text NOT NULL,value text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS boards(id text PRIMARY KEY,name text NOT NULL,owner_id text NOT NULL REFERENCES boards_user(id) ON DELETE CASCADE,scene jsonb NOT NULL,revision integer NOT NULL CHECK(revision>=0),created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS board_members(board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,user_id text NOT NULL REFERENCES boards_user(id) ON DELETE CASCADE,role text NOT NULL CHECK(role IN ('owner','editor','viewer')),created_at timestamptz NOT NULL,PRIMARY KEY(board_id,user_id));
CREATE INDEX IF NOT EXISTS board_members_user ON board_members(user_id);
CREATE TABLE IF NOT EXISTS board_files(board_id text NOT NULL REFERENCES boards(id) ON DELETE CASCADE,file_id text NOT NULL,mime_type text NOT NULL,data_url text NOT NULL,size integer NOT NULL CHECK(size>=0),created_at timestamptz NOT NULL,PRIMARY KEY(board_id,file_id));
`;
