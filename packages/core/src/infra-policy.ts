import {
  ApplicationWorkload,
  type ApplicationWorkloadInput,
  type CompiledApplicationInput,
  CompiledApplicationManifest,
} from "@godseye/contracts";
import { DomainError, parseInput } from "./errors.js";
import { parsePrivateSubnet } from "./infra-network.js";
import { fingerprint } from "./journal.js";

export const INFRASTRUCTURE_POLICY_VERSION = "application-runsc-systrap-v1";
export interface ApplicationScope {
  allocationId: string;
  projectId: string;
  environmentId: string;
  ipv4Subnet: string;
  ipv6Subnet: string;
  providerBinding?: CompiledApplicationInput["providerBinding"];
}
export type CompiledApplication = CompiledApplicationInput;
export function immutableSnapshot<T>(input: T): T {
  const copy = structuredClone(input);
  const freeze = (value: unknown) => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(copy);
  return copy;
}
export function compileApplication(
  input: ApplicationWorkloadInput,
  context: ApplicationScope,
): CompiledApplication {
  const data = parseInput(ApplicationWorkload, input);
  if (data.image.split("@")[1] !== data.artifactDigest)
    throw new DomainError(
      "ARTIFACT_MISMATCH",
      "The verified artifact digest must match the immutable application image",
      422,
    );
  const scope = structuredClone(context);
  for (const id of [scope.allocationId, scope.projectId, scope.environmentId])
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid server-owned application scope");
  const ipv4 = parsePrivateSubnet(scope.ipv4Subnet),
    ipv6 = parsePrivateSubnet(scope.ipv6Subnet);
  if (ipv4.family !== 4 || ipv4.prefix !== 28 || ipv6.family !== 6 || ipv6.prefix !== 64)
    throw new Error("Invalid application subnet profile");
  const { image, artifactDigest, ...limits } = data;
  return immutableSnapshot(
    CompiledApplicationManifest.parse({
      policyVersion: INFRASTRUCTURE_POLICY_VERSION,
      allocationId: scope.allocationId,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      image,
      artifactDigest,
      providerBinding: scope.providerBinding ?? null,
      ownership: fingerprint({
        allocationId: scope.allocationId,
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        policyVersion: INFRASTRUCTURE_POLICY_VERSION,
      }),
      names: {
        network: `gse-${scope.allocationId}-net`,
        data: `gse-${scope.allocationId}-data`,
        sandbox: `gse-${scope.allocationId}-app`,
      },
      runtime: "runsc",
      platform: "systrap",
      user: "65532:65532",
      readOnlyRoot: true,
      capabilities: [],
      noNewPrivileges: true,
      seccomp: "runtime-default",
      limits,
      network: {
        ipv4Subnet: ipv4.canonical,
        ipv6Subnet: ipv6.canonical,
        internal: true,
        ingress: "deny",
        egress: "deny",
        hostAccess: "deny",
        publishedPorts: [],
      },
      mounts: { temporary: "/tmp", persistent: "/data", quotaRequired: true },
    }),
  );
}
