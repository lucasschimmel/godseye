#!/usr/bin/env bash
# h08-offhost-credentials.sh - OWNER step: store the Backblaze B2 application key for off-host backups.
#
# Run as root on godseye-wg (interactive terminal). The key id and secret are read with a silent
# prompt, written to /etc/godseye/offhost-backup.env (root, 0600) and never echoed or logged.
#
# Create the key first in the Backblaze console (App Keys -> Add a New Application Key):
#   - Name: godseye-host-restic   (distinct from the pgBackRest key)
#   - Allow access to bucket: godseye-backups-dab6e7328bfc only
#   - File name prefix: host/
#   - Type of access: Read and Write (restic prune needs delete)
# Then run:  bash h08-offhost-credentials.sh
#
# Afterwards the script initialises the encrypted restic repository, runs the first off-host
# copies and prints the status. ESCROW the repository passphrase (see docs/operations/break-glass.md):
# without it the off-host copies cannot be decrypted after a host loss.
set -euo pipefail
umask 077

BUCKET="${GODSEYE_B2_BUCKET:-godseye-backups-dab6e7328bfc}"
ENDPOINT="${GODSEYE_B2_ENDPOINT:-s3.eu-central-003.backblazeb2.com}"
ENV_FILE=/etc/godseye/offhost-backup.env

[ -t 0 ] || {
  echo "needs an interactive terminal for the silent prompts" >&2
  exit 1
}
mkdir -p /etc/godseye
chmod 700 /etc/godseye
if [ -s "$ENV_FILE" ]; then
  cp -a "$ENV_FILE" "$ENV_FILE.previous"
fi
read -r -s -p "B2 application key ID: " KEY_ID
echo
read -r -s -p "B2 application key (secret): " KEY_SECRET
echo
[ -n "$KEY_ID" ] && [ -n "$KEY_SECRET" ] || {
  echo "empty value" >&2
  exit 1
}
{
  echo "RESTIC_REPOSITORY=s3:https://$ENDPOINT/$BUCKET/host"
  echo "AWS_ACCESS_KEY_ID=$KEY_ID"
  echo "AWS_SECRET_ACCESS_KEY=$KEY_SECRET"
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"
unset KEY_ID KEY_SECRET

/usr/local/sbin/godseye-host-config-backup
/usr/local/sbin/godseye-offhost-backup config
/usr/local/sbin/godseye-offhost-backup vms
cat /var/lib/godseye/status/offhost-backup.json
echo "OFFHOST_CONFIGURED. Now escrow /etc/godseye/restic-password offline (password manager + printed copy)."
