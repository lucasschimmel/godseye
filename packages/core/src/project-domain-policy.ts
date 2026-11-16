import { DOMAIN_CHALLENGE_LABEL, DOMAIN_CHALLENGE_PREFIX } from "@godseye/contracts";

/** DNS reads the engine needs; implementations must return `[]` (never throw) for "no such record". */
export interface DomainResolver {
  cname(hostname: string): Promise<string[]>;
  ipv4(hostname: string): Promise<string[]>;
  txt(hostname: string): Promise<string[]>;
}
/** Where an owner points a custom name, and the platform domain that custom names must never shadow. */
export interface DomainTarget {
  cname: string;
  ipv4: string[];
  platformDomain: string;
}
/** Writes the complete set of served custom hostnames of one environment (empty set removes them). */
export interface DomainRoutePublisher {
  publish(input: { environmentId: string; hostnames: string[] }): Promise<void>;
}

const MAX_CNAME_HOPS = 5;
/** Two-label public suffixes that make a three-label name an apex; a deliberately small heuristic. */
const MULTI_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "com.br",
  "co.za",
  "com.mx",
  "co.in",
]);

/** True for a registrable domain (`example.com`, `example.co.uk`), where a CNAME cannot exist. */
export function isApexDomain(hostname: string): boolean {
  const labels = hostname.split(".");
  if (labels.length === 2) return true;
  return labels.length === 3 && MULTI_LABEL_SUFFIXES.has(labels.slice(1).join("."));
}
/** The platform's own names are never bindable: custom domains cannot shadow app or console hosts. */
export function isPlatformHostname(hostname: string, platformDomain: string): boolean {
  return hostname === platformDomain || hostname.endsWith(`.${platformDomain}`);
}
export const challengeRecordName = (hostname: string) => `${DOMAIN_CHALLENGE_LABEL}.${hostname}`;
export const challengeRecordValue = (token: string) => `${DOMAIN_CHALLENGE_PREFIX}${token}`;

export type RoutingResult =
  | { status: "ok"; via: "cname" | "a" }
  | { status: "none" }
  | { status: "elsewhere" };
/**
 * CNAME to the platform host (chains followed, bounded) or A records that all belong to the platform
 * IPv4 set. A name that resolves only to foreign addresses, or to a mix, is `elsewhere`; a name with
 * no records at all is `none` (not yet configured).
 */
export async function evaluateRouting(
  resolver: DomainResolver,
  hostname: string,
  target: DomainTarget,
): Promise<RoutingResult> {
  let current = hostname;
  let sawCname = false;
  for (let hop = 0; hop < MAX_CNAME_HOPS; hop++) {
    const [next] = await resolver.cname(current);
    if (!next) break;
    sawCname = true;
    current = next.toLowerCase().replace(/\.$/, "");
    if (current === target.cname.toLowerCase()) return { status: "ok", via: "cname" };
  }
  const addresses = await resolver.ipv4(hostname);
  if (addresses.length > 0)
    return addresses.every((address) => target.ipv4.includes(address))
      ? { status: "ok", via: "a" }
      : { status: "elsewhere" };
  return sawCname ? { status: "elsewhere" } : { status: "none" };
}

export type OwnershipResult = "ok" | "none" | "mismatch";
/** Checks the `_godseye-challenge.<host>` TXT record for the stored per-binding token. */
export async function evaluateChallenge(
  resolver: DomainResolver,
  hostname: string,
  token: string,
): Promise<OwnershipResult> {
  const records = await resolver.txt(challengeRecordName(hostname));
  if (records.length === 0) return "none";
  return records.includes(challengeRecordValue(token)) ? "ok" : "mismatch";
}
