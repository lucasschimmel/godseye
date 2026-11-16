import { isIP } from "node:net";
import { DATABASE_ROLES } from "@godseye/contracts";
import type { CompiledDatabaseProfile } from "./database-policy.js";
import { parsePrivateSubnet } from "./infra-network.js";

function prefix(mask: string) {
  const family = isIP(mask);
  const halves = mask.split("::");
  const left = halves[0]?.split(":").filter(Boolean) ?? [];
  const right = halves[1]?.split(":").filter(Boolean) ?? [];
  const groups =
    family === 4
      ? mask.split(".")
      : halves.length === 2
        ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
        : left;
  const binary = groups
    .map((part) =>
      Number.parseInt(part, family === 4 ? 10 : 16)
        .toString(2)
        .padStart(family === 4 ? 8 : 16, "0"),
    )
    .join("");
  if (!family || !/^1*0*$/.test(binary)) throw new Error("Invalid HBA netmask");
  return binary.indexOf("0") === -1 ? binary.length : binary.indexOf("0");
}
function privateSource(row: Record<string, unknown>) {
  const address = String(row.address),
    bits = prefix(String(row.netmask));
  const family = isIP(address);
  if ((address === "127.0.0.1" && bits === 32) || (address === "::1" && bits === 128))
    return family;
  const subnet = parsePrivateSubnet(`${address}/${bits}`);
  if (subnet.prefix < (family === 4 ? 28 : 64)) throw new Error("Database HBA source is too broad");
  return family;
}
function exactly(value: unknown, expected: string) {
  return Array.isArray(value) && value.length === 1 && value[0] === expected;
}
/** Ordered first-match policy, exact roles/databases and restrictive sources, with no permissive fallback. */
export function assertDatabaseHba(
  profile: CompiledDatabaseProfile,
  rows: Record<string, unknown>[],
) {
  const [admin, localReject] = rows;
  const adminUser =
    Array.isArray(admin?.user_name) && admin.user_name.length === 1 ? admin.user_name[0] : null;
  if (
    admin?.type !== "local" ||
    !exactly(admin.database, "all") ||
    !adminUser ||
    DATABASE_ROLES.some((role) => profile.roles[role].name === adminUser) ||
    admin.auth_method !== "scram-sha-256" ||
    !localReject ||
    localReject.type !== "local" ||
    !exactly(localReject.database, "all") ||
    !exactly(localReject.user_name, "all") ||
    localReject.auth_method !== "reject"
  )
    throw new Error("Private administrative HBA boundary differs");
  const fallback = rows.slice(-2);
  if (
    fallback.length !== 2 ||
    fallback[0]?.type !== "host" ||
    fallback[0]?.address !== "0.0.0.0" ||
    fallback[1]?.type !== "host" ||
    fallback[1]?.address !== "::" ||
    fallback.some(
      (row) =>
        row.auth_method !== "reject" ||
        !exactly(row.database, "all") ||
        !exactly(row.user_name, "all") ||
        prefix(String(row.netmask)) !== 0,
    )
  )
    throw new Error("HBA reject fallback differs");
  const expected = new Set(
    DATABASE_ROLES.flatMap((role) => {
      const database = ["workflow", "workflowMigration"].includes(role)
        ? profile.workflowDatabase
        : profile.applicationDatabase;
      return [4, 6].flatMap((family) => [
        `${profile.roles[role].name}:${database}:${family}`,
        ...(role === "backup"
          ? [`${profile.roles[role].name}:${profile.workflowDatabase}:${family}`]
          : []),
      ]);
    }),
  );
  for (const row of rows.slice(2, -2)) {
    if (
      row.error ||
      row.type !== "hostssl" ||
      row.auth_method !== "scram-sha-256" ||
      !Array.isArray(row.user_name) ||
      row.user_name.length !== 1 ||
      !Array.isArray(row.database) ||
      row.database.length !== 1
    )
      throw new Error("HBA role/database/transport differs");
    const key = `${row.user_name[0]}:${row.database[0]}:${privateSource(row)}`;
    if (!expected.delete(key)) throw new Error("HBA contains unexpected or duplicate authority");
  }
  if (expected.size) throw new Error("HBA omits required scoped service rules");
}
