#!/usr/bin/env bash
# P11: escrows one cell's pgBackRest repository cipher passphrase in OpenBao (KV v2 under
# godseye/cells/<allocation>/pgbackrest) using the control AppRole. Idempotent; never prints the value.
# Usage (root): p11-cells-escrow-cipher.sh <allocation-uuid> [secrets-directory]
set -euo pipefail
ALLOCATION="${1:?allocation required}"
SECRETS="${2:-/var/lib/godseye/cells-proof/secrets}"
[[ "${ALLOCATION}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "invalid allocation" >&2; exit 64; }
FILE="${SECRETS}/${ALLOCATION}/repository.pass"
[ -s "${FILE}" ] || { echo "passphrase file missing for ${ALLOCATION}" >&2; exit 66; }
set -a
# shellcheck disable=SC1091
. /etc/godseye/openbao-approle.env
set +a
export BAO_ADDR="${OPENBAO_ADDR}" BAO_CACERT="${OPENBAO_CACERT}"
BAO_TOKEN="$(bao write -field=token auth/approle/login role_id="${OPENBAO_ROLE_ID}" secret_id="${OPENBAO_SECRET_ID}")"
export BAO_TOKEN
# The stored value must match what the cell's root-owned archive.env uses.
if ! grep -q "^PGBACKREST_REPO1_CIPHER_PASS=$(tr -d '\n' <"${FILE}")\$" "/etc/godseye/pg/${ALLOCATION}/archive.env"; then
  echo "passphrase file and archive.env differ" >&2
  exit 67
fi
bao kv put -mount=godseye "cells/${ALLOCATION}/pgbackrest" cipher_pass=@"${FILE}" >/dev/null
echo "escrowed cells/${ALLOCATION}/pgbackrest: version $(bao kv metadata get -mount=godseye -format=json "cells/${ALLOCATION}/pgbackrest" | jq -r '.data.current_version')"
unset BAO_TOKEN
