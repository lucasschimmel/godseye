#!/usr/bin/env bash
set -euo pipefail

export BAO_ADDR="https://127.0.0.1:8200"
export BAO_CACERT="/etc/openbao/bao.crt"

ROOT_TOKEN="$(python3 -c 'import json; print(json.load(open("/root/openbao-init-DO-NOT-COMMIT.json"))["root_token"])')"
export BAO_TOKEN="$ROOT_TOKEN"

# 1. Enable KV v2 at godseye/ and AppRole auth
bao secrets list -format=json | python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(0 if "godseye/" in d else 1)' || \
  bao secrets enable -path=godseye kv-v2

bao auth list -format=json | python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(0 if "approle/" in d else 1)' || \
  bao auth enable approle

bao policy write godseye-control-policy - <<'EOF'
path "godseye/data/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "godseye/metadata/*" {
  capabilities = ["list", "read", "delete"]
}
EOF

bao write auth/approle/role/godseye-control-api \
  token_policies="godseye-control-policy" \
  token_ttl=1h \
  token_max_ttl=24h

ROLE_ID="$(bao read -field=role_id auth/approle/role/godseye-control-api/role-id)"
SECRET_ID="$(bao write -f -field=secret_id auth/approle/role/godseye-control-api/secret-id)"

install -d -m 0700 /etc/godseye
cat >/etc/godseye/openbao-approle.env <<EOF
OPENBAO_ADDR=https://127.0.0.1:8200
OPENBAO_CACERT=/etc/openbao/bao.crt
OPENBAO_ROLE_ID=${ROLE_ID}
OPENBAO_SECRET_ID=${SECRET_ID}
EOF
chmod 0600 /etc/godseye/openbao-approle.env

# Verify AppRole login works without printing tokens
bao write -format=json auth/approle/login role_id="$ROLE_ID" secret_id="$SECRET_ID" | python3 -c 'import sys,json; assert json.load(sys.stdin)["auth"]["client_token"]'
echo "OPENBAO_APPROLE_LOGIN_OK"

# 2. Create PostgreSQL role and database for godseye control plane
if [ ! -f /etc/godseye/control-api.env ]; then
  DB_PASS="$(openssl rand -hex 24)"

  su - postgres -c "psql -v ON_ERROR_STOP=1" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'godseye') THEN
    CREATE ROLE godseye WITH LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE godseye WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
  su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='godseye'\"" | grep -q 1 || \
    su - postgres -c "createdb -O godseye godseye"

  cat >/etc/godseye/control-api.env <<EOF
GODSEYE_DATABASE_URL=postgresql://godseye:${DB_PASS}@127.0.0.1:5432/godseye
EOF
  chmod 0600 /etc/godseye/control-api.env
fi

su - postgres -c "psql -tAc \"SELECT datname FROM pg_database WHERE datname='godseye'\""
unset BAO_TOKEN ROOT_TOKEN ROLE_ID SECRET_ID
