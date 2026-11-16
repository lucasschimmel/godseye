#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
echo "[p06] Installing PostgreSQL and pgBackRest..."
apt-get update
apt-get install -y postgresql pgbackrest

PG_VER="$(pg_lsclusters -h | awk 'NR==1{print $1}')"
PG_CLUSTER="$(pg_lsclusters -h | awk 'NR==1{print $2}')"
PG_DATA="/var/lib/postgresql/${PG_VER}/${PG_CLUSTER}"
PG_CONF="/etc/postgresql/${PG_VER}/${PG_CLUSTER}/postgresql.conf"

echo "[p06] Detected PostgreSQL ${PG_VER} cluster '${PG_CLUSTER}' at ${PG_DATA}"

# Generate high-entropy AES-256-CBC cipher passphrase if not already present
if ! grep -q '^PGBACKREST_REPO1_CIPHER_PASS=' /etc/pgbackrest/b2-s3.env; then
  CIPHER_PASS="$(openssl rand -base64 32)"
  cat >> /etc/pgbackrest/b2-s3.env <<EOF
PGBACKREST_REPO1_CIPHER_TYPE=aes-256-cbc
PGBACKREST_REPO1_CIPHER_PASS=${CIPHER_PASS}
EOF
  unset CIPHER_PASS
fi

chown postgres:postgres /etc/pgbackrest/b2-s3.env
chmod 600 /etc/pgbackrest/b2-s3.env

cat > /etc/pgbackrest/pgbackrest.conf <<EOF
[global]
repo1-type=s3
repo1-s3-uri-style=path
repo1-path=/pgbackrest
repo1-retention-full=2
repo1-retention-diff=7
repo1-cipher-type=aes-256-cbc
process-max=2
log-level-console=info
log-level-file=detail
start-fast=y

[main]
pg1-path=${PG_DATA}
EOF
chown postgres:postgres /etc/pgbackrest/pgbackrest.conf
chmod 640 /etc/pgbackrest/pgbackrest.conf

# Wrapper script so archive_command and systemd timers load /etc/pgbackrest/b2-s3.env safely
cat > /usr/local/bin/godseye-pgbackrest <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
set -a
source /etc/pgbackrest/b2-s3.env
set +a
exec /usr/bin/pgbackrest --config=/etc/pgbackrest/pgbackrest.conf "$@"
EOF
chmod 755 /usr/local/bin/godseye-pgbackrest

# Configure PostgreSQL WAL archiving for pgBackRest
cat > "/etc/postgresql/${PG_VER}/${PG_CLUSTER}/conf.d/99-godseye-pgbackrest.conf" <<'EOF'
archive_mode = on
archive_command = '/usr/local/bin/godseye-pgbackrest --stanza=main archive-push %p'
max_wal_senders = 3
wal_level = replica
EOF

systemctl restart postgresql

echo "[p06] Creating stanza and seeding drill database..."
su - postgres -c "/usr/local/bin/godseye-pgbackrest --stanza=main stanza-create"
su - postgres -c "/usr/local/bin/godseye-pgbackrest --stanza=main check"

su - postgres -c "psql -v ON_ERROR_STOP=1" <<'SQL'
DROP DATABASE IF EXISTS godseye_p06_drill;
CREATE DATABASE godseye_p06_drill;
\c godseye_p06_drill
CREATE TABLE drill_records (id serial PRIMARY KEY, marker text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO drill_records (marker) VALUES ('P06_RESTORE_DRILL_ROW_1'), ('P06_RESTORE_DRILL_ROW_2');
SQL

echo "[p06] Taking full encrypted backup to Backblaze B2..."
su - postgres -c "/usr/local/bin/godseye-pgbackrest --stanza=main --type=full backup"
su - postgres -c "/usr/local/bin/godseye-pgbackrest --stanza=main info"

echo "[p06] Simulating destructive database loss (stop PostgreSQL & wipe data dir)..."
systemctl stop postgresql
rm -rf "${PG_DATA:?}"/*

echo "[p06] Executing full restore from Backblaze B2 encrypted repository..."
su - postgres -c "/usr/local/bin/godseye-pgbackrest --stanza=main restore"
systemctl start postgresql

echo "[p06] Verifying recovered rows after restore..."
su - postgres -c "psql -d godseye_p06_drill -Atc 'SELECT id, marker FROM drill_records ORDER BY id;'"

# Clean up drill DB and install the backup schedule for the control database stanza (`main`):
# weekly full (Sunday), daily differential (Monday to Saturday) and an hourly archive check.
# Per-project cells use the same cadence through the godseye-pg-backup-*@ templates (see p10).
su - postgres -c "psql -c 'DROP DATABASE godseye_p06_drill;'"

declare -A CALENDAR=(
  [full]="Sun *-*-* 02:30:00 UTC"
  [diff]="Mon..Sat *-*-* 03:30:00 UTC"
  [check]="*-*-* *:17:00 UTC"
)
declare -A COMMAND=(
  [full]="--type=full --no-expire-auto backup"
  [diff]="--type=diff --no-expire-auto backup"
  [check]="check"
)
rm -f /etc/systemd/system/godseye-pgbackrest-backup.service /etc/systemd/system/godseye-pgbackrest-backup.timer
for kind in full diff check; do
  cat > "/etc/systemd/system/godseye-pgbackrest-${kind}.service" <<EOF
[Unit]
Description=G.O.D.S.E.Y.E PostgreSQL encrypted pgBackRest ${kind} (stanza main)
After=postgresql.service network-online.target

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/local/bin/godseye-pgbackrest --stanza=main ${COMMAND[$kind]}
EOF
  cat > "/etc/systemd/system/godseye-pgbackrest-${kind}.timer" <<EOF
[Unit]
Description=G.O.D.S.E.Y.E PostgreSQL pgBackRest ${kind} schedule (stanza main)

[Timer]
OnCalendar=${CALENDAR[$kind]}
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
done

systemctl daemon-reload
systemctl disable --now godseye-pgbackrest-backup.timer 2>/dev/null || true
systemctl enable --now godseye-pgbackrest-full.timer godseye-pgbackrest-diff.timer godseye-pgbackrest-check.timer
systemctl list-timers 'godseye-pgbackrest-*' --no-pager
