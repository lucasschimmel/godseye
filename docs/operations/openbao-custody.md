# OpenBao custody and unseal procedure

Status (2026-11-15): OpenBao `2.7.2` on `godseye-pro`, initialized with Shamir `3` shares and threshold `2`.
This document records who holds what and how the vault is brought back after a restart. It contains no
secret values.

## Custody decision

The owner keeps the init material (three unseal shares and the initial root token) **only on the owner's
workstation** for now, in a folder that is not synchronized to any cloud service. The copy on the VM is
removed and the root token is revoked.

Consequences the owner has accepted:

- The workstation is the single copy. If it is lost together with its disk, the shares are gone: OpenBao can
  no longer be unsealed and every secret in it must be recreated (OVH DNS credentials, database role
  material, signing keys, AppRole secrets) after a fresh `operator init`. Backups of the workstation, or a
  second location for the shares, remove this single point of failure and should be arranged when convenient.
- After every restart of `godseye-pro`, OpenBao starts **sealed**. The control plane reports the provider as
  unavailable until the owner supplies two shares. Nothing else unseals it automatically.

## Unseal after a restart

From the owner's workstation (WireGuard active), run twice with two different shares; the prompt is silent:

```sh
ssh -t root@10.20.1.10 "read -rs -p 'unseal share: ' S; echo; BAO_ADDR=https://127.0.0.1:8200 BAO_SKIP_VERIFY=true bao operator unseal \"\$S\""
```

`BAO_SKIP_VERIFY` is limited to the loopback address. The listener certificate does carry `127.0.0.1` and
`10.20.1.10` as subject alternative names (checked 2026-11-16), so on the VM `BAO_CACERT=/etc/openbao/bao.crt`
works without skipping verification; the control API already verifies it that way. `bao status` must report
`Sealed: false`.

## Root token

The initial root token is revoked after the platform setup. Administrative work uses scoped tokens or AppRoles
(`godseye-edge` reads only the edge OVH credentials). If a root token is ever needed again, generate a
short-lived one with two shares (`bao operator generate-root`), use it, and revoke it immediately.

## Rotation

A new `bao operator rekey` can replace the shares (for example to distribute them elsewhere) without changing
the stored secrets. Do it from the workstation with two current shares, then destroy the old ones.
