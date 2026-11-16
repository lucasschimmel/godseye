#!/usr/bin/env bash
# h11-offhost-shared-key.sh - configure the off-host restic copy WITHOUT a dedicated Backblaze key.
#
# Interim path (accepted risk R-P06b, see docs/operations/dedicated-server-execution.md): the owner did not
# create a bucket-and-prefix-scoped key, so the host reuses the Backblaze key that pgBackRest already uses on
# godseye-pro, but writes to its own restic repository prefix `host/` in the same bucket. Everything in the
# repository is encrypted client-side with the restic passphrase, so Backblaze (and anyone holding the
# shared key) cannot read it; what the shared key cannot prevent is deletion or overwrite by the key holder.
# Later hardening: replace the key with a dedicated, prefix-scoped key (h08-offhost-credentials.sh) and enable
# bucket-level object lock / lifecycle in the Backblaze console.
#
# Usage (root on godseye-wg): the credentials are read from STDIN, two lines, never from argv and never
# echoed:  line 1 = key id, line 2 = application key. The caller pipes them from the pro VM, for example
#   ssh pro 'emit script' | ssh wg 'bash h11-offhost-shared-key.sh'
# The passphrase in /etc/godseye/restic-password is generated on the host with `openssl rand` when absent
# (the owner copies it offline; it is never printed here).
set -euo pipefail
umask 077

BUCKET="${GODSEYE_B2_BUCKET:-godseye-backups-dab6e7328bfc}"
ENDPOINT="${GODSEYE_B2_ENDPOINT:-s3.eu-central-003.backblazeb2.com}"
CONF=/etc/godseye
ENV_FILE="$CONF/offhost-backup.env"
PASS_FILE="$CONF/restic-password"

IFS= read -r KEY_ID
IFS= read -r KEY_SECRET
[ -n "${KEY_ID:-}" ] && [ -n "${KEY_SECRET:-}" ] || {
  echo "empty credentials on stdin" >&2
  exit 1
}

mkdir -p "$CONF"
chmod 700 "$CONF"
if [ ! -s "$PASS_FILE" ]; then
  openssl rand -base64 48 >"$PASS_FILE"
  chmod 600 "$PASS_FILE"
fi
[ ! -s "$ENV_FILE" ] || cp -a "$ENV_FILE" "$ENV_FILE.previous"
{
  echo "RESTIC_REPOSITORY=s3:https://$ENDPOINT/$BUCKET/host"
  echo "AWS_ACCESS_KEY_ID=$KEY_ID"
  echo "AWS_SECRET_ACCESS_KEY=$KEY_SECRET"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"
unset KEY_ID KEY_SECRET

# Proof of access without printing anything secret: open (or initialise) the repository.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export RESTIC_PASSWORD_FILE="$PASS_FILE"
if restic cat config >/dev/null 2>&1; then
  echo "restic repository already initialised"
else
  restic init --quiet
  echo "restic repository initialised under the host/ prefix"
fi
echo "OFFHOST_SHARED_KEY_CONFIGURED (passphrase file: $(stat -c '%U:%G %a' "$PASS_FILE"), $(wc -c <"$PASS_FILE") bytes)"
