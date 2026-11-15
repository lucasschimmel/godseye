#!/usr/bin/env bash
# P10: host prerequisites for per-cell PostgreSQL 18 + pgBackRest 2.60 (project cells).
# TEMPLATE ONLY: committed for review, never executed by the repository or CI. The control database
# stays on the existing PostgreSQL 17 cluster; this script must not touch it.
#
# Required owner inputs (no defaults for storage layout):
#   GODSEYE_PG_ZFS_PARENT   parent dataset for cells, e.g. <pool>/godseye/pg (must not exist yet or be empty)
#   GODSEYE_PG_MOUNT_ROOT   its mountpoint, e.g. /srv/godseye/pg
#   GODSEYE_PG_BIND_ADDRESS loopback or the private cell-bridge address of this VM
#   GODSEYE_PG_PARENT_QUOTA_GIB  total quota for the parent (hard cap for all cells combined)
set -euo pipefail

: "${GODSEYE_PG_ZFS_PARENT:?owner input required}"
: "${GODSEYE_PG_MOUNT_ROOT:?owner input required}"
: "${GODSEYE_PG_BIND_ADDRESS:?owner input required}"
: "${GODSEYE_PG_PARENT_QUOTA_GIB:?owner input required}"
PGBACKREST_VERSION_PREFIX="2.60"
SRC="$(cd "$(dirname "$0")" && pwd)"

[[ "${GODSEYE_PG_MOUNT_ROOT}" =~ ^/[A-Za-z0-9_./-]+$ ]] || { echo "invalid mount root" >&2; exit 64; }
[[ "${GODSEYE_PG_BIND_ADDRESS}" =~ ^[0-9a-fA-F:.]+$ ]] || { echo "invalid bind address" >&2; exit 64; }

echo "[p10] PGDG repository (PostgreSQL 18, pgBackRest ${PGBACKREST_VERSION_PREFIX}.x)"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq postgresql-common ca-certificates openssl jq
# Official PGDG helper; trust anchors come from the postgresql-common package.
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
# Never auto-create a default cluster: the existing PG17 control database must be left alone and
# every project cell is created by the control transport with its own initdb.
install -d -m 0755 /etc/postgresql-common
if grep -q '^#\?create_main_cluster' /etc/postgresql-common/createcluster.conf 2>/dev/null; then
  sed -i 's/^#\?create_main_cluster.*/create_main_cluster = false/' /etc/postgresql-common/createcluster.conf
else
  echo 'create_main_cluster = false' >>/etc/postgresql-common/createcluster.conf
fi
apt-get install -y -qq "postgresql-18" "pgbackrest=${PGBACKREST_VERSION_PREFIX}*"
apt-mark hold pgbackrest postgresql-18 >/dev/null
# The packaged template service must not start any cluster on its own.
systemctl disable --now "postgresql@18-main.service" 2>/dev/null || true
/usr/lib/postgresql/18/bin/postgres --version | grep -q '^postgres (PostgreSQL) 18\.'
pgbackrest version | grep -q "^pgBackRest ${PGBACKREST_VERSION_PREFIX}"

echo "[p10] Accounts and directories"
id -u godseye >/dev/null 2>&1 || { echo "godseye user missing (run p07 first)" >&2; exit 65; }
# The control user reaches cell sockets and admin password files through the postgres group.
usermod -aG postgres godseye
install -d -m 0755 /etc/godseye /etc/godseye/pg
install -d -m 0750 -o root -g postgres /etc/godseye/pki
install -d -m 0750 -o postgres -g godseye /var/lib/godseye/pg-backup
install -d -m 0711 -o root -g root /run/godseye-pg
printf 'BIND_ADDRESS=%s\n' "${GODSEYE_PG_BIND_ADDRESS}" >/etc/godseye/pg/host.env
chmod 0644 /etc/godseye/pg/host.env

echo "[p10] Private cell CA (root-only key); skip if present"
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

echo "[p10] ZFS parent dataset with a hard quota (cells are created as children by the control transport)"
if ! zfs list -H -o name "${GODSEYE_PG_ZFS_PARENT}" >/dev/null 2>&1; then
  zfs create -p -o mountpoint="${GODSEYE_PG_MOUNT_ROOT}" -o compression=lz4 -o atime=off \
    -o quota="${GODSEYE_PG_PARENT_QUOTA_GIB}G" "${GODSEYE_PG_ZFS_PARENT}"
fi
chmod 0711 "${GODSEYE_PG_MOUNT_ROOT}"

echo "[p10] Helpers and units"
install -m 0750 -o root -g root "${SRC}/bin/godseye-pg-backup" /usr/local/sbin/godseye-pg-backup
install -m 0750 -o root -g root "${SRC}/bin/godseye-pg-issue-cert" /usr/local/sbin/godseye-pg-issue-cert
for unit in "${SRC}"/units/godseye-pg@.service "${SRC}"/units/godseye-pg-backup-*@.service \
  "${SRC}"/units/godseye-pg-backup-*@.timer; do
  install -m 0644 "${unit}" "/etc/systemd/system/$(basename "${unit}")"
done
# Resource slice shared by all cells; per-cell ceilings are set from the admitted profile.
cat >/etc/systemd/system/godseye-pg.slice <<'EOF'
[Unit]
Description=G.O.D.S.E.Y.E PostgreSQL cells
[Slice]
MemoryAccounting=true
CPUAccounting=true
IOAccounting=true
TasksAccounting=true
EOF
systemd-analyze verify /etc/systemd/system/godseye-pg@.service || true
systemctl daemon-reload

cat <<EOF
[p10] Installed. Not done here (owner decisions, see docs/development/dedicated-cells.md):
  - a reviewed sudoers drop-in letting the godseye user run ONLY the fixed cell commands
  - per-cell backup timers are enabled by the control transport after provisioning:
      systemctl enable --now godseye-pg-backup-{full,diff,check}@<allocation>.timer
  - an off-host repository mirror (the per-cell repo dataset is on the same host)
EOF
