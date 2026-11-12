import { z } from "zod";
import type { AccessScope } from "./access-provider.js";

export const BAO_BROKER_POLICY = "godseye-broker-v1";
export function baoMount(mount = "godseye") {
  return z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,47}$/)
    .parse(mount);
}
export function baoPath(scope: AccessScope, mount = "godseye") {
  const id = z.string().uuid();
  const purpose = z.enum(["runtime", "migration", "deploy", "backup"]).parse(scope.purpose);
  return `${baoMount(mount)}/data/cells/${id.parse(scope.projectId)}/${id.parse(scope.environmentId)}/${purpose}/${id.parse(scope.id)}/${id.parse(scope.slotId)}`;
}
/** Operator installs this policy. The controller cannot write ACLs or create provider identities. */
export function compileBrokerPolicy(mount = "godseye") {
  const root = baoMount(mount);
  return `path "${root}/data/cells/*" { capabilities = ["create", "update", "read"] }\npath "auth/token/lookup-self" { capabilities = ["read"] }\npath "sys/policies/acl/${BAO_BROKER_POLICY}" { capabilities = ["read"] }\n`;
}
/** Exact slot paths avoid broad prefix/list leakage across cells or purposes. */
export function compileCellPolicy(scopes: AccessScope[], mount = "godseye") {
  if (!scopes.length || scopes.length > 100) throw new Error("A bounded slot list is required");
  return `${[...new Set(scopes.map((scope) => baoPath(scope, mount)))]
    .sort()
    .map((path) => `path "${path}" { capabilities = ["read"] }`)
    .join("\n")}\n`;
}
