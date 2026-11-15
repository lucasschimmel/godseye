#!/usr/bin/env bash
# h09-offhost-selftest.sh - prove the off-host backup pipeline (encrypt, back up, verify, restore, prune)
# against a throw-away LOCAL restic repository, using the production scripts unchanged. This validates
# everything except the B2 credentials/network leg, so the only thing left once the owner supplies the
# key is `bash h08-offhost-credentials.sh`. Uses tmpfs for config/status; production status files and
# credentials are never touched. Cleans up on exit.
set -euo pipefail
umask 077

T="$(mktemp -d /run/godseye-selftest.XXXXXX)"
REPO="/var/tmp/godseye-selftest-repo-$$"
trap 'rm -rf "$T" "$REPO"' EXIT
mkdir -p "$T/conf" "$T/status"
printf 'selftest-passphrase-not-secret\n' >"$T/conf/restic-password"
printf 'RESTIC_REPOSITORY=%s\n' "$REPO" >"$T/conf/offhost-backup.env"
export GODSEYE_CONF_DIR="$T/conf" GODSEYE_STATUS_DIR="$T/status" GODSEYE_UPLOAD_LIMIT_KIB=0

echo "== config mode"
/usr/local/sbin/godseye-offhost-backup config
cat "$T/status/offhost-backup.json"

echo "== vms mode (newest archive per VM, 2% data check)"
/usr/local/sbin/godseye-offhost-backup vms
cat "$T/status/offhost-backup.json"

echo "== restore the host-config snapshot and compare checksums"
set -a
. "$T/conf/offhost-backup.env"
set +a
export RESTIC_PASSWORD_FILE="$T/conf/restic-password"
restic snapshots --compact
mkdir -p "$T/restore"
restic restore latest --tag host-config --target "$T/restore" >/dev/null
ARCH="$(find "$T/restore" -name 'host-config-*.tar.zst' | head -n 1)"
(cd "$(dirname "$ARCH")" && sha256sum -c "$(basename "$ARCH").sha256")
tar --zstd -tf "$ARCH" | grep -c '^etc/pve/' | sed 's/^/pve config entries in restored archive: /'

echo "== repository is encrypted (a wrong passphrase must not open it)"
printf 'wrong-passphrase
' >"$T/wrong"
if RESTIC_PASSWORD_FILE="$T/wrong" restic cat config >/dev/null 2>&1; then
  echo "FAIL: repository opened with a wrong passphrase" >&2
  exit 1
fi
echo "ENCRYPTED_OK"
echo "OFFHOST_SELFTEST_PASS"
