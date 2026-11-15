import { isPublicHostname } from "@godseye/contracts";

/** Suffix of the per-environment custom-domain file; the edge Caddyfile imports `*.caddy`. */
export const DOMAIN_ROUTE_SUFFIX = ".domains.caddy";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const UPSTREAM = /^[a-z0-9_.-]+:[0-9]{2,5}$/;
const HEADER = /^# godseye-domains environment=([a-f0-9-]{36}) upstream=(\S+) hosts=(\S+)$/m;
const NO_UPSTREAM = "none";

export interface DomainRoutes {
  environmentId: string;
  /** Container `name:port`, or null while the environment has no active deployment. */
  upstream: string | null;
  hostnames: string[];
}
/** Reads back the header written by {@link renderDomainRoutes}; foreign files yield null. */
export function parseDomainRoutes(content: string | null): DomainRoutes | null {
  const match = content ? HEADER.exec(content) : null;
  if (!match) return null;
  return {
    environmentId: match[1] as string,
    upstream: match[2] === NO_UPSTREAM ? null : (match[2] as string),
    hostnames: (match[3] as string).split(","),
  };
}
/** The upstream a platform route file currently proxies to, read from its `reverse_proxy` line. */
export function routeUpstream(content: string | null): string | null {
  const match = content ? /^\treverse_proxy (\S+) \{$/m.exec(content) : null;
  return match && UPSTREAM.test(match[1] as string) ? (match[1] as string) : null;
}
/**
 * One `https://<custom host>` block per verified hostname. `tls { on_demand }` makes Caddy obtain the
 * certificate per host through HTTP-01 only after the global `ask` guard approves it; no wildcard or
 * DNS credential is involved. Without an active deployment the hosts answer 503 instead of proxying.
 */
export function renderDomainRoutes(input: DomainRoutes) {
  if (!UUID.test(input.environmentId)) throw new Error("Domain route environment is invalid");
  if (input.hostnames.length === 0) throw new Error("Domain routes need at least one hostname");
  if (!input.hostnames.every(isPublicHostname)) throw new Error("Domain route host is invalid");
  if (input.upstream !== null && !UPSTREAM.test(input.upstream))
    throw new Error("Domain route upstream is invalid");
  const body = input.upstream
    ? [
        `\treverse_proxy ${input.upstream} {`,
        "\t\tflush_interval -1",
        "\t\ttransport http {",
        "\t\t\tdial_timeout 3s",
        "\t\t\tresponse_header_timeout 30s",
        "\t\t}",
        "\t}",
      ]
    : ['\trespond "No active deployment" 503'];
  const hostnames = [...input.hostnames].sort();
  return [
    `# godseye-domains environment=${input.environmentId} upstream=${input.upstream ?? NO_UPSTREAM} hosts=${hostnames.join(",")}`,
    ...hostnames.flatMap((host) => [
      `https://${host} {`,
      "\ttls {",
      "\t\ton_demand",
      "\t}",
      ...body,
      "}",
    ]),
    "",
  ].join("\n");
}
/** Re-renders an existing domain file against a new upstream (after a promotion or rollback). */
export function retargetDomainRoutes(content: string, upstream: string | null) {
  const current = parseDomainRoutes(content);
  if (!current) throw new Error("Domain route file is not platform-owned");
  return renderDomainRoutes({ ...current, upstream });
}
