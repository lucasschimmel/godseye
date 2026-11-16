import { z } from "zod";

const Id = z.string().uuid();
const Count = z.number().int().positive().max(1_000_000_000);
export const InfrastructureCapacity = z
  .object({ cpuMilliCores: Count, memoryMiB: Count, storageGiB: Count, pids: Count })
  .strict();
export type InfrastructureCapacityInput = z.infer<typeof InfrastructureCapacity>;
const Guest = z
  .object({ role: z.enum(["professional", "games", "task"]), capacity: InfrastructureCapacity })
  .strict();
export const DeclareInventory = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    host: z
      .object({
        name: z.string().trim().min(2).max(80),
        capacity: InfrastructureCapacity,
        headroom: InfrastructureCapacity,
      })
      .strict(),
    guests: z.array(Guest).min(2).max(3),
    pool: z
      .object({
        capacity: InfrastructureCapacity,
        headroom: InfrastructureCapacity,
        ipv4Pool: z.string().max(43),
        ipv6Pool: z.string().max(64),
      })
      .strict(),
    publicIpv4Count: z.number().int().min(1).max(2),
    secondIpv4Justification: z.string().trim().min(10).max(500).optional(),
  })
  .strict();
export type DeclareInventoryInput = z.infer<typeof DeclareInventory>;
export const InfrastructureRevision = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export const ApplicationWorkload = z
  .object({
    image: z
      .string()
      .max(256)
      .regex(/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/),
    artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    cpuMilliCores: z.number().int().min(10).max(64_000),
    memoryMiB: z.number().int().min(16).max(262_144),
    pids: z.number().int().min(8).max(4096),
    temporaryMiB: z.number().int().min(1).max(4096),
    dataGiB: z.number().int().min(1).max(4096),
  })
  .strict();
export type ApplicationWorkloadInput = z.infer<typeof ApplicationWorkload>;
export const PrepareInfrastructure = z
  .object({
    projectId: Id,
    environmentId: Id,
    expectedProjectRevision: z.number().int().nonnegative(),
    workload: ApplicationWorkload,
  })
  .strict();
export type PrepareInfrastructureInput = z.infer<typeof PrepareInfrastructure>;
export const AdmitInfrastructure = z
  .object({ preparationId: Id, expectedHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type AdmitInfrastructureInput = z.infer<typeof AdmitInfrastructure>;
export const InfrastructureProviderBinding = z
  .object({
    providerId: z.string().min(2).max(64),
    targetId: Id,
    version: z.string().min(1).max(100),
    policyVersion: z.literal("application-runsc-systrap-v1"),
  })
  .strict();

export const InfrastructureObservation = z
  .object({
    source: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/),
    version: z.string().min(1).max(100),
    target: z.enum(["development-controller", "professional-vm"]),
    providerBinding: InfrastructureProviderBinding.nullable(),
    observedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    capacity: InfrastructureCapacity.extend({
      pids: Count.nullable(),
      storageGiB: z.number().int().nonnegative().max(1_000_000_000),
    }),
    hostCapacity: InfrastructureCapacity.extend({
      pids: Count.nullable(),
      storageGiB: z.number().int().nonnegative().max(1_000_000_000),
    }).nullable(),
    filesystem: z
      .object({
        label: z.string().min(1).max(100),
        totalGiB: z.number().nonnegative(),
        availableGiB: z.number().nonnegative(),
      })
      .strict()
      .nullable(),
    platform: z.string().min(1).max(100),
    qualification: z
      .object({
        runtime: z.boolean(),
        systrap: z.boolean(),
        limits: z.boolean(),
        persistentQuota: z.boolean(),
        firewallIpv4: z.boolean(),
        firewallIpv6: z.boolean(),
        artifactVerification: z.boolean(),
      })
      .strict(),
    reasons: z.array(z.string().min(1).max(256)).max(20),
  })
  .strict();
export type InfrastructureObservationInput = z.infer<typeof InfrastructureObservation>;
export const CompiledApplicationManifest = z
  .object({
    policyVersion: z.literal("application-runsc-systrap-v1"),
    allocationId: Id,
    projectId: Id,
    environmentId: Id,
    providerBinding: InfrastructureProviderBinding.nullable(),
    image: ApplicationWorkload.shape.image,
    artifactDigest: ApplicationWorkload.shape.artifactDigest,
    ownership: z.string().regex(/^[a-f0-9]{64}$/),
    names: z
      .object({
        network: z.string().regex(/^gse-[a-f0-9-]{36}-net$/),
        data: z.string().regex(/^gse-[a-f0-9-]{36}-data$/),
        sandbox: z.string().regex(/^gse-[a-f0-9-]{36}-app$/),
      })
      .strict(),
    runtime: z.literal("runsc"),
    platform: z.literal("systrap"),
    user: z.literal("65532:65532"),
    readOnlyRoot: z.literal(true),
    capabilities: z.array(z.never()).max(0),
    noNewPrivileges: z.literal(true),
    seccomp: z.literal("runtime-default"),
    limits: z
      .object({
        cpuMilliCores: ApplicationWorkload.shape.cpuMilliCores,
        memoryMiB: ApplicationWorkload.shape.memoryMiB,
        pids: ApplicationWorkload.shape.pids,
        temporaryMiB: ApplicationWorkload.shape.temporaryMiB,
        dataGiB: ApplicationWorkload.shape.dataGiB,
      })
      .strict(),
    network: z
      .object({
        ipv4Subnet: z.string().max(32),
        ipv6Subnet: z.string().max(64),
        internal: z.literal(true),
        ingress: z.literal("deny"),
        egress: z.literal("deny"),
        hostAccess: z.literal("deny"),
        publishedPorts: z.array(z.never()).max(0),
      })
      .strict(),
    mounts: z
      .object({
        temporary: z.literal("/tmp"),
        persistent: z.literal("/data"),
        quotaRequired: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type CompiledApplicationInput = z.infer<typeof CompiledApplicationManifest>;
export const InfrastructurePreparation = z
  .object({
    id: Id,
    allocationId: Id,
    projectId: Id,
    environmentId: Id,
    hash: z.string(),
    inventoryRevision: z.number().int(),
    observationRevision: z.number().int(),
    policyVersion: z.string(),
    manifest: CompiledApplicationManifest,
    createdAt: z.string().datetime(),
  })
  .strict();
export type InfrastructurePreparationView = z.infer<typeof InfrastructurePreparation>;
export const InfrastructureAllocation = z
  .object({
    id: Id,
    preparationId: Id,
    projectId: Id,
    environmentId: Id,
    runId: Id.nullable(),
    state: z.enum(["reserved", "provisioning", "verified", "unknown", "quarantined", "released"]),
    cleanupState: z.enum(["not_required", "pending", "stopped"]),
    ipv4Subnet: z.string(),
    ipv6Subnet: z.string(),
    reason: z.string().nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const InfrastructureOverview = z
  .object({
    desired: DeclareInventory.nullable(),
    revision: z.number().int(),
    observation: InfrastructureObservation.nullable(),
    observationRevision: z.number().int(),
    observationState: z.enum(["unknown", "observed", "stale"]),
    executionAvailable: z.boolean(),
    executionReasons: z.array(z.string()),
    preparations: z.array(InfrastructurePreparation),
    allocations: z.array(InfrastructureAllocation),
  })
  .strict();
export type InfrastructureOverviewView = z.infer<typeof InfrastructureOverview>;

/** Utilization = (committed + protected reserve) / capacity; thresholds are inclusive lower bounds. */
export const INFRASTRUCTURE_PRESSURE = { warnUtilization: 0.8, criticalUtilization: 0.95 } as const;
/** One heavy task runs at a time; a short bounded wait line absorbs bursts, the rest is refused. */
export const HEAVY_TASK_LIMITS = { maxConcurrent: 1, maxQueued: 4 } as const;
export const HEADROOM_RESOURCES = ["cpu", "memory", "disk", "wal", "pids"] as const;
export const PressureState = z.enum(["ok", "warn", "critical", "unknown"]);
export const HeadroomResource = z
  .object({
    resource: z.enum(HEADROOM_RESOURCES),
    unit: z.enum(["milliCores", "MiB", "GiB", "count"]),
    state: z.enum(["known", "unknown"]),
    capacity: z.number().nullable(),
    committed: z.number(),
    protectedReserve: z.number().nullable(),
    free: z.number().nullable(),
    utilization: z.number().nullable(),
    pressure: PressureState,
    reason: z.string().nullable(),
  })
  .strict();
export const HeadroomScope = z
  .object({
    scope: z.enum(["host", "pool"]),
    name: z.string(),
    pressure: PressureState,
    resources: z.array(HeadroomResource),
  })
  .strict();
export const HeavyQueueStatus = z
  .object({
    maxConcurrent: z.number().int(),
    maxQueued: z.number().int(),
    running: z.number().int(),
    queued: z.number().int(),
    full: z.boolean(),
    reason: z.string().nullable(),
  })
  .strict();
export const AdmissionControl = z
  .object({
    state: z.enum(["open", "paused"]),
    revision: z.number().int(),
    reason: z.string().nullable(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();
export type AdmissionControlView = z.infer<typeof AdmissionControl>;
export const SetAdmission = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    state: z.enum(["open", "paused"]),
    reason: z.string().trim().min(3).max(300).optional(),
  })
  .strict()
  .refine((value) => value.state === "open" || value.reason !== undefined, {
    message: "A pause needs a recorded reason",
    path: ["reason"],
  });
export type SetAdmissionInput = z.infer<typeof SetAdmission>;
export const InfrastructureHeadroom = z
  .object({
    generatedAt: z.string().datetime(),
    observationState: z.enum(["unknown", "observed", "stale"]),
    pressure: PressureState,
    thresholds: z.object({ warn: z.number(), critical: z.number() }).strict(),
    scopes: z.array(HeadroomScope),
    heavyQueue: HeavyQueueStatus,
    admission: AdmissionControl,
  })
  .strict();
export type InfrastructureHeadroomView = z.infer<typeof InfrastructureHeadroom>;
