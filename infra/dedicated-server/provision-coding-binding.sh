#!/usr/bin/env bash
# Run as root ON godseye-pro (idempotent; never overwrites an existing OpenBao coding document).
#   provision-coding-binding.sh <work-vm host public key line "ssh-ed25519 AAAA...">
#
# 1. Generates the control API's SSH identity HERE (private key lives only in a tmpfs scratch directory,
#    then only in OpenBao; it is never printed, committed or written to persistent disk).
# 2. Stores the work-VM transport document (host key pinned with its fingerprint) and the private key at
#    OpenBao godseye/bindings/coding using the control API's AppRole. The document carries ONE explicit
#    placeholder binding: the owner must register the real project/environment/repository identities and
#    broker key before the runner can ever be used (it is also unavailable until qualification completes).
# 3. Prints only the PUBLIC key, to be installed on godseye-work by work-vm-coding-authorize-key.sh.
set -euo pipefail
umask 077

hostkey="${1:?work VM public host key line required}"
approle_env="/etc/godseye/openbao-approle.env"
mount="godseye"
scratch="$(mktemp -d -p /run godseye-coding-provision.XXXXXX)"
trap 'rm -rf "${scratch}"' EXIT

set -a; . "${approle_env}"; set +a
export BAO_ADDR="${OPENBAO_ADDR}" BAO_CACERT="${OPENBAO_CACERT}"
BAO_TOKEN="$(bao write -field=token auth/approle/login role_id="${OPENBAO_ROLE_ID}" secret_id="${OPENBAO_SECRET_ID}")"
export BAO_TOKEN
unset OPENBAO_ROLE_ID OPENBAO_SECRET_ID

if bao kv get -mount="${mount}" -field=work_vm_ssh_pub bindings/coding >/dev/null 2>&1; then
  echo "provision: coding binding already present; leaving it untouched"
  echo "PUBLIC_KEY=$(bao kv get -mount="${mount}" -field=work_vm_ssh_pub bindings/coding)"
  exit 0
fi

ssh-keygen -q -t ed25519 -N '' -C godseye-coding-control -f "${scratch}/key"
printf '%s\n' "${hostkey}" > "${scratch}/host.pub"
fingerprint="$(ssh-keygen -lf "${scratch}/host.pub" | awk '{print $2}')"

jq -n --arg hostKey "${hostkey}" --arg fingerprint "${fingerprint}" '{
  version: 1,
  capacity: {memoryMiB: 3072, cpuMilliCores: 2000, maxProcesses: 1024, diskMiB: 4096, vmmOverheadMiB: 512},
  bindings: [{
    projectId: "00000000-0000-4000-8000-000000000000",
    environmentId: "00000000-0000-4000-8000-000000000000",
    repositoryHash: ("0" * 64),
    sourceDirectory: "/var/lib/godseye/coding-sources/PLACEHOLDER-owner-must-register",
    runner: "codex",
    broker: {runner: "codex", model: "gpt-5.4-mini", apiKey: "PLACEHOLDER-NO-AUTHORITY-OWNER-MUST-REPLACE",
             maxRequests: 8, maxRequestBytes: 262144, maxResponseBytes: 786432, maxOutputTokens: 2048,
             requestTimeoutSeconds: 60}
  }],
  transport: {kind: "work-vm", host: "10.20.3.10", port: 22, user: "godseye", hostKey: $hostKey,
              hostKeyFingerprint: $fingerprint, remoteWorkspace: "/opt/godseye",
              identityFile: "/run/godseye-bindings/work-vm-ssh-key"}
}' > "${scratch}/document.json"

bao kv put -mount="${mount}" bindings/coding document=@"${scratch}/document.json" \
  work_vm_ssh_key=@"${scratch}/key" work_vm_ssh_pub="$(cat "${scratch}/key.pub")" >/dev/null
echo "provision: stored the transport document and identity in OpenBao (values not printed)"
echo "HOST_KEY_FINGERPRINT=${fingerprint}"
echo "PUBLIC_KEY=$(cat "${scratch}/key.pub")"
