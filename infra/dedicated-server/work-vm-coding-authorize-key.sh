#!/usr/bin/env bash
# Run as root ON godseye-work (idempotent). Two modes:
#   work-vm-coding-authorize-key.sh hostkey            print the public SSH host key line (public data)
#   work-vm-coding-authorize-key.sh authorize <pubkey> install the control API's PUBLIC key for the service
#                                                      user, restricted to the fixed coding gate
# The restriction means that key can only start scripts/coding_work_vm_gate.py, only from the pro VM, with
# no pty, forwarding, agent or X11. The laboratory action is not reachable through it.
# Nothing secret is read, written or printed; the private key never exists on this VM.
set -euo pipefail

SERVICE_USER="godseye"
WORKSPACE="/opt/godseye"
CONTROL_API_ADDRESS="10.20.1.10"          # godseye-pro, the only source allowed to use this key
HOST_KEY="/etc/ssh/ssh_host_ed25519_key.pub"

case "${1:-}" in
  hostkey)
    awk '{print $1 " " $2}' "${HOST_KEY}"
    ;;
  authorize)
    key="${2:?public key line required}"
    printf '%s\n' "${key}" | grep -Eq '^ssh-ed25519 [A-Za-z0-9+/]{43,}={0,2}( [A-Za-z0-9@._-]{0,64})?$' || { echo "refusing malformed public key" >&2; exit 1; }
    blob="$(awk '{print $1 " " $2}' <<<"${key}")"
    home="$(getent passwd "${SERVICE_USER}" | cut -d: -f6)"
    install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${home}/.ssh"
    file="${home}/.ssh/authorized_keys"
    options="restrict,from=\"${CONTROL_API_ADDRESS}\",command=\"/usr/bin/python3 -I ${WORKSPACE}/scripts/coding_work_vm_gate.py\""
    touch "${file}"
    # Replace any previous godseye-coding entry; keep unrelated entries untouched.
    grep -v ' godseye-coding-control$' "${file}" > "${file}.new" || true
    printf '%s %s godseye-coding-control\n' "${options}" "${blob}" >> "${file}.new"
    chown "${SERVICE_USER}:${SERVICE_USER}" "${file}.new"; chmod 0600 "${file}.new"
    mv -f "${file}.new" "${file}"
    echo "authorized key installed for ${SERVICE_USER} (restricted to the coding gate from ${CONTROL_API_ADDRESS})"
    ;;
  *)
    echo "usage: $0 hostkey | authorize <public key line>" >&2; exit 2
    ;;
esac
