import { DomainError } from "./errors.js";
import { dockerOwnershipLabels } from "./infra-docker-policy.js";
import type { DockerProviderDependencies } from "./infra-docker-provider.js";
import type { DockerEngineTransport } from "./infra-docker-transport.js";
import { subnetContains } from "./infra-network.js";
import type { CompiledApplication } from "./infra-policy.js";
import type { ProviderScope } from "./infra-provider.js";
import { fingerprint } from "./journal.js";

interface DockerEffectiveEvidence {
  network: NonNullable<Awaited<ReturnType<DockerEngineTransport["inspectNetwork"]>>>;
  sandbox: NonNullable<Awaited<ReturnType<DockerEngineTransport["inspectSandbox"]>>>;
  data: NonNullable<Awaited<ReturnType<DockerProviderDependencies["quota"]["inspect"]>>>;
  firewall: Awaited<ReturnType<DockerProviderDependencies["firewall"]["inspect"]>>;
  runtime: Awaited<ReturnType<DockerProviderDependencies["runtime"]["inspect"]>>;
  artifact: Awaited<ReturnType<DockerProviderDependencies["artifacts"]["verify"]>>;
}
const drift = () =>
  new DomainError(
    "PROFILE_DRIFT",
    "Actual Docker configuration differs from the exact compiled allocation or host enforcement proof",
    409,
  );
/** Compare sanitized actual Engine fields, not submitted labels or a rendered request echoed back. */
export function verifyDockerConfiguration(
  evidence: DockerEffectiveEvidence,
  scope: ProviderScope,
  manifest: CompiledApplication,
  networkId: string,
) {
  const { network, sandbox, data, firewall, runtime, artifact } = evidence;
  const host = sandbox.HostConfig,
    labels = dockerOwnershipLabels(scope),
    memory = manifest.limits.memoryMiB * 1_048_576;
  const subnets = network.IPAM.Config.map((item) => item.Subnet).sort();
  if (
    network.Id !== networkId ||
    network.Name !== manifest.names.network ||
    network.Driver !== "bridge" ||
    !network.Internal ||
    !network.EnableIPv6 ||
    network.IPAM.Driver !== "default" ||
    fingerprint(subnets) !==
      fingerprint([manifest.network.ipv4Subnet, manifest.network.ipv6Subnet].sort()) ||
    fingerprint(network.Labels) !== fingerprint(labels)
  )
    throw drift();
  if (
    sandbox.Name !== `/${manifest.names.sandbox}` ||
    sandbox.Config.Image !== manifest.image ||
    sandbox.Image !== artifact.imageId ||
    sandbox.Config.User !== manifest.user ||
    fingerprint(sandbox.Config.Labels) !== fingerprint(labels)
  )
    throw drift();
  if (
    host.Runtime !== "runsc" ||
    host.Privileged ||
    !host.ReadonlyRootfs ||
    fingerprint(host.CapDrop) !== fingerprint(["ALL"]) ||
    (host.CapAdd?.length ?? 0) ||
    !host.SecurityOpt.includes("no-new-privileges:true") ||
    host.SecurityOpt.some((item) => item !== "no-new-privileges:true") ||
    host.NetworkMode !== networkId ||
    host.PidMode !== "" ||
    host.IpcMode !== "private"
  )
    throw drift();
  if (
    host.NanoCpus !== manifest.limits.cpuMilliCores * 1_000_000 ||
    host.Memory !== memory ||
    host.MemorySwap !== memory ||
    host.PidsLimit !== manifest.limits.pids ||
    (host.Binds?.length ?? 0) ||
    (host.Devices?.length ?? 0) ||
    Object.keys(host.PortBindings ?? {}).length ||
    host.PublishAllPorts ||
    Object.values(sandbox.NetworkSettings.Ports ?? {}).some((ports) => ports && ports.length > 0)
  )
    throw drift();
  if (
    fingerprint(host.Tmpfs) !==
    fingerprint({
      "/tmp": `rw,noexec,nosuid,nodev,size=${manifest.limits.temporaryMiB}m,mode=1777`,
    })
  )
    throw drift();
  if (
    sandbox.Mounts.length !== 1 ||
    !sandbox.Mounts.every(
      (mount) =>
        mount.Type === "volume" &&
        mount.Name === manifest.names.data &&
        mount.Destination === "/data" &&
        mount.RW,
    )
  )
    throw drift();
  const networks = Object.entries(sandbox.NetworkSettings.Networks);
  if (
    networks.length > 1 ||
    networks.some(
      ([name, endpoint]) =>
        endpoint.NetworkID !== networkId &&
        !(
          !sandbox.State.Running &&
          endpoint.NetworkID === "" &&
          [networkId, manifest.names.network].includes(name)
        ),
    )
  )
    throw drift();
  if (
    sandbox.State.Running &&
    (networks.length !== 1 ||
      networks[0]?.[1].NetworkID !== networkId ||
      !networks[0]?.[1].IPAddress ||
      !networks[0]?.[1].GlobalIPv6Address ||
      !subnetContains(manifest.network.ipv4Subnet, networks[0][1].IPAddress) ||
      !subnetContains(manifest.network.ipv6Subnet, networks[0][1].GlobalIPv6Address))
  )
    throw drift();
  if (
    !data.enforced ||
    data.targetId !== manifest.providerBinding?.targetId ||
    data.quotaGiB !== manifest.limits.dataGiB ||
    data.volumeName !== manifest.names.data ||
    !data.evidence?.trim() ||
    !firewall.ipv4HostDenied ||
    firewall.targetId !== manifest.providerBinding?.targetId ||
    !firewall.ipv6HostDenied ||
    !firewall.ipv4ForwardDenied ||
    !firewall.ipv6ForwardDenied ||
    !firewall.evidence?.trim()
  )
    throw drift();
  if (
    runtime.runtime !== "runsc" ||
    runtime.platform !== "systrap" ||
    !runtime.limitsEnforced ||
    !/^sha256:[a-f0-9]{64}$/.test(runtime.defaultSeccompDigest) ||
    !runtime.evidence?.trim() ||
    !/^sha256:[a-f0-9]{64}$/.test(artifact.imageId) ||
    !artifact.evidence?.trim() ||
    artifact.imageVolumes.some((volume) => volume !== "/data") ||
    runtime.version !== manifest.providerBinding?.version ||
    runtime.targetId !== manifest.providerBinding?.targetId
  )
    throw drift();
}
