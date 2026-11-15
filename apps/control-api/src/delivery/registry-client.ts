import { createHash } from "node:crypto";
import { z } from "zod";

const MANIFEST_LIMIT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;
const ACCEPT = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const Descriptor = z.object({ size: z.number().int().nonnegative() });
const Manifest = z.object({
  schemaVersion: z.literal(2),
  config: Descriptor,
  layers: z.array(Descriptor).min(1).max(256),
});

export interface RegistryConfig {
  /** Private registry origin (Zot or registry:2 bound to a private address). */
  baseUrl: string;
  /** Repository path prefix owned by this platform, e.g. `apps`. */
  repositoryPrefix: string;
  basicAuth?: { user: string; password: string };
}
export interface VerifiedImage {
  digest: string;
  sizeBytes: number;
}

/** Verifies an image digest against registry bytes instead of trusting a builder's claim. */
export class RegistryClient {
  constructor(
    private readonly config: RegistryConfig,
    private readonly request: typeof fetch = fetch,
  ) {}
  /** `<host>/<prefix>/<name>@<digest>` for pulls; host is the registry authority. */
  reference(name: string, digest: string) {
    return `${new URL(this.config.baseUrl).host}/${this.repository(name)}@${digest}`;
  }
  repository(name: string) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(name)) throw new Error("Image name is invalid");
    return `${this.config.repositoryPrefix}/${name}`;
  }
  async verify(name: string, digest: string): Promise<VerifiedImage | null> {
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error("Image digest is invalid");
    const headers: Record<string, string> = { accept: ACCEPT };
    if (this.config.basicAuth) {
      const { user, password } = this.config.basicAuth;
      headers.authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    }
    const response = await this.request(
      `${this.config.baseUrl.replace(/\/+$/, "")}/v2/${this.repository(name)}/manifests/${digest}`,
      { headers, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Registry request failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MANIFEST_LIMIT_BYTES) throw new Error("Registry manifest is too large");
    const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (actual !== digest) throw new Error("Registry manifest bytes do not match the digest");
    const manifest = Manifest.parse(JSON.parse(new TextDecoder().decode(bytes)));
    return {
      digest,
      sizeBytes: manifest.config.size + manifest.layers.reduce((sum, layer) => sum + layer.size, 0),
    };
  }
}
