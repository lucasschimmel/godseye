#!/usr/bin/env bash
# p13-host-status-receiver.sh - install the least-privilege receiver for host status files on godseye-pro.
#
# Run as root on godseye-pro from the staged directory (needs bin/godseye-host-status-receive). The host's
# PUBLIC key is read from stdin (one line, `ssh-ed25519 AAAA...`). Creates:
#   - system account `hoststatus` (no password; SSH key only, restricted to the forced command)
#   - /var/lib/godseye-host-status  hoststatus:godseye 0750, files 0640 (the control API user `godseye`
#     reads them through its primary group; it cannot write)
#   - /usr/local/lib/godseye/godseye-host-status-receive (the guest's /usr/local/sbin is root-only)
#   - authorized_keys owned by root (the account cannot change its own restrictions):
#       restrict,from="<host>",command="/usr/local/lib/godseye/godseye-host-status-receive" <key>
# Idempotent. Rollback: userdel -r hoststatus; rm -rf /var/lib/godseye-host-status;
# rm /usr/local/lib/godseye/godseye-host-status-receive.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
FROM="${GODSEYE_HOST_STATUS_FROM:-10.20.1.1}"
DIR=/var/lib/godseye-host-status
HOME_DIR=/var/lib/hoststatus

IFS= read -r PUBKEY
case "$PUBKEY" in
  "ssh-ed25519 "*) ;;
  *)
    echo "expected an ssh-ed25519 public key on stdin" >&2
    exit 64
    ;;
esac
id godseye >/dev/null 2>&1 || { echo "service user godseye is missing" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

if ! id hoststatus >/dev/null 2>&1; then
  useradd --system --home-dir "$HOME_DIR" --create-home --shell /bin/bash --gid godseye hoststatus
fi
usermod --lock hoststatus 2>/dev/null || true
install -d -m 0750 -o hoststatus -g godseye "$DIR"
install -d -m 0755 /usr/local/lib/godseye
install -m 0755 "$HERE/bin/godseye-host-status-receive" /usr/local/lib/godseye/godseye-host-status-receive

install -d -m 0755 -o root -g root "$HOME_DIR/.ssh"
printf 'restrict,from="%s",command="/usr/local/lib/godseye/godseye-host-status-receive" %s\n' "$FROM" "$PUBKEY" \
  >"$HOME_DIR/.ssh/authorized_keys"
chown root:root "$HOME_DIR/.ssh/authorized_keys"
chmod 0644 "$HOME_DIR/.ssh/authorized_keys"
chown root:root "$HOME_DIR"
chmod 0755 "$HOME_DIR"

ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
echo "HOST_STATUS_RECEIVER_READY (directory $DIR)"
