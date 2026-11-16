import { DOMAIN_TLS_EXPIRING_DAYS, type DomainTlsView, isPublicHostname } from "@godseye/contracts";
import { DomainError } from "./errors.js";
import {
  type DomainResolver,
  type DomainTarget,
  evaluateRouting,
} from "./project-domain-policy.js";

/**
 * Reads the certificate the edge serves for one host. Implementations connect to `edgeAddress` (a
 * platform-configured IPv4, never derived from the host) with `hostname` as SNI and must return the
 * not-after date, `null` when the edge presented no certificate, and throw on any handshake failure.
 */
export interface CertificateProbe {
  inspect(input: { hostname: string; edgeAddress: string }): Promise<{ notAfter: Date | null }>;
}
export interface DomainTlsOptions {
  now: () => Date;
  probe?: CertificateProbe | undefined;
  resolver?: DomainResolver | undefined;
  target?: DomainTarget | undefined;
}
/** Binding states for which the edge actually holds (or is about to obtain) a certificate. */
const SERVED_STATES = new Set(["verified", "active"]);
const DAY_MS = 86_400_000;
const CACHE_MS = 60_000;
const CONCURRENCY = 6;

type Reason = NonNullable<DomainTlsView["reason"]>;
export interface TlsSubject {
  hostname: string;
  state: string;
}

/** Pure classification of a not-after date against the clock; expiry is inclusive. */
export function classifyCertificate(notAfter: Date, now: Date): DomainTlsView["state"] {
  const remaining = notAfter.getTime() - now.getTime();
  if (remaining <= 0) return "expired";
  return remaining < DOMAIN_TLS_EXPIRING_DAYS * DAY_MS ? "expiring" : "valid";
}

/**
 * Certificate state per registered host. Only hostnames that are already bound in the domain table and
 * served are probed, only through the platform's own edge address, and only after DNS confirms the name
 * routes to that edge. Nothing is written and no date is ever invented: every failure is `unknown`
 * with its reason. Results are cached briefly so reloading the page does not repeat handshakes.
 */
export class DomainTlsInspector {
  private readonly cache = new Map<string, { at: number; view: DomainTlsView }>();
  constructor(private readonly options: DomainTlsOptions) {}

  async inspectAll(subjects: readonly TlsSubject[]): Promise<Map<string, DomainTlsView>> {
    const result = new Map<string, DomainTlsView>();
    for (let index = 0; index < subjects.length; index += CONCURRENCY) {
      const batch = subjects.slice(index, index + CONCURRENCY);
      const views = await Promise.all(batch.map((subject) => this.inspect(subject)));
      batch.forEach((subject, position) => {
        result.set(subject.hostname, views[position] as DomainTlsView);
      });
    }
    return result;
  }

  private unknown(reason: Reason): DomainTlsView {
    return {
      state: "unknown",
      expiresAt: null,
      reason,
      checkedAt: this.options.now().toISOString(),
    };
  }

  private async inspect(subject: TlsSubject): Promise<DomainTlsView> {
    const { probe, resolver, target } = this.options;
    if (!probe || !resolver || !target) return this.unknown("PROBE_NOT_CONFIGURED");
    if (!SERVED_STATES.has(subject.state) || !isPublicHostname(subject.hostname))
      return this.unknown("NOT_SERVED");
    const cached = this.cache.get(subject.hostname);
    const nowMs = this.options.now().getTime();
    if (cached && nowMs - cached.at < CACHE_MS) return cached.view;
    const view = await this.observe(subject.hostname, { probe, resolver, target });
    this.cache.set(subject.hostname, { at: nowMs, view });
    return view;
  }

  private async observe(
    hostname: string,
    {
      probe,
      resolver,
      target,
    }: { probe: CertificateProbe; resolver: DomainResolver; target: DomainTarget },
  ): Promise<DomainTlsView> {
    const edgeAddress = target.ipv4[0];
    if (!edgeAddress) return this.unknown("PROBE_NOT_CONFIGURED");
    try {
      const routing = await evaluateRouting(resolver, hostname, target);
      if (routing.status !== "ok") return this.unknown("DNS_NOT_EDGE");
    } catch (error) {
      if (error instanceof DomainError) return this.unknown("DNS_UNAVAILABLE");
      throw error;
    }
    let notAfter: Date | null;
    try {
      ({ notAfter } = await probe.inspect({ hostname, edgeAddress }));
    } catch {
      return this.unknown("HANDSHAKE_FAILED");
    }
    if (!notAfter || Number.isNaN(notAfter.getTime())) return this.unknown("NO_CERTIFICATE");
    const now = this.options.now();
    return {
      state: classifyCertificate(notAfter, now),
      expiresAt: notAfter.toISOString(),
      reason: null,
      checkedAt: now.toISOString(),
    };
  }
}
