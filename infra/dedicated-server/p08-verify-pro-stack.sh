#!/usr/bin/env bash
set -euo pipefail

for s in postgresql openbao redis-server caddy jenkins godseye-control-api godseye-console docker; do
  echo "${s}=$(systemctl is-active "$s")"
done
su - postgres -c "pgbackrest --stanza=main check"
echo "PGBACKREST_CHECK_OK"
docker ps --filter "name=godseye-cell-" --format "{{.Names}}|{{.Status}}|{{.Networks}}"
