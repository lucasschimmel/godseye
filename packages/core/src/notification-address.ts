import { isIPv4, isIPv6 } from "node:net";

/** [network, prefix length] pairs for IPv4 ranges a webhook must never reach. */
const BLOCKED_V4: readonly (readonly [number, number])[] = [
  [0x00000000, 8], // "this" network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, including cloud metadata
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // documentation
  [0xc0586300, 24], // 6to4 relay anycast
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved and broadcast
];

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}
function inV4(value: number, [network, prefix]: readonly [number, number]): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(value / size) === Math.floor(network / size);
}
function publicV4(address: string): boolean {
  const value = ipv4Number(address);
  return value !== null && !BLOCKED_V4.some((range) => inV4(value, range));
}

/** Expands any valid IPv6 literal (including `::` and an embedded dotted IPv4 tail) to eight 16-bit groups. */
function ipv6Groups(address: string): number[] | null {
  const bare = address.split("%")[0] ?? "";
  let text = bare;
  const tail = text.match(/:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail?.[1]) {
    const value = ipv4Number(tail[1]);
    if (value === null) return null;
    text = `${text.slice(0, text.length - tail[1].length)}${Math.floor(value / 65536).toString(16)}:${(value % 65536).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (part === "" ? [] : part.split(":"));
  const head = read(halves[0] ?? "");
  const rest = read(halves[1] ?? "");
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest].map((group) =>
    /^[0-9a-f]{1,4}$/i.test(group) ? Number.parseInt(group, 16) : Number.NaN,
  );
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}
function embeddedV4(high: number, low: number): string {
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}
/** IPv4-mapped/-compatible and NAT64 forms tunnel to IPv4 hosts; they are refused outright. */
function tunnelsToV4(g: readonly number[]): boolean {
  const zeros = (from: number, to: number) => g.slice(from, to).every((group) => group === 0);
  return (
    (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) ||
    (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6))
  );
}
function publicV6(g: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = g;
  // Only global unicast 2000::/3 is reachable; loopback, ULA, link-local, multicast and the
  // unspecified address all fall outside it.
  if ((a & 0xe000) !== 0x2000) return false;
  if (a === 0x2001 && (b & 0xfe00) === 0) return false; // 2001::/23 protocol assignments, Teredo
  if (a === 0x2001 && b === 0x0db8) return false; // documentation
  if (a === 0x3fff && (b & 0xf000) === 0) return false; // documentation 3fff::/20
  if (a === 0x2002) return publicV4(embeddedV4(b, c)); // 6to4 embeds an IPv4 address
  return true;
}

/** True only for a globally routable unicast address; every malformed or special-purpose input is false. */
export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) return publicV4(address);
  if (!isIPv6(address)) return false;
  const groups = ipv6Groups(address);
  return groups !== null && !tunnelsToV4(groups) && publicV6(groups);
}
