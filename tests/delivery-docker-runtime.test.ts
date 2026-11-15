import { createHash } from "node:crypto";
import { ManagedDeliveryProvider } from "@godseye/core";
import { describe, expect, it } from "vitest";
import type { RouteStore } from "../apps/control-api/src/delivery/caddy-routes.js";
import type {
  CommandResult,
  CommandRunner,
} from "../apps/control-api/src/delivery/command-runner.js";
import { DockerRuntime } from "../apps/control-api/src/delivery/docker-runtime.js";
import { RegistryClient } from "../apps/control-api/src/delivery/registry-client.js";
import { DockerJenkinsTransport } from "../apps/control-api/src/delivery/transport.js";
import type { DeliveryManifest, DeliveryScope } from "../packages/core/src/delivery-provider.js";
import { fingerprint } from "../packages/core/src/journal.js";
import { deliveryLabArtifact, deliveryLabManifest } from "./delivery-lab-manifest.js";

const CADDY = "caddy";
const SAME_PROJECT = crypto.randomUUID();
interface FakeContainer {
  args: string[];
  labels: Record<string, string>;
  running: boolean;
}
/** Stateful stand-in for the docker CLI; commands are recorded as argument vectors. */
function fakeDocker() {
  const containers = new Map<string, FakeContainer>();
  const networks = new Map<string, { internal: boolean; labels: Record<string, string> }>();
  const connected = new Set<string>();
  const images = new Set<string>();
  const log: string[][] = [];
  const failing = new Set<string>();
  const routes = new Map<string, string>();
  let healthy = true;
  const ok = (stdout = ""): CommandResult => ({ code: 0, stdout, stderr: "" });
  const fail = (stderr: string): CommandResult => ({ code: 1, stdout: "", stderr });
  const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1] as string;
  const run: CommandRunner = async (argv) => {
    const args = argv.slice(1) as string[];
    log.push([...argv]);
    const verb = args.join(" ");
    for (const f of failing) if (verb.includes(f)) return fail("injected failure");
    if (argv[0] !== "docker") return fail("unexpected executable");
    const [command, sub] = args;
    if (command === "exec") return args.includes("wget") ? (healthy ? ok() : fail("down")) : ok();
    if (command === "image")
      return images.has(args[2] as string) ? ok("[]") : fail("No such image");
    if (command === "pull") return (images.add(args[1] as string), ok());
    if (command === "network" && sub === "inspect") {
      const n = networks.get(args[2] as string);
      return n
        ? ok(JSON.stringify([{ Internal: n.internal, Labels: n.labels }]))
        : fail("No such network");
    }
    if (command === "network" && sub === "create") {
      const labels: Record<string, string> = {};
      args.forEach((a, i) => {
        if (a === "--label") {
          const [k, v] = (args[i + 1] as string).split("=");
          labels[k as string] = v as string;
        }
      });
      networks.set(args.at(-1) as string, { internal: args.includes("--internal"), labels });
      return ok();
    }
    if (command === "network" && sub === "connect") {
      const key = `${args[2]}|${args[3]}`;
      if (connected.has(key)) return fail("endpoint already exists in network");
      connected.add(key);
      return ok();
    }
    if (command === "network" && sub === "disconnect") return ok();
    if (command === "network" && sub === "rm") return (networks.delete(args[2] as string), ok());
    if (command === "create") {
      const labels: Record<string, string> = {};
      args.forEach((a, i) => {
        if (a === "--label") {
          const [k, v] = (args[i + 1] as string).split("=");
          labels[k as string] = v as string;
        }
      });
      containers.set(flag(args, "--name"), { args, labels, running: false });
      return ok();
    }
    if (command === "start") {
      const c = containers.get(args[1] as string);
      if (c) c.running = true;
      return ok();
    }
    if (command === "inspect") {
      const c = containers.get(args[3] as string);
      if (!c) return fail("Error: No such container");
      const a = c.args;
      return ok(
        JSON.stringify([
          {
            Config: { Labels: c.labels },
            State: { Running: c.running },
            HostConfig: {
              Runtime: a.find((x) => x.startsWith("--runtime="))?.split("=")[1] ?? "",
              ReadonlyRootfs: a.includes("--read-only"),
              CapDrop: a.includes("--cap-drop") ? [flag(a, "--cap-drop")] : [],
              Memory: 1,
              PidsLimit: Number(flag(a, "--pids-limit")),
            },
          },
        ]),
      );
    }
    if (command === "ps") {
      const wanted = args.filter((a) => a.startsWith("label=")).map((a) => a.slice(6));
      return ok(
        [...containers.entries()]
          .filter(([, c]) =>
            wanted.every((w) => c.labels[w.split("=")[0] as string] === w.split("=")[1]),
          )
          .map(([name]) => name)
          .join("\n"),
      );
    }
    if (command === "rm") return (containers.delete(args[2] as string), ok());
    return fail("unsupported");
  };
  const store: RouteStore = {
    read: async (id) => routes.get(id) ?? null,
    write: async (id, content) => void routes.set(id, content),
    remove: async (id) => void routes.delete(id),
  };
  return {
    run,
    store,
    containers,
    networks,
    images,
    log,
    failing,
    routes,
    setHealthy: (value: boolean) => {
      healthy = value;
    },
  };
}

function setup() {
  const docker = fakeDocker();
  const registry = new RegistryClient({
    baseUrl: "http://registry.internal:5000",
    repositoryPrefix: "apps",
  });
  const runtime = new DockerRuntime({
    registry,
    routes: docker.store,
    run: docker.run,
    caddyContainer: CADDY,
    appDomain: "apps.example.test",
  });
  const provider = new ManagedDeliveryProvider(
    {
      providerId: "docker-runsc",
      targetId: "11111111-1111-4111-8111-111111111111",
      version: "1",
      generation: 1,
      previewDomain: "apps.example.test",
    },
    new DockerJenkinsTransport({} as never, runtime),
  );
  return { docker, provider };
}
const digestOf = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const guard = async () => undefined;

/** Builds a release manifest/scope pair for one environment and image digest. */
function release(
  environmentId: string,
  digest: string,
  intent: "release" | "rollback" = "release",
  syntheticDataOnly = false,
) {
  const { manifest: base, scope: baseScope } = deliveryLabManifest(
    environmentId as ReturnType<typeof crypto.randomUUID>,
  );
  const manifest: DeliveryManifest = {
    ...structuredClone(base),
    projectId: SAME_PROJECT,
    intent,
    artifactDigest: digest,
    syntheticDataOnly,
  };
  const scope: DeliveryScope = {
    ...baseScope,
    projectId: SAME_PROJECT,
    runId: crypto.randomUUID(),
    manifestHash: fingerprint({ manifest, digest, intent }),
  };
  const artifact = deliveryLabArtifact(
    {
      scope,
      digest,
      sizeBytes: 10,
      commitSha: manifest.source.commitSha,
      checks: [],
      scanner: null,
      migration: null,
    } as never,
    manifest,
  );
  return { manifest, scope, artifact: { ...artifact, digest, projectId: scope.projectId } };
}

describe("Docker runsc delivery runtime", () => {
  it("stages a hardened container on an internal network and keeps traffic off until promoted", async () => {
    const { docker, provider } = setup();
    const env = crypto.randomUUID();
    const r = release(env, digestOf("one"));
    await provider.stage(r.scope, r.manifest, r.artifact, guard);
    const created = docker.log.find((c) => c[1] === "create") as string[];
    expect(created).toEqual(
      expect.arrayContaining([
        "--runtime=runsc",
        "--read-only",
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
      ]),
    );
    expect(created).not.toContain("--publish");
    expect(created).not.toContain("--privileged");
    expect([...docker.networks.values()][0]?.internal).toBe(true);
    expect(docker.routes.size).toBe(0);
    const ready = await provider.readiness(r.scope, r.manifest);
    expect(ready).toMatchObject({
      present: true,
      ready: true,
      active: false,
      privateRuntime: true,
    });
  });

  it("is idempotent when stage is repeated after a lost acknowledgment", async () => {
    const { docker, provider } = setup();
    const r = release(crypto.randomUUID(), digestOf("one"));
    await provider.stage(r.scope, r.manifest, r.artifact, guard);
    await provider.stage(r.scope, r.manifest, r.artifact, guard);
    expect(docker.log.filter((c) => c[1] === "create")).toHaveLength(1);
    expect(docker.log.filter((c) => c[1] === "pull")).toHaveLength(1);
  });

  it("swaps the Caddy upstream on promote and retires the previous container but keeps its image", async () => {
    const { docker, provider } = setup();
    const env = crypto.randomUUID();
    const a = release(env, digestOf("one"));
    await provider.stage(a.scope, a.manifest, a.artifact, guard);
    await provider.promote(a.scope, a.manifest, null, guard);
    const b = release(env, digestOf("two"));
    await provider.stage(b.scope, b.manifest, b.artifact, guard);
    await provider.promote(b.scope, b.manifest, a.scope, guard);
    expect(docker.routes.get(env)).toContain(`reverse_proxy gdy-${b.scope.runId}:8080`);
    expect(docker.containers.has(`gdy-${a.scope.runId}`)).toBe(false);
    expect(docker.images.size).toBe(2);
    const state = await provider.inspect(b.scope, b.manifest);
    expect(state).toMatchObject({ active: true, url: `https://${env}.apps.example.test` });
  });

  it("rolls back to a retained digest without pulling it again", async () => {
    const { docker, provider } = setup();
    const env = crypto.randomUUID();
    const a = release(env, digestOf("one"));
    await provider.stage(a.scope, a.manifest, a.artifact, guard);
    await provider.promote(a.scope, a.manifest, null, guard);
    const b = release(env, digestOf("two"));
    await provider.stage(b.scope, b.manifest, b.artifact, guard);
    await provider.promote(b.scope, b.manifest, a.scope, guard);
    const pulls = docker.log.filter((c) => c[1] === "pull").length;
    const back = release(env, a.artifact.digest, "rollback");
    await provider.stage(back.scope, back.manifest, back.artifact, guard);
    await provider.promote(back.scope, back.manifest, b.scope, guard);
    expect(docker.log.filter((c) => c[1] === "pull")).toHaveLength(pulls);
    expect(docker.routes.get(env)).toContain(a.artifact.digest);
  });

  it("restores the previous route when Caddy validation fails and keeps the old upstream", async () => {
    const { docker, provider } = setup();
    const env = crypto.randomUUID();
    const a = release(env, digestOf("one"));
    await provider.stage(a.scope, a.manifest, a.artifact, guard);
    await provider.promote(a.scope, a.manifest, null, guard);
    const before = docker.routes.get(env);
    const b = release(env, digestOf("two"));
    await provider.stage(b.scope, b.manifest, b.artifact, guard);
    docker.failing.add("caddy validate");
    await expect(provider.promote(b.scope, b.manifest, a.scope, guard)).rejects.toThrow(
      "validation",
    );
    expect(docker.routes.get(env)).toBe(before);
    expect(docker.containers.has(`gdy-${a.scope.runId}`)).toBe(true);
  });

  it("refuses to promote a runtime that fails its readiness probe", async () => {
    const { docker, provider } = setup();
    const r = release(crypto.randomUUID(), digestOf("one"));
    await provider.stage(r.scope, r.manifest, r.artifact, guard);
    docker.setHealthy(false);
    await expect(provider.promote(r.scope, r.manifest, null, guard)).rejects.toThrow();
    expect(docker.routes.size).toBe(0);
  });

  it("reconciles an unknown promotion from labels and the route file alone", async () => {
    const { docker, provider } = setup();
    const env = crypto.randomUUID();
    const r = release(env, digestOf("one"));
    await provider.stage(r.scope, r.manifest, r.artifact, guard);
    await provider.promote(r.scope, r.manifest, null, guard);
    // A fresh runtime instance has no memory of the earlier call.
    const again = new ManagedDeliveryProvider(
      provider.binding,
      new DockerJenkinsTransport(
        {} as never,
        new DockerRuntime({
          registry: new RegistryClient({
            baseUrl: "http://registry.internal:5000",
            repositoryPrefix: "apps",
          }),
          routes: docker.store,
          run: docker.run,
          caddyContainer: CADDY,
          appDomain: "apps.example.test",
        }),
      ),
    );
    expect(await again.inspect(r.scope, r.manifest)).toMatchObject({ present: true, active: true });
  });

  it("refuses to adopt a container with the same name but foreign ownership", async () => {
    const { docker, provider } = setup();
    const r = release(crypto.randomUUID(), digestOf("one"));
    docker.containers.set(`gdy-${r.scope.runId}`, {
      args: [],
      labels: { "godseye.managed": "true", "godseye.run": r.scope.runId },
      running: true,
    });
    await expect(provider.stage(r.scope, r.manifest, r.artifact, guard)).rejects.toThrow("foreign");
  });

  it("cleans up only the owned preview, drops its route and leaves images for retention", async () => {
    const { docker, provider } = setup();
    const env = crypto.randomUUID();
    const r = release(env, digestOf("one"), "release", true);
    await provider.stage(r.scope, r.manifest, r.artifact, guard);
    await provider.promote(r.scope, r.manifest, null, guard);
    const cleanup = {
      ...structuredClone(r.manifest),
      intent: "cleanup" as const,
      cleanupReason: "ttl" as const,
    };
    await provider.cleanup(r.scope, cleanup, guard);
    expect(docker.routes.size).toBe(0);
    expect(docker.containers.size).toBe(0);
    expect(docker.networks.size).toBe(0);
    expect(docker.images.size).toBe(1);
  });

  it("refuses cleanup of non-synthetic production runtime", async () => {
    const { provider } = setup();
    const r = release(crypto.randomUUID(), digestOf("one"));
    const cleanup = { ...structuredClone(r.manifest), intent: "cleanup" as const };
    await expect(provider.cleanup(r.scope, cleanup, guard)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
