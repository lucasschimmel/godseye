import type { AccessHealthView } from "@godseye/contracts";
import { z } from "zod";
import type {
  AccessEnvelope,
  AccessProvider,
  AccessScope,
  AccessVersion,
} from "./access-provider.js";
import { BAO_BROKER_POLICY, baoMount, baoPath, compileBrokerPolicy } from "./bao-policy.js";
import { DomainError } from "./errors.js";

const Envelope = z
  .object({
    value: z.string().min(1).max(16384),
    operationId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export interface BaoProviderOptions {
  address: string;
  proof: () => string | Promise<string>;
  mount?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}
/** Loopback-only local adapter; remote TLS/private-network qualification is a separate gate. */
export class BaoAccessProvider implements AccessProvider {
  private readonly address: string;
  private readonly mount: string;
  private readonly timeout: number;
  private readonly maxBytes: number;
  constructor(private readonly options: BaoProviderOptions) {
    const url = new URL(options.address);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("Only an explicit loopback OpenBao origin is available locally");
    this.address = url.origin;
    this.mount = baoMount(options.mount);
    this.timeout = options.timeoutMs ?? 5000;
    this.maxBytes = options.maxResponseBytes ?? 65536;
    if (
      !Number.isInteger(this.timeout) ||
      this.timeout < 1 ||
      this.timeout > 30000 ||
      !Number.isInteger(this.maxBytes) ||
      this.maxBytes < 1024 ||
      this.maxBytes > 1048576
    )
      throw new Error("Invalid bounded provider transport settings");
  }
  private async request(path: string, method = "GET", body?: unknown, authenticated = true) {
    const proof = authenticated ? await this.options.proof() : undefined;
    if (authenticated && (!proof || proof.length > 4096 || /[\r\n]/.test(proof)))
      throw new Error("Provider authentication unavailable");
    const response = await fetch(`${this.address}/v1/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(this.timeout),
      headers: { "content-type": "application/json", ...(proof ? { "X-Vault-Token": proof } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (reader)
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > this.maxBytes) throw new Error("Provider response exceeds bound");
          chunks.push(item.value);
        }
    } finally {
      await reader?.cancel().catch(() => undefined);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const data: unknown = text ? JSON.parse(text) : {};
    return { status: response.status, data };
  }
  async health(): Promise<AccessHealthView> {
    try {
      const health = await this.request("sys/health", "GET", undefined, false);
      const state = z.object({ initialized: z.boolean(), sealed: z.boolean() }).parse(health.data);
      if (!state.initialized) return { state: "uninitialized" };
      if (state.sealed) return { state: "sealed" };
      if (health.status !== 200) return { state: "unavailable" };
      const auth = await this.request("auth/token/lookup-self");
      if (auth.status !== 200) return { state: "unauthorized" };
      const identity = z
        .object({
          data: z.object({
            policies: z.array(z.string()),
            identity_policies: z.array(z.string()).optional(),
          }),
        })
        .parse(auth.data).data;
      if (
        identity.policies.length !== 1 ||
        identity.policies[0] !== BAO_BROKER_POLICY ||
        (identity.identity_policies?.length ?? 0) > 0
      )
        return { state: "unauthorized" };
      const policy = await this.request(`sys/policies/acl/${BAO_BROKER_POLICY}`);
      if (policy.status !== 200) return { state: "unauthorized" };
      const actual = z.object({ data: z.object({ policy: z.string() }) }).parse(policy.data)
        .data.policy;
      if (actual.trim() !== compileBrokerPolicy(this.mount).trim())
        return { state: "unauthorized" };
      return { state: "ready" };
    } catch {
      return { state: "unavailable" };
    }
  }
  private async ready() {
    const health = await this.health();
    if (health.state !== "ready")
      throw new DomainError("CAPABILITY_UNAVAILABLE", `OpenBao is ${health.state}`, 503);
  }
  async read(scope: AccessScope, version?: number): Promise<AccessVersion | null> {
    await this.ready();
    try {
      if (version !== undefined && (!Number.isInteger(version) || version < 1))
        throw new Error("Invalid provider version");
      const response = await this.request(
        `${baoPath(scope, this.mount)}${version ? `?version=${version}` : ""}`,
      );
      if (response.status === 404) return null;
      if (response.status !== 200) throw new Error("Provider read rejected");
      const payload = z
        .object({
          data: z.object({
            data: Envelope,
            metadata: z.object({ version: z.number().int().positive() }),
          }),
        })
        .parse(response.data).data;
      return { ...payload.data, version: payload.metadata.version };
    } catch {
      throw new DomainError("PROVIDER_UNAVAILABLE", "OpenBao material read failed", 503);
    }
  }
  async write(scope: AccessScope, input: AccessEnvelope, cas: number) {
    await this.ready();
    const data = Envelope.parse(input);
    if (!Number.isInteger(cas) || cas < 0)
      throw new Error("Invalid provider compare-and-set version");
    try {
      const response = await this.request(baoPath(scope, this.mount), "POST", {
        options: { cas },
        data,
      });
      if (response.status === 400)
        throw new DomainError(
          "PROVIDER_CONFLICT",
          "OpenBao compare-and-set rejected the version",
          409,
        );
      if (response.status !== 200) throw new Error("Provider write rejected");
      return z
        .object({ data: z.object({ version: z.number().int().positive() }) })
        .parse(response.data).data.version;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "PROVIDER_UNKNOWN",
        "OpenBao write outcome requires reconciliation",
        503,
      );
    }
  }
}
