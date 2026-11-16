#!/usr/bin/env bash
# P12: daily file/auth/config snapshots of the cell host and an OpenBao raft snapshot job (run as root
# on godseye-pro; idempotent). Rollback: systemctl disable --now godseye-cell-snapshot.timer
# godseye-bao-snapshot.timer; rm the two units, the two scripts and /var/backups/godseye-snapshots.
#
# Why: the cell data disk (`scsi1`, XFS quotas) has backup=0, so the nightly host vzdump does not
# contain per-cell configuration, TLS material, role files, pgBackRest configuration or the
# service environment. PostgreSQL data itself is protected by the per-cell pgBackRest stanza. The
# snapshots land on the root disk (`scsi0`), which vzdump includes, then travel through the existing
# encrypted off-host restic copy. They contain secrets by design (needed to rebuild a cell), so the
# directory is root-only 0700 and files are 0600; they are never copied unencrypted anywhere.
#
# The vzdump runs at 02:00 UTC; the cell snapshot runs at 01:40 UTC, the OpenBao snapshot at 01:50.
# OpenBao snapshots need a token for the policy in templates/godseye-raft-snapshot.hcl. The AppRole
# credentials come from the owner script p12-openbao-owner-setup.sh; until
# /etc/godseye/bao-snapshot-approle/{role_id,secret_id} exist the timer stays disabled.
set -euo pipefail
umask 077

DEST=/var/backups/godseye-snapshots
KEEP_CELLS="${GODSEYE_SNAPSHOT_KEEP:-7}"
STATUS=/var/lib/godseye/status
install -d -m 0700 "$DEST" "$STATUS" /usr/local/sbin

cat >/usr/local/sbin/godseye-cell-snapshot <<'SNAP'
#!/usr/bin/env bash
# Tars the cell host's configuration, certificates, role files and service environment (not PGDATA).
set -euo pipefail
umask 077
DEST=/var/backups/godseye-snapshots
KEEP="${GODSEYE_SNAPSHOT_KEEP:-7}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DEST/cells-config-$TS.tar.gz"
PATHS=()
for p in /etc/godseye /etc/pgbackrest /etc/systemd/system/godseye-pg@.service /etc/systemd/system/godseye-cell-helper.socket \
  /etc/systemd/system/godseye-cell-helper@.service /usr/local/lib/godseye /var/lib/godseye/state; do
  [ -e "$p" ] && PATHS+=("$p")
done
tar --warning=no-file-changed -czf "$OUT.tmp" --one-file-system "${PATHS[@]}"
tar -tzf "$OUT.tmp" >/dev/null
mv -f "$OUT.tmp" "$OUT"
sha256sum "$OUT" >"$OUT.sha256"
ls -1t "$DEST"/cells-config-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done
SIZE="$(stat -c %s "$OUT")"
printf '{"ts":"%s","file":"%s","bytes":%s,"ok":true}\n' "$TS" "$OUT" "$SIZE" >/var/lib/godseye/status/cell-snapshot.json
echo "CELL_SNAPSHOT_OK $OUT $SIZE bytes"
SNAP
chmod 0750 /usr/local/sbin/godseye-cell-snapshot

cat >/usr/local/sbin/godseye-bao-snapshot <<'SNAP'
#!/usr/bin/env bash
# Saves an OpenBao raft snapshot using a snapshot-only AppRole. The token and the secret id never
# reach argv or the log. Exits 75 when OpenBao is sealed (retried by the next timer run).
set -euo pipefail
umask 077
DEST=/var/backups/godseye-snapshots
KEEP="${GODSEYE_SNAPSHOT_KEEP:-7}"
DIR=/etc/godseye/bao-snapshot-approle
export BAO_ADDR=https://127.0.0.1:8200 BAO_CACERT=/etc/openbao/bao.crt
sealed="$(bao status -format=json 2>/dev/null | jq -r '.sealed' || true)"
[ "$sealed" = "false" ] || { echo "OpenBao sealed or unreachable" >&2; exit 75; }
BAO_TOKEN="$(bao write -field=token auth/approle/login role_id="$(cat "$DIR/role_id")" secret_id=@"$DIR/secret_id")"
export BAO_TOKEN
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DEST/openbao-raft-$TS.snap"
bao operator raft snapshot save "$OUT.tmp"
[ -s "$OUT.tmp" ] && mv -f "$OUT.tmp" "$OUT"
sha256sum "$OUT" >"$OUT.sha256"
ls -1t "$DEST"/openbao-raft-*.snap 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done
printf '{"ts":"%s","file":"%s","bytes":%s,"ok":true}\n' "$TS" "$OUT" "$(stat -c %s "$OUT")" >/var/lib/godseye/status/bao-snapshot.json
echo "BAO_SNAPSHOT_OK $OUT"
SNAP
chmod 0750 /usr/local/sbin/godseye-bao-snapshot

unit() { # unit <name> <description> <script> <OnCalendar>
  cat >"/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$2

[Service]
Type=oneshot
ExecStart=$3
Nice=10
EOF
  cat >"/etc/systemd/system/$1.timer" <<EOF
[Unit]
Description=$2 (daily)

[Timer]
OnCalendar=$4
RandomizedDelaySec=120
Persistent=true

[Install]
WantedBy=timers.target
EOF
}
unit godseye-cell-snapshot "G.O.D.S.E.Y.E cell host config snapshot" /usr/local/sbin/godseye-cell-snapshot "*-*-* 01:40:00 UTC"
unit godseye-bao-snapshot "G.O.D.S.E.Y.E OpenBao raft snapshot" /usr/local/sbin/godseye-bao-snapshot "*-*-* 01:50:00 UTC"
systemctl daemon-reload
systemctl enable --now godseye-cell-snapshot.timer
/usr/local/sbin/godseye-cell-snapshot

if [ -s /etc/godseye/bao-snapshot-approle/role_id ] && [ -s /etc/godseye/bao-snapshot-approle/secret_id ]; then
  systemctl enable --now godseye-bao-snapshot.timer
  /usr/local/sbin/godseye-bao-snapshot
else
  echo "BAO_SNAPSHOT_PENDING_OWNER: no snapshot AppRole yet (run p12-openbao-owner-setup.sh); timer left disabled"
fi
