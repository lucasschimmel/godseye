import type { DeclareInventoryInput, InfrastructureCapacityInput } from "@godseye/contracts";

const capacity = (
  cpuMilliCores: number,
  memoryMiB: number,
  storageGiB: number,
  pids: number,
): InfrastructureCapacityInput => ({ cpuMilliCores, memoryMiB, storageGiB, pids });

/**
 * Topology of the dedicated server as recorded in docs/operations/evidence/p00-host-inventory.json and
 * docs/operations/dedicated-server-execution.md (entries 009 and 021). It only pre-fills the form:
 * nothing is declared until the owner confirms and saves, and the declaration measures nothing.
 */
export const serverInventory: DeclareInventoryInput = {
  expectedRevision: 0,
  host: {
    name: "EX44 Hetzner HEL1",
    // 20 threads (14 cores), 64 076 MiB usable RAM, rpool 472 GiB.
    capacity: capacity(20_000, 64_076, 472, 65_536),
    // ZFS ARC cap 4 096 + host reserve 4 096 MiB; 52 GiB is the part of rpool the virtual disks leave free.
    headroom: capacity(1_000, 8_192, 52, 1_024),
  },
  guests: [
    // VM 100 godseye-pro: 32 768 MiB, 6 vCPU capped at 3 cores, 200 GiB root + 120 GiB cell disk.
    { role: "professional", capacity: capacity(3_000, 32_768, 320, 32_768) },
    // VM 200 godseye-games: 16 384 MiB, 4 vCPU capped at 2 cores, 80 GiB.
    { role: "games", capacity: capacity(2_000, 16_384, 80, 8_192) },
    // VM 300 godseye-work: 6 144 MiB, 2 vCPU capped at 0.5 core, 20 GiB.
    { role: "task", capacity: capacity(500, 6_144, 20, 256) },
  ],
  pool: {
    // Cell disk 120 GiB (XFS project quotas); CPU, memory and PID shares are proposals inside VM 100.
    capacity: capacity(2_500, 24_576, 120, 16_384),
    headroom: capacity(500, 2_048, 12, 256),
    ipv4Pool: "10.21.0.0/16",
    ipv6Pool: "fd47:6f64:7365:1000::/52",
  },
  publicIpv4Count: 1,
};

/** Where each group of pre-filled values comes from, and which ones are proposals rather than measurements. */
export const serverInventoryBasis = {
  measured: [
    "Hôte : EX44, 20 threads (14 cœurs), 64 076 MiB de mémoire utilisable (relevé P00).",
    "Stockage : pool ZFS rpool de 472 GiB.",
    "VM professionnelle : 32 768 MiB, plafond 3 cœurs, 200 + 120 GiB. VM jeux : 16 384 MiB, plafond 2 cœurs, 80 GiB. VM tâche : 6 144 MiB, plafond 0,5 cœur, 20 GiB (entrée 009).",
    "Marge mémoire de l’hôte : cache ZFS 4 096 MiB + réserve 4 096 MiB (entrée 021). Pool de cellules : disque de 120 GiB, réseaux 10.21.0.0/16 et fd47:6f64:7365:1000::/52.",
  ],
  commitment:
    "Engagement de stockage : les disques virtuels engagent 420 GiB sur 472 GiB ; avec le quota de sauvegarde de 60 GiB, 480 GiB sur 472 GiB (entrée 021). La marge hôte déclarée est donc limitée à 52 GiB, ce que le pool laisse libre : le dépassement de 8 GiB reste une exception de surallocation légère à décider par vous.",
  proposals:
    "À confirmer, non relevés : marges de CPU, plafonds de PID, et parts CPU, mémoire et PID du pool de cellules à l’intérieur de la VM professionnelle.",
} as const;
