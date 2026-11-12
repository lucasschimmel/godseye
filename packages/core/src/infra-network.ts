import { isIP } from "node:net";
import { DomainError } from "./errors.js";

export interface PrivateSubnet {
  family: 4 | 6;
  prefix: number;
  network: bigint;
  end: bigint;
  canonical: string;
}
const fail = () =>
  new DomainError(
    "INVALID_NETWORK",
    "A canonical RFC1918 IPv4 or ULA IPv6 subnet is required",
    422,
  );
function address(value: string, family: 4 | 6) {
  if (family === 4) return value.split(".").reduce((sum, part) => sum * 256n + BigInt(part), 0n);
  if (value.includes(".") || value.includes("%")) throw fail();
  const halves = value.split("::");
  const left = halves[0]?.split(":").filter(Boolean) ?? [];
  const right = halves[1]?.split(":").filter(Boolean) ?? [];
  const groups =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  return groups.reduce((sum, group) => sum * 65536n + BigInt(`0x${group}`), 0n);
}
function format(value: bigint, family: 4 | 6) {
  if (family === 4)
    return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".");
  const groups = Array.from({ length: 8 }, (_, i) =>
    ((value >> BigInt((7 - i) * 16)) & 65535n).toString(16),
  );
  // URL's IPv6 serializer supplies the standard longest-zero-run canonical form.
  return new URL(`http://[${groups.join(":")}]/`).hostname.slice(1, -1);
}
export function parsePrivateSubnet(input: string): PrivateSubnet {
  const parts = input.split("/");
  const ip = parts[0] ?? "";
  const family = isIP(ip);
  if (
    (family !== 4 && family !== 6) ||
    parts.length !== 2 ||
    !/^(0|[1-9][0-9]{0,2})$/.test(parts[1] ?? "")
  )
    throw fail();
  const prefix = Number(parts[1]);
  const bits = family === 4 ? 32 : 128;
  if (prefix < (family === 4 ? 8 : 7) || prefix > bits) throw fail();
  const network = address(ip, family);
  const size = 1n << BigInt(bits - prefix);
  if (network % size !== 0n) throw fail();
  const end = network + size - 1n;
  const privateRanges =
    family === 4
      ? [
          [0x0a000000n, 0x0affffffn],
          [0xac100000n, 0xac1fffffn],
          [0xc0a80000n, 0xc0a8ffffn],
        ]
      : [[0xfc000000000000000000000000000000n, 0xfdffffffffffffffffffffffffffffffn]];
  if (
    !privateRanges.some(
      ([start, stop]) =>
        start !== undefined && stop !== undefined && network >= start && end <= stop,
    )
  )
    throw fail();
  return { family, prefix, network, end, canonical: `${format(network, family)}/${prefix}` };
}
export function subnetsOverlap(a: string, b: string) {
  const left = parsePrivateSubnet(a),
    right = parsePrivateSubnet(b);
  return left.family === right.family && left.network <= right.end && right.network <= left.end;
}
export function subnetContains(pool: string, ip: string) {
  const parent = parsePrivateSubnet(pool),
    child = parsePrivateSubnet(`${ip}/${parent.family === 4 ? 32 : 128}`);
  return (
    parent.family === child.family && parent.network <= child.network && parent.end >= child.end
  );
}
export function allocatePrivateSubnet(pool: string, occupied: readonly string[]): string {
  const parent = parsePrivateSubnet(pool);
  const prefix = parent.family === 4 ? 28 : 64;
  if (parent.prefix > prefix || parent.prefix < (parent.family === 4 ? 16 : 48)) throw fail();
  const stride = 1n << BigInt((parent.family === 4 ? 32 : 128) - prefix);
  for (let index = 0n; index < 4096n && parent.network + index * stride <= parent.end; index++) {
    const candidate = `${format(parent.network + index * stride, parent.family)}/${prefix}`;
    if (!occupied.some((subnet) => subnetsOverlap(candidate, subnet))) return candidate;
  }
  throw new DomainError(
    "ADDRESS_EXHAUSTED",
    "Private address pool has no available cell subnet",
    409,
  );
}
