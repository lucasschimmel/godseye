import type { CompiledApplication } from "./infra-policy.js";
import type { ProviderScope } from "./infra-provider.js";

export function dockerOwnershipLabels(scope: ProviderScope) {
  return {
    "gse.allocation": scope.allocationId,
    "gse.project": scope.projectId,
    "gse.environment": scope.environmentId,
    "gse.manifest": scope.manifestHash,
    "gse.ownership": scope.ownership,
    "gse.epoch": String(scope.epoch),
  };
}
export function renderDockerNetwork(scope: ProviderScope, manifest: CompiledApplication) {
  return {
    Name: manifest.names.network,
    Driver: "bridge",
    Internal: true,
    EnableIPv6: true,
    Attachable: false,
    CheckDuplicate: true,
    Labels: dockerOwnershipLabels(scope),
    IPAM: {
      Driver: "default",
      Config: [{ Subnet: manifest.network.ipv4Subnet }, { Subnet: manifest.network.ipv6Subnet }],
    },
  };
}
/** The only persistent mount is an opaque quota-manager volume, never an owner path or host bind. */
export function renderDockerSandbox(
  scope: ProviderScope,
  manifest: CompiledApplication,
  networkId: string,
  volumeName: string,
) {
  if (
    !/^[a-f0-9]{64}$/.test(networkId) ||
    !/^gse-[a-f0-9-]{36}-data$/.test(volumeName) ||
    volumeName !== manifest.names.data
  )
    throw new Error("Invalid server-owned Docker allocation mapping");
  const memory = manifest.limits.memoryMiB * 1_048_576;
  return {
    Image: manifest.image,
    User: manifest.user,
    Labels: dockerOwnershipLabels(scope),
    AttachStdin: false,
    OpenStdin: false,
    Tty: false,
    HostConfig: {
      Runtime: "runsc",
      Privileged: false,
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      CapAdd: [],
      SecurityOpt: ["no-new-privileges:true"],
      NetworkMode: networkId,
      PidMode: "",
      IpcMode: "private",
      PublishAllPorts: false,
      PortBindings: {},
      Binds: [],
      Devices: [],
      NanoCpus: manifest.limits.cpuMilliCores * 1_000_000,
      Memory: memory,
      MemorySwap: memory,
      PidsLimit: manifest.limits.pids,
      Tmpfs: { "/tmp": `rw,noexec,nosuid,nodev,size=${manifest.limits.temporaryMiB}m,mode=1777` },
      Mounts: [
        {
          Type: "volume",
          Source: volumeName,
          Target: "/data",
          ReadOnly: false,
          VolumeOptions: { NoCopy: true },
        },
      ],
      RestartPolicy: { Name: "no" },
      AutoRemove: false,
      LogConfig: { Type: "local", Config: { "max-size": "10m", "max-file": "2" } },
    },
    NetworkingConfig: { EndpointsConfig: { [networkId]: {} } },
  };
}
