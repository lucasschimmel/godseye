#!/usr/bin/env bash
# P10: host prerequisites for per-cell PostgreSQL 18 + pgBackRest 2.60 (project cells). Idempotent.
#
# Runs as root on the pro VM. The control database stays on the existing PostgreSQL 17 cluster and
# on the distribution pgBackRest; this script verifies that the PG17 postmaster is not restarted.
#
# Design decisions (see docs/development/dedicated-cells.md):
# - Storage: the VM root is an ext4 virtual disk, so there is no ZFS to quota. A dedicated virtual
#   disk (added from the host with `qm set 100 --scsi1 local-zfs:120,...,serial=GODSEYECELLS01`) is
#   formatted XFS and mounted with `prjquota`; every cell directory is an XFS project with a hard limit.
# - PGDG key fingerprint is verified; PGDG is pinned to priority 100 so no Debian package is replaced.
# - pgBackRest 2.60 is unpacked next to the distribution 2.55 (no upgrade of the control stanza's tool).
#
# Rollback: systemctl disable --now godseye-cell-helper.socket; remove /etc/systemd/system/godseye-*
# cell units; umount the volume and drop its fstab line; apt-get remove postgresql-18 postgresql-client-18;
# remove /opt/pgbackrest-2.60.0; on the host: qm set 100 --delete scsi1 (then destroy the unused disk).
#
# Optional inputs: GODSEYE_PG_BIND_ADDRESS (default 127.0.0.1), GODSEYE_PG_SERVERNAME,
# GODSEYE_PG_PORT_LOW/HIGH, GODSEYE_PG_MOUNT_ROOT, GODSEYE_PG_DISK_SERIAL, GODSEYE_PG_DEVICE,
# GODSEYE_PG_HELPER_BUNDLE (built by `node scripts/build-cell-helper.mjs`).
set -euo pipefail

BIND_ADDRESS="${GODSEYE_PG_BIND_ADDRESS:-127.0.0.1}"
SERVERNAME="${GODSEYE_PG_SERVERNAME:-cells.godseye.internal}"
PORT_LOW="${GODSEYE_PG_PORT_LOW:-15432}"
PORT_HIGH="${GODSEYE_PG_PORT_HIGH:-15531}"
MOUNT_ROOT="${GODSEYE_PG_MOUNT_ROOT:-/srv/godseye/pg}"
DISK_SERIAL="${GODSEYE_PG_DISK_SERIAL:-GODSEYECELLS01}"
HELPER_BUNDLE="${GODSEYE_PG_HELPER_BUNDLE:-/opt/godseye/dist/cell-helper/cell-helper.mjs}"
S3_PATH_PREFIX="${GODSEYE_PG_S3_PREFIX:-/cells}"
PGBACKREST_PACKAGE_VERSION="2.60.0-1.pgdg13+1"
PGBACKREST_DIR="/opt/pgbackrest-2.60.0"
PGDG_KEY_FINGERPRINT="B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8"
SRC="$(cd "$(dirname "$0")" && pwd)"

[[ "${MOUNT_ROOT}" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "invalid mount root" >&2; exit 64; }
[[ "${BIND_ADDRESS}" =~ ^[0-9a-fA-F:.]+$ ]] || { echo "invalid bind address" >&2; exit 64; }
[ "$(id -u)" = 0 ] || { echo "must run as root" >&2; exit 77; }
export DEBIAN_FRONTEND=noninteractive

pg17_pid() { systemctl show -p MainPID --value postgresql@17-main.service; }
PG17_BEFORE="$(pg17_pid)"
echo "[p10] PostgreSQL 17 control cluster MainPID before: ${PG17_BEFORE}"

echo "[p10] PGDG repository (verified key, priority 100)"
install -d -m 0755 /etc/apt/keyrings
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "${WORK}/pgdg.asc"
FPR="$(gpg --show-keys --with-colons "${WORK}/pgdg.asc" | awk -F: '/^fpr/ {print $10; exit}')"
[ "${FPR}" = "${PGDG_KEY_FINGERPRINT}" ] || { echo "PGDG key fingerprint mismatch" >&2; exit 65; }
install -m 0644 "${WORK}/pgdg.asc" /etc/apt/keyrings/postgresql-pgdg.asc
cat >/etc/apt/sources.list.d/pgdg.sources <<'EOF'
Types: deb
URIs: https://apt.postgresql.org/pub/repos/apt
Suites: trixie-pgdg
Components: main
Signed-By: /etc/apt/keyrings/postgresql-pgdg.asc
EOF
cat >/etc/apt/preferences.d/pgdg <<'EOF'
Package: *
Pin: origin apt.postgresql.org
Pin-Priority: 100
EOF
apt-get update -qq

echo "[p10] PostgreSQL 18 without a default cluster"
install -d -m 0755 /etc/postgresql-common
if grep -q '^#\?create_main_cluster' /etc/postgresql-common/createcluster.conf 2>/dev/null; then
  sed -i 's/^#\?create_main_cluster.*/create_main_cluster = false/' /etc/postgresql-common/createcluster.conf
else
  echo 'create_main_cluster = false' >>/etc/postgresql-common/createcluster.conf
fi
SIMULATION="$(apt-get -s install --no-install-recommends postgresql-18 postgresql-client-18 xfsprogs jq)"
if grep -E '^(Remv|Inst) (postgresql-17|postgresql-client-17|postgresql-common|postgresql-client-common)' <<<"${SIMULATION}" >/dev/null; then
  echo "refusing: the install would change PostgreSQL 17 or common packages" >&2
  grep -E '^(Remv|Inst) ' <<<"${SIMULATION}" >&2
  exit 66
fi
apt-get install -y -qq --no-install-recommends postgresql-18 postgresql-client-18 xfsprogs jq
apt-mark hold postgresql-18 postgresql-client-18 >/dev/null
# A packaged "18 main" cluster must never exist; remove it only if the package created one.
if pg_lsclusters -h | awk '$1==18 && $2=="main" {found=1} END {exit !found}'; then
  pg_dropcluster 18 main --stop
fi
systemctl disable --now postgresql@18-main.service 2>/dev/null || true
/usr/lib/postgresql/18/bin/postgres --version | grep -q '^postgres (PostgreSQL) 18\.'

echo "[p10] pgBackRest ${PGBACKREST_PACKAGE_VERSION} side by side (distribution tool untouched)"
if [ ! -x "${PGBACKREST_DIR}/usr/bin/pgbackrest" ]; then
  (cd "${WORK}" && apt-get download "pgbackrest=${PGBACKREST_PACKAGE_VERSION}")
  install -d -m 0755 "${PGBACKREST_DIR}"
  dpkg-deb -x "${WORK}"/pgbackrest_*.deb "${PGBACKREST_DIR}"
fi
if ldd "${PGBACKREST_DIR}/usr/bin/pgbackrest" | grep -q 'not found'; then
  echo "pgBackRest has unresolved libraries:" >&2
  ldd "${PGBACKREST_DIR}/usr/bin/pgbackrest" | grep 'not found' >&2
  exit 67
fi
"${PGBACKREST_DIR}/usr/bin/pgbackrest" version | grep -q '^pgBackRest 2\.60'

echo "[p10] Quota-enabled XFS volume at ${MOUNT_ROOT}"
if ! findmnt -n --mountpoint "${MOUNT_ROOT}" >/dev/null; then
  DEVICE="${GODSEYE_PG_DEVICE:-}"
  if [ -z "${DEVICE}" ]; then
    DEVICE="$(lsblk -dnpo PATH,SERIAL | awk -v s="${DISK_SERIAL}" '$2==s {print $1; exit}')"
  fi
  [ -n "${DEVICE}" ] && [ -b "${DEVICE}" ] || { echo "cell disk (serial ${DISK_SERIAL}) not found" >&2; exit 68; }
  if ! blkid "${DEVICE}" >/dev/null 2>&1; then
    mkfs.xfs -L GODSEYE_CELLS "${DEVICE}"
  fi
  [ "$(blkid -s TYPE -o value "${DEVICE}")" = xfs ] || { echo "cell disk is not XFS" >&2; exit 69; }
  UUID="$(blkid -s UUID -o value "${DEVICE}")"
  install -d -m 0711 "${MOUNT_ROOT}"
  grep -q "^UUID=${UUID} " /etc/fstab || \
    echo "UUID=${UUID} ${MOUNT_ROOT} xfs defaults,noatime,prjquota,nofail 0 2" >>/etc/fstab
  systemctl daemon-reload
  mount "${MOUNT_ROOT}"
fi
findmnt -n -o FSTYPE,OPTIONS --mountpoint "${MOUNT_ROOT}" | grep -E '^xfs .*prjquota' >/dev/null
chmod 0711 "${MOUNT_ROOT}"
touch /etc/projects /etc/projid
systemctl enable --now fstrim.timer >/dev/null 2>&1 || true

echo "[p10] Accounts, directories, private cell CA"
id -u godseye >/dev/null 2>&1 || { echo "godseye user missing (run p07 first)" >&2; exit 65; }
install -d -m 0755 /etc/godseye /etc/godseye/pg /usr/local/lib/godseye
install -d -m 0750 -o root -g postgres /etc/godseye/pki
install -d -m 0750 -o postgres -g godseye /var/lib/godseye/pg-backup
install -d -m 0711 -o root -g root /run/godseye-pg
cat >/etc/tmpfiles.d/godseye-pg.conf <<'EOF'
d /run/godseye-pg 0711 root root -
EOF
if [ ! -f /etc/godseye/pki/cells-ca.key ]; then
  umask 077
  openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out /etc/godseye/pki/cells-ca.key
  openssl req -x509 -new -key /etc/godseye/pki/cells-ca.key -sha256 -days 3650 \
    -subj "/O=G.O.D.S.E.Y.E/CN=cell CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out /etc/godseye/pki/cells-ca.crt
  chmod 0600 /etc/godseye/pki/cells-ca.key
  chmod 0644 /etc/godseye/pki/cells-ca.crt
fi

echo "[p10] Off-host repository settings (reused from the control stanza; secrets are never printed)"
CONTROL_CONF=/etc/pgbackrest/pgbackrest.conf
conf_value() { awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' "${CONTROL_CONF}"; }
S3_BUCKET="$(conf_value repo1-s3-bucket)"
S3_ENDPOINT="$(conf_value repo1-s3-endpoint)"
S3_REGION="$(conf_value repo1-s3-region)"
[ -n "${S3_BUCKET}" ] && [ -n "${S3_ENDPOINT}" ] && [ -n "${S3_REGION}" ] || { echo "control stanza S3 settings missing" >&2; exit 70; }
if [ ! -f /etc/godseye/pg/b2.env ]; then
  S3_KEY="$(conf_value repo1-s3-key)"
  S3_SECRET="$(conf_value repo1-s3-key-secret)"
  [ -n "${S3_KEY}" ] && [ -n "${S3_SECRET}" ] || { echo "control stanza S3 credentials missing" >&2; exit 70; }
  (umask 077; printf 'PGBACKREST_REPO1_S3_KEY=%s\nPGBACKREST_REPO1_S3_KEY_SECRET=%s\n' "${S3_KEY}" "${S3_SECRET}" >/etc/godseye/pg/b2.env)
  chown root:root /etc/godseye/pg/b2.env
  chmod 0600 /etc/godseye/pg/b2.env
  unset S3_KEY S3_SECRET
fi

echo "[p10] Host configuration, helper, units"
jq -n --arg mount "${MOUNT_ROOT}" --arg bind "${BIND_ADDRESS}" --arg name "${SERVERNAME}" \
  --argjson low "${PORT_LOW}" --argjson high "${PORT_HIGH}" \
  --arg bucket "${S3_BUCKET}" --arg endpoint "${S3_ENDPOINT}" --arg region "${S3_REGION}" \
  --arg prefix "${S3_PATH_PREFIX}" --arg bin "${PGBACKREST_DIR}/usr/bin/pgbackrest" \
  '{mountRoot:$mount, bindAddress:$bind, servername:$name, portRange:[$low,$high],
    pgBackRestExecutable:$bin, repositoryQuotaGiB:0,
    s3Repository:{bucket:$bucket, endpoint:$endpoint, region:$region, pathPrefix:$prefix}}' \
  >/etc/godseye/pg/host.json.new
chmod 0644 /etc/godseye/pg/host.json.new
mv -f /etc/godseye/pg/host.json.new /etc/godseye/pg/host.json
chown root:root /etc/godseye/pg/host.json
printf 'BIND_ADDRESS=%s\n' "${BIND_ADDRESS}" >/etc/godseye/pg/host.env
chmod 0644 /etc/godseye/pg/host.env

[ -f "${HELPER_BUNDLE}" ] || { echo "helper bundle missing: ${HELPER_BUNDLE}" >&2; exit 71; }
install -m 0644 -o root -g root "${HELPER_BUNDLE}" /usr/local/lib/godseye/cell-helper.mjs
install -m 0750 -o root -g root "${SRC}/bin/godseye-pg-backup" /usr/local/sbin/godseye-pg-backup
install -m 0750 -o root -g root "${SRC}/bin/godseye-pg-issue-cert" /usr/local/sbin/godseye-pg-issue-cert
for unit in "${SRC}"/units/godseye-pg@.service "${SRC}"/units/godseye-pg-backup-*@.service \
  "${SRC}"/units/godseye-pg-backup-*@.timer "${SRC}"/units/godseye-cell-helper.socket \
  "${SRC}"/units/godseye-cell-helper@.service; do
  install -m 0644 "${unit}" "/etc/systemd/system/$(basename "${unit}")"
done
cat >/etc/systemd/system/godseye-pg.slice <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E PostgreSQL cells
[Slice]
MemoryAccounting=true
CPUAccounting=true
IOAccounting=true
TasksAccounting=true
EOF
systemd-analyze verify /etc/systemd/system/godseye-pg@.service \
  /etc/systemd/system/godseye-cell-helper.socket || true
systemctl daemon-reload
systemctl enable --now godseye-cell-helper.socket

PG17_AFTER="$(pg17_pid)"
[ "${PG17_BEFORE}" = "${PG17_AFTER}" ] || { echo "PG17 MainPID changed (${PG17_BEFORE} -> ${PG17_AFTER})" >&2; exit 72; }
echo "[p10] PostgreSQL 17 control cluster untouched (MainPID ${PG17_AFTER})"
/usr/bin/node /usr/local/lib/godseye/cell-helper.mjs host-probe
echo "[p10] Installed. Cells are created by the control transport; the proof harness is p11."
