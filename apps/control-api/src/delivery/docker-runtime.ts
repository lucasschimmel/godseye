import type { DeliveryArtifactView } from "@godseye/contracts";
import type { DeliveryManifest, DeliveryScope, DeploymentInspection } from "@godseye/core";
import { z } from "zod";
import { imageName } from "./build-backend.js";
import { parseRoute, type RouteStore, reloadCaddy, renderRoute } from "./caddy-routes.js";
import type { CommandRunner } from "./command-runner.js";
import type { RegistryClient } from "./registry-client.js";

const LABEL = "godseye";
const NON_ROOT_USER = "65532:65532";
const TMPFS_MAX_MIB = 256;
const Inspect = z.array(
  z.object({
    Config: z.object({ Labels: z.record(z.string(), z.string()).nullable() }),
    State: z.object({ Running: z.boolean() }),
    HostConfig: z.object({
      Runtime: z.string(),
      ReadonlyRootfs: z.boolean(),
      CapDrop: z.array(z.string()).nullable(),
      Memory: z.number(),
      PidsLimit: z.number().nullable(),
    }),
  }),
);
const NetworkInspect = z.array(
  z.object({ Internal: z.boolean(), Labels: z.record(z.string(), z.string()).nullable() }),
);

export interface DockerRuntimeConfig {
  registry: RegistryClient;
  routes: RouteStore;
  run: CommandRunner;
  /** Name of the Caddy container that terminates TLS; it joins each per-environment network. */
  caddyContainer: string;
  /** Wildcard preview/app domain, e.g. `apps.example.com`; hosts are `<environmentId>.<domain>`. */
  appDomain: string;
  containerPort?: number;
  healthPath?: string;
  runtime?: string;
  caddyConfigPath?: string;
}
export const containerName = (scope: DeliveryScope) => `gdy-${scope.runId}`;
export const networkName = (scope: DeliveryScope) => `gdy-env-${scope.environmentId}`;

/**
 * Docker (gVisor/runsc) runtime on the professional VM. All state is derived from Docker labels
 * and the Caddy route file, so every method is idempotent and `inspect` reconciles after a lost
 * acknowledgment without in-memory knowledge. Images are never removed here, which retains
 * previous digests for rollback.
 */
export class DockerRuntime {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly port: number;
  constructor(private readonly config: DockerRuntimeConfig) {
    this.port = config.containerPort ?? 8080;
  }
  private serialized<T>(environmentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(environmentId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.locks.set(
      environmentId,
      next.catch(() => undefined),
    );
    return next;
  }
  private docker(args: readonly string[]) {
    return this.config.run(["docker", ...args]);
  }
  private async dockerOk(args: readonly string[], what: string) {
    const result = await this.docker(args);
    if (result.code !== 0) throw new Error(`Docker ${what} failed`);
    return result.stdout;
  }
  private host(scope: DeliveryScope) {
    return `${scope.environmentId}.${this.config.appDomain}`;
  }
  private labels(scope: DeliveryScope, digest: string) {
    return {
      [`${LABEL}.managed`]: "true",
      [`${LABEL}.environment`]: scope.environmentId,
      [`${LABEL}.run`]: scope.runId,
      [`${LABEL}.ownership`]: scope.ownership,
      [`${LABEL}.digest`]: digest,
      [`${LABEL}.manifest`]: scope.manifestHash,
    };
  }
  private owned(
    labels: Record<string, string> | null,
    scope: DeliveryScope,
    digest: string | null,
  ) {
    return (
      labels?.[`${LABEL}.managed`] === "true" &&
      labels[`${LABEL}.run`] === scope.runId &&
      labels[`${LABEL}.environment`] === scope.environmentId &&
      labels[`${LABEL}.ownership`] === scope.ownership &&
      (digest === null || labels[`${LABEL}.digest`] === digest)
    );
  }
  private async container(name: string) {
    const result = await this.docker(["inspect", "--type", "container", name]);
    if (result.code !== 0) {
      if (/no such (container|object)/i.test(result.stderr)) return null;
      throw new Error("Docker container inspection failed");
    }
    return Inspect.parse(JSON.parse(result.stdout))[0] ?? null;
  }
  private async ensureNetwork(scope: DeliveryScope) {
    const name = networkName(scope);
    const found = await this.docker(["network", "inspect", name]);
    if (found.code === 0) {
      const network = NetworkInspect.parse(JSON.parse(found.stdout))[0];
      if (
        !network?.Internal ||
        network.Labels?.[`${LABEL}.environment`] !== scope.environmentId ||
        network.Labels[`${LABEL}.ownership`] === undefined
      )
        throw new Error("Environment network is foreign or not internal");
      return;
    }
    await this.dockerOk(
      [
        "network",
        "create",
        "--driver",
        "bridge",
        "--internal",
        "--label",
        `${LABEL}.environment=${scope.environmentId}`,
        "--label",
        `${LABEL}.ownership=${scope.ownership}`,
        name,
      ],
      "network create",
    );
  }
  private async connectCaddy(scope: DeliveryScope) {
    const result = await this.docker([
      "network",
      "connect",
      networkName(scope),
      this.config.caddyContainer,
    ]);
    if (result.code !== 0 && !/already exists|already connected/i.test(result.stderr))
      throw new Error("Docker network connect failed");
  }
  private createArguments(scope: DeliveryScope, manifest: DeliveryManifest, reference: string) {
    const { limits } = manifest;
    const tmpfs = Math.min(limits.storageGiB * 1024, TMPFS_MAX_MIB);
    const labels = Object.entries(this.labels(scope, manifest.artifactDigest ?? "")).flatMap(
      ([key, value]) => ["--label", `${key}=${value}`],
    );
    return [
      "create",
      "--name",
      containerName(scope),
      `--runtime=${this.config.runtime ?? "runsc"}`,
      "--network",
      networkName(scope),
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--user",
      NON_ROOT_USER,
      "--pids-limit",
      String(limits.pids),
      "--memory",
      `${limits.memoryMiB}m`,
      "--memory-swap",
      `${limits.memoryMiB}m`,
      "--cpus",
      (limits.cpuMilliCores / 1000).toFixed(3),
      "--tmpfs",
      `/tmp:rw,noexec,nosuid,nodev,size=${tmpfs}m`,
      "--restart",
      "no",
      "--log-driver",
      "local",
      "--log-opt",
      "max-size=10m",
      "--log-opt",
      "max-file=2",
      "--env",
      `PORT=${this.port}`,
      ...labels,
      reference,
    ];
  }
  async stage(scope: DeliveryScope, manifest: DeliveryManifest, artifact: DeliveryArtifactView) {
    return this.serialized(scope.environmentId, async () => {
      await this.ensureNetwork(scope);
      const reference = this.config.registry.reference(imageName(manifest), artifact.digest);
      if ((await this.docker(["image", "inspect", reference])).code !== 0)
        await this.dockerOk(["pull", reference], "pull");
      const existing = await this.container(containerName(scope));
      if (existing) {
        if (!this.owned(existing.Config.Labels, scope, artifact.digest))
          throw new Error("Refusing to adopt a foreign container");
      } else {
        await this.dockerOk(this.createArguments(scope, manifest, reference), "create");
      }
      if (!existing?.State.Running) await this.dockerOk(["start", containerName(scope)], "start");
      await this.connectCaddy(scope);
    });
  }
  private hardened(found: z.infer<typeof Inspect>[number]) {
    return (
      found.HostConfig.Runtime === "runsc" &&
      found.HostConfig.ReadonlyRootfs &&
      (found.HostConfig.CapDrop ?? []).includes("ALL") &&
      found.HostConfig.Memory > 0 &&
      (found.HostConfig.PidsLimit ?? 0) > 0
    );
  }
  private async healthy(scope: DeliveryScope) {
    const probe = await this.config.run([
      "docker",
      "exec",
      this.config.caddyContainer,
      "wget",
      "-q",
      "-T",
      "3",
      "-O",
      "/dev/null",
      `http://${containerName(scope)}:${this.port}${this.config.healthPath ?? "/"}`,
    ]);
    return probe.code === 0;
  }
  async inspect(scope: DeliveryScope, manifest: DeliveryManifest): Promise<DeploymentInspection> {
    const found = await this.container(containerName(scope));
    const owned = found !== null && this.owned(found.Config.Labels, scope, manifest.artifactDigest);
    if (found && !owned) throw new Error("Container name is held by a foreign resource");
    const route = parseRoute(await this.config.routes.read(scope.environmentId));
    const active = Boolean(
      owned &&
        found.State.Running &&
        route?.runId === scope.runId &&
        route.ownership === scope.ownership,
    );
    const ready = Boolean(owned && found.State.Running && (await this.healthy(scope)));
    return {
      scope: structuredClone(scope),
      digest: manifest.artifactDigest,
      present: owned,
      ready,
      active,
      privateRuntime: owned ? this.hardened(found) : true,
      syntheticDataOnly: manifest.syntheticDataOnly,
      ...(active ? { url: `https://${this.host(scope)}` } : {}),
      evidence: owned ? "docker-runsc-label-inspection" : "docker-owned-absence",
    };
  }
  async promote(scope: DeliveryScope, manifest: DeliveryManifest, previous: DeliveryScope | null) {
    return this.serialized(scope.environmentId, async () => {
      const current = await this.inspect(scope, manifest);
      if (!current.ready || !manifest.artifactDigest)
        throw new Error("Target runtime is not ready for traffic selection");
      const before = await this.config.routes.read(scope.environmentId);
      const holder = parseRoute(before);
      if (before !== null && !holder) throw new Error("Route file is not platform-owned");
      const next = renderRoute({
        environmentId: scope.environmentId,
        host: this.host(scope),
        upstream: `${containerName(scope)}:${this.port}`,
        owner: { runId: scope.runId, ownership: scope.ownership, digest: manifest.artifactDigest },
      });
      await this.swap(scope.environmentId, before, next);
      if (previous && previous.runId !== scope.runId) await this.retire(previous);
    });
  }
  private reloadCommands() {
    const config = this.config.caddyConfigPath ?? "/etc/caddy/Caddyfile";
    const base = ["docker", "exec", this.config.caddyContainer, "caddy"];
    return {
      validate: [...base, "validate", "--config", config],
      reload: [...base, "reload", "--config", config],
    };
  }
  /** Replace or remove the route; on any failure restore the previous bytes and reload them. */
  private async swap(environmentId: string, before: string | null, next: string | null) {
    try {
      if (next === null) await this.config.routes.remove(environmentId);
      else await this.config.routes.write(environmentId, next);
      await reloadCaddy(this.config.run, this.reloadCommands());
    } catch (error) {
      if (before === null) await this.config.routes.remove(environmentId);
      else await this.config.routes.write(environmentId, before);
      await reloadCaddy(this.config.run, this.reloadCommands()).catch(() => undefined);
      throw error;
    }
  }
  private async retire(previous: DeliveryScope) {
    const found = await this.container(containerName(previous));
    if (!found || !this.owned(found.Config.Labels, previous, null)) return;
    await this.dockerOk(["rm", "--force", containerName(previous)], "remove previous");
  }
  async cleanup(scope: DeliveryScope) {
    return this.serialized(scope.environmentId, async () => {
      const before = await this.config.routes.read(scope.environmentId);
      const holder = parseRoute(before);
      if (holder?.ownership === scope.ownership) await this.swap(scope.environmentId, before, null);
      const listing = await this.dockerOk(
        [
          "ps",
          "--all",
          "--quiet",
          "--no-trunc",
          "--filter",
          `label=${LABEL}.environment=${scope.environmentId}`,
          "--filter",
          `label=${LABEL}.ownership=${scope.ownership}`,
        ],
        "list",
      );
      for (const id of listing.split(/\s+/).filter(Boolean))
        await this.dockerOk(["rm", "--force", id], "remove");
      const name = networkName(scope);
      await this.docker(["network", "disconnect", "--force", name, this.config.caddyContainer]);
      // Removal fails harmlessly while another managed container still uses the network.
      await this.docker(["network", "rm", name]);
    });
  }
}
