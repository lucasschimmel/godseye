import { statfs } from "node:fs/promises";
import { availableParallelism, platform, release, totalmem } from "node:os";
import type { InfrastructureObservationInput } from "@godseye/contracts";
import type { InfrastructureCollector } from "./infra-provider.js";

/** Reads native metadata only; never probes private files, remote hosts or Docker sockets. */
export class LocalSystemCollector implements InfrastructureCollector {
  constructor(private readonly now: () => Date = () => new Date()) {}
  async collect(): Promise<InfrastructureObservationInput> {
    const observedAt = this.now();
    const filesystem = await statfs(process.cwd(), { bigint: true });
    return {
      source: "local-system",
      version: "native-os-fs-v1",
      target: "development-controller",
      providerBinding: null,
      observedAt: observedAt.toISOString(),
      expiresAt: new Date(observedAt.getTime() + 300_000).toISOString(),
      capacity: {
        cpuMilliCores: availableParallelism() * 1000,
        memoryMiB: Math.max(1, Math.floor(totalmem() / 1_048_576)),
        storageGiB: Number((filesystem.bavail * filesystem.bsize) / 1_073_741_824n),
        pids: null,
      },
      filesystem: {
        label: "Controller working-directory filesystem",
        totalGiB: Number((filesystem.blocks * filesystem.bsize) / 1_073_741_824n),
        availableGiB: Number((filesystem.bavail * filesystem.bsize) / 1_073_741_824n),
      },
      hostCapacity: null,
      platform: `${platform()} ${release()}`,
      qualification: {
        runtime: false,
        systrap: false,
        limits: false,
        persistentQuota: false,
        firewallIpv4: false,
        firewallIpv6: false,
        artifactVerification: false,
      },
      reasons: [
        "Development controller metadata only; PID capacity is unavailable. Storage is available space on the working-directory filesystem, not disk inventory or enforced quota. No AX41, guest, Docker, quota or dual-stack firewall qualification.",
      ],
    };
  }
}
