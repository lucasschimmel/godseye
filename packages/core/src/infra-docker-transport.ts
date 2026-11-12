import { request } from "node:http";
import { z } from "zod";
import { DomainError } from "./errors.js";
import type { renderDockerNetwork, renderDockerSandbox } from "./infra-docker-policy.js";

const DockerId = z.string().regex(/^[a-f0-9]{64}$/);
const Created = z.object({ Id: DockerId });
export const DockerNetworkInspection = z.object({
  Id: DockerId,
  Name: z.string(),
  Driver: z.string(),
  Internal: z.boolean(),
  EnableIPv6: z.boolean(),
  Labels: z.record(z.string(), z.string()),
  IPAM: z.object({
    Driver: z.string(),
    Config: z.array(z.object({ Subnet: z.string(), Gateway: z.string().optional() })),
  }),
});
export const DockerSandboxInspection = z.object({
  Id: DockerId,
  Name: z.string(),
  Image: z.string(),
  Config: z.object({
    Image: z.string(),
    User: z.string(),
    Labels: z.record(z.string(), z.string()),
    Entrypoint: z.array(z.string()).nullable(),
    Cmd: z.array(z.string()).nullable(),
  }),
  State: z.object({ Running: z.boolean() }),
  HostConfig: z.object({
    Runtime: z.string(),
    Privileged: z.boolean(),
    ReadonlyRootfs: z.boolean(),
    CapDrop: z.array(z.string()),
    CapAdd: z.array(z.string()).nullable(),
    SecurityOpt: z.array(z.string()),
    NetworkMode: z.string(),
    PidMode: z.string(),
    IpcMode: z.string(),
    NanoCpus: z.number(),
    Memory: z.number(),
    MemorySwap: z.number(),
    PidsLimit: z.number(),
    Binds: z.array(z.string()).nullable(),
    Devices: z.array(z.unknown()).nullable(),
    PortBindings: z.record(z.string(), z.unknown()).nullable(),
    PublishAllPorts: z.boolean(),
    Tmpfs: z.record(z.string(), z.string()),
  }),
  Mounts: z.array(
    z.object({
      Type: z.string(),
      Name: z.string().optional(),
      Source: z.string(),
      Destination: z.string(),
      RW: z.boolean(),
    }),
  ),
  NetworkSettings: z.object({
    Ports: z
      .record(
        z.string(),
        z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable(),
      )
      .nullable(),
    Networks: z.record(
      z.string(),
      z.object({ NetworkID: z.string(), IPAddress: z.string(), GlobalIPv6Address: z.string() }),
    ),
  }),
});
export type DockerSandboxInspectionInput = z.infer<typeof DockerSandboxInspection>;
export interface DockerTransportOptions {
  socketPath: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
/** Fixed Engine endpoints over a private local socket only. No caller URL, shell, general request or exec API. */
export class DockerEngineTransport {
  private readonly socketPath: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  constructor(options: DockerTransportOptions) {
    if (
      !(
        options.socketPath === "\\\\.\\pipe\\docker_engine" ||
        /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.sock$/.test(options.socketPath)
      )
    )
      throw new Error(
        "Docker transport requires an operator-selected local Unix socket or Docker named pipe",
      );
    this.socketPath = options.socketPath;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxResponseBytes = options.maxResponseBytes ?? 1_048_576;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 1 ||
      this.timeoutMs > 30_000 ||
      !Number.isInteger(this.maxResponseBytes) ||
      this.maxResponseBytes < 128 ||
      this.maxResponseBytes > 4_194_304
    )
      throw new Error("Invalid bounded Docker transport policy");
  }
  private async call(method: "GET" | "POST", path: string, body?: object): Promise<unknown> {
    const encoded = body ? Buffer.from(JSON.stringify(body)) : undefined;
    if ((encoded?.length ?? 0) > this.maxResponseBytes)
      throw new DomainError(
        "PROVIDER_REQUEST_TOO_LARGE",
        "Compiled Docker request exceeds its bound",
        422,
      );
    return new Promise((resolve, reject) => {
      const fail = () =>
        reject(
          new DomainError(
            "PROVIDER_UNAVAILABLE",
            "Local Docker Engine request failed or exceeded its bound",
            503,
          ),
        );
      const call = request(
        {
          socketPath: this.socketPath,
          method,
          path: `/v1.51${path}`,
          headers: {
            "Content-Type": "application/json",
            ...(encoded ? { "Content-Length": encoded.length } : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > this.maxResponseBytes) {
              call.destroy();
              fail();
            } else chunks.push(chunk);
          });
          response.on("error", fail);
          response.on("end", () => {
            if (method === "GET" && (response.statusCode ?? 500) === 404) {
              resolve(null);
              return;
            }
            if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
              fail();
              return;
            }
            try {
              resolve(size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
            } catch {
              fail();
            }
          });
        },
      );
      const timer = setTimeout(() => {
        call.destroy();
        fail();
      }, this.timeoutMs);
      call.on("close", () => clearTimeout(timer));
      call.on("error", fail);
      call.end(encoded);
    });
  }
  async createNetwork(body: ReturnType<typeof renderDockerNetwork>) {
    return Created.parse(await this.call("POST", "/networks/create", body)).Id;
  }
  async inspectNetwork(id: string) {
    const result = await this.call("GET", `/networks/${DockerId.parse(id)}`);
    return result === null ? null : DockerNetworkInspection.parse(result);
  }
  async findNetworkByName(name: string) {
    if (!/^gse-[a-f0-9-]{36}-net$/.test(name)) throw new Error("Invalid server-owned network name");
    const result = await this.call("GET", `/networks/${name}`);
    return result === null ? null : DockerNetworkInspection.parse(result);
  }
  async createSandbox(name: string, body: ReturnType<typeof renderDockerSandbox>) {
    if (!/^gse-[a-f0-9-]{36}-app$/.test(name)) throw new Error("Invalid compiled sandbox name");
    return Created.parse(
      await this.call("POST", `/containers/create?name=${encodeURIComponent(name)}`, body),
    ).Id;
  }
  async inspectSandbox(id: string) {
    const result = await this.call("GET", `/containers/${DockerId.parse(id)}/json`);
    return result === null ? null : DockerSandboxInspection.parse(result);
  }
  async findSandboxByName(name: string) {
    if (!/^gse-[a-f0-9-]{36}-app$/.test(name)) throw new Error("Invalid server-owned sandbox name");
    const result = await this.call("GET", `/containers/${name}/json`);
    return result === null ? null : DockerSandboxInspection.parse(result);
  }
  async startSandbox(id: string) {
    await this.call("POST", `/containers/${DockerId.parse(id)}/start`);
  }
  async stopSandbox(id: string) {
    await this.call("POST", `/containers/${DockerId.parse(id)}/stop?t=3`);
  }
}
