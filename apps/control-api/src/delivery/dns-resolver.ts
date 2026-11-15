import { Resolver } from "node:dns/promises";
import { DomainError, type DomainResolver } from "@godseye/core";

const ABSENT = new Set(["ENODATA", "ENOTFOUND", "ENOENT"]);
/** Per-lookup bound so a verification request cannot hang on an unresponsive resolver. */
const TIMEOUT_MS = 4000;

type Lookup<T> = (resolver: Resolver, name: string) => Promise<T[]>;
async function read<T>(name: string, lookup: Lookup<T>, servers?: string[]): Promise<T[]> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  if (servers?.length) resolver.setServers(servers);
  try {
    return await lookup(resolver, name);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (ABSENT.has(code)) return [];
    // A resolver failure is not evidence about the owner's records: report it, never record a verdict.
    throw new DomainError("DNS_UNAVAILABLE", "DNS lookup is temporarily unavailable", 503);
  }
}
/** System-resolver (or explicit server list) DNS reads; "no such record" is an empty answer. */
export function createDnsResolver(servers?: string[]): DomainResolver {
  return {
    cname: (name) => read(name, (resolver, host) => resolver.resolveCname(host), servers),
    ipv4: (name) => read(name, (resolver, host) => resolver.resolve4(host), servers),
    txt: async (name) =>
      (await read(name, (resolver, host) => resolver.resolveTxt(host), servers)).map((chunks) =>
        chunks.join(""),
      ),
  };
}
