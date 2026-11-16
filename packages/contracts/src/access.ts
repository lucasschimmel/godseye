import { z } from "zod";

export const ACCESS_PURPOSES = ["runtime", "migration", "deploy", "backup"] as const;
export const AccessPurpose = z.enum(ACCESS_PURPOSES);
const Id = z.string().uuid();
const Name = z.string().trim().min(1).max(80);
const IdentityFields = {
  projectId: Id,
  environmentId: Id,
  name: Name,
  expiresAt: z.iso.datetime().optional(),
};
const Worker = z.string().min(1).max(128);
export const CreateServiceIdentity = z.discriminatedUnion("purpose", [
  z
    .object({ ...IdentityFields, purpose: z.literal("runtime"), workerId: z.never().optional() })
    .strict(),
  z.object({ ...IdentityFields, purpose: z.literal("migration"), workerId: Worker }).strict(),
  z.object({ ...IdentityFields, purpose: z.literal("deploy"), workerId: Worker }).strict(),
  z.object({ ...IdentityFields, purpose: z.literal("backup"), workerId: Worker }).strict(),
]);
export type CreateServiceIdentityInput = z.infer<typeof CreateServiceIdentity>;
export const CreateAccessSlot = z.object({ identityId: Id, name: Name }).strict();
export type CreateAccessSlotInput = z.infer<typeof CreateAccessSlot>;
export const AccessRevision = z.object({ expectedRevision: z.number().int().positive() }).strict();
export const ActivateAccessSlot = AccessRevision.extend({
  adapterId: z.string().min(1).max(80),
}).strict();
export const ServiceIdentityView = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    purpose: AccessPurpose,
    name: Name,
    workerId: z.string().max(128).nullable(),
    epoch: z.number().int().positive(),
    revision: z.number().int().positive(),
    status: z.enum(["active", "revoked"]),
    proofIssued: z.boolean(),
    expiresAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    upstreamRevocation: z.enum(["not_required", "pending"]),
  })
  .strict();
export type ServiceIdentity = z.infer<typeof ServiceIdentityView>;
export const AccessSlotView = z
  .object({
    id: Id,
    identityId: Id,
    name: Name,
    revision: z.number().int().positive(),
    activeVersion: z.number().int().positive().nullable(),
    stagedVersion: z.number().int().positive().nullable(),
    state: z.enum(["empty", "staged", "active", "unknown"]),
  })
  .strict();
export type AccessSlot = z.infer<typeof AccessSlotView>;
export const AccessOperationView = z
  .object({
    id: Id,
    slotId: Id,
    kind: z.enum(["stage", "activate"]),
    state: z.enum(["pending", "unknown", "succeeded", "failed"]),
    candidateVersion: z.number().int().positive(),
    previousVersion: z.number().int().positive().nullable(),
    adapterId: z.string().max(80).nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type AccessOperation = z.infer<typeof AccessOperationView>;
export const AccessHealth = z
  .object({
    state: z.enum([
      "unconfigured",
      "ready",
      "sealed",
      "uninitialized",
      "unauthorized",
      "unavailable",
      "invalid",
    ]),
  })
  .strict();
export type AccessHealthView = z.infer<typeof AccessHealth>;
export const AccessOverview = z
  .object({
    provider: AccessHealth,
    identities: z.array(ServiceIdentityView).max(1000),
    slots: z.array(AccessSlotView).max(2000),
    operations: z.array(AccessOperationView).max(2000),
    adapters: z.array(z.object({ id: z.string().max(80) }).strict()).max(100),
  })
  .strict();
export type AccessOverviewView = z.infer<typeof AccessOverview>;
