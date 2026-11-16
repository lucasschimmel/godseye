#!/usr/bin/env bash
# P11: removes one DISPOSABLE cell completely: stops it, deletes its stanza and backups from the
# off-host repository, removes the OpenBao escrow copy of its passphrase, then destroys its storage
# quota, configuration and timers through the root helper. Never run it against a real project cell.
# Usage (root): p11-cells-teardown.sh <allocation-uuid> [secrets-directory]
set -euo pipefail
ALLOCATION="${1:?allocation required}"
SECRETS="${2:-/var/lib/godseye/cells-proof/secrets}"
[[ "${ALLOCATION}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "invalid allocation" >&2; exit 64; }
CONF="/etc/godseye/pg/${ALLOCATION}"
BIN="$(jq -r .pgBackRestExecutable /etc/godseye/pg/host.json)"
HELPER=(/usr/bin/node /usr/local/lib/godseye/cell-helper.mjs)
ARGS=("--config=${CONF}/pgbackrest.conf" "--config-include-path=${CONF}/pgbackrest.conf.d" "--stanza=g_${ALLOCATION//-/}")

echo "[teardown] stopping ${ALLOCATION}"
for kind in full diff check; do systemctl disable --now "godseye-pg-backup-${kind}@${ALLOCATION}.timer" 2>/dev/null || true; done
systemctl disable --now "godseye-pg@${ALLOCATION}.service" 2>/dev/null || true

if [ -f "${CONF}/archive.env" ]; then
  echo "[teardown] deleting the stanza and its backups from the off-host repository"
  # The runtime directory (lock path) disappears with the stopped unit; recreate it for pgBackRest.
  install -d -m 0751 -o postgres -g postgres "/run/godseye-pg/${ALLOCATION}"
  (
    set -a
    # shellcheck disable=SC1091
    . /etc/godseye/pg/b2.env
    # shellcheck disable=SC1090
    . "${CONF}/archive.env"
    set +a
    runuser -u postgres -- env "PGBACKREST_REPO1_CIPHER_PASS=${PGBACKREST_REPO1_CIPHER_PASS}" \
      "PGBACKREST_REPO1_S3_KEY=${PGBACKREST_REPO1_S3_KEY}" \
      "PGBACKREST_REPO1_S3_KEY_SECRET=${PGBACKREST_REPO1_S3_KEY_SECRET}" \
      "${BIN}" "${ARGS[@]}" --log-level-console=off stop || true
    runuser -u postgres -- env "PGBACKREST_REPO1_CIPHER_PASS=${PGBACKREST_REPO1_CIPHER_PASS}" \
      "PGBACKREST_REPO1_S3_KEY=${PGBACKREST_REPO1_S3_KEY}" \
      "PGBACKREST_REPO1_S3_KEY_SECRET=${PGBACKREST_REPO1_S3_KEY_SECRET}" \
      "${BIN}" "${ARGS[@]}" --log-level-console=off --force stanza-delete
  )
fi

echo "[teardown] removing the OpenBao escrow copy"
(
  set -a
  # shellcheck disable=SC1091
  . /etc/godseye/openbao-approle.env
  set +a
  export BAO_ADDR="${OPENBAO_ADDR}" BAO_CACERT="${OPENBAO_CACERT}"
  BAO_TOKEN="$(bao write -field=token auth/approle/login role_id="${OPENBAO_ROLE_ID}" secret_id="${OPENBAO_SECRET_ID}")"
  export BAO_TOKEN
  bao kv metadata delete -mount=godseye "cells/${ALLOCATION}/pgbackrest" >/dev/null 2>&1 || true
)

echo "[teardown] destroying storage and configuration"
"${HELPER[@]}" destroy "${ALLOCATION}"
rm -rf "${SECRETS:?}/${ALLOCATION}"
echo "[teardown] done"
