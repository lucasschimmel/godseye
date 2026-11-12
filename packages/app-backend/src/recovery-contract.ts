import { z } from "zod";
import { ApplicationLimits, ApplicationScope } from "./contracts.js";

const DateValue = z.iso.datetime().transform((value) => new Date(value));
const Id = z.string().min(1).max(100);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ApplicationRecoveryEnvelope = z
  .object({ payload: z.string(), signature: Hash })
  .strict();
export const ApplicationRecoveryArchive = z
  .object({
    version: z.literal(1),
    scope: ApplicationScope,
    capturedAt: z.iso.datetime(),
    timeCoverage: z
      .object({
        databaseCapturedAt: z.iso.datetime(),
        configurationCapturedAt: z.iso.datetime(),
        fileCopyStartedAt: z.iso.datetime(),
        fileCopyCompletedAt: z.iso.datetime(),
        clockDomain: z.literal("local-runtime"),
        postgresRecoveryPointAt: z.null(),
        gapAssessment: z.literal("external-recovery-point-unknown"),
        activationAllowed: z.literal(false),
      })
      .strict(),
    configuration: z
      .object({
        baseUrl: z.url(),
        trustedOrigins: z.array(z.url()).max(32),
        registrationEnabled: z.boolean(),
        limits: ApplicationLimits,
      })
      .strict(),
    users: z
      .array(
        z
          .object({
            id: Id,
            name: z.string().max(100),
            email: z.email().max(254),
            emailVerified: z.boolean(),
            image: z.string().nullable(),
            createdAt: DateValue,
            updatedAt: DateValue,
          })
          .strict(),
      )
      .max(100000),
    accounts: z
      .array(
        z
          .object({
            id: Id,
            userId: Id,
            accountId: z.string().max(256),
            providerId: z.string().max(100),
            accessToken: z.null(),
            refreshToken: z.null(),
            idToken: z.null(),
            password: z.string().max(4096).nullable(),
            scope: z.string().max(4096).nullable(),
            accessTokenExpiresAt: DateValue.nullable(),
            refreshTokenExpiresAt: DateValue.nullable(),
            createdAt: DateValue,
            updatedAt: DateValue,
          })
          .strict(),
      )
      .max(200000),
    files: z
      .array(
        z
          .object({
            id: z.uuid(),
            userId: Id,
            name: z.string().min(1).max(200),
            contentType: z.string().max(100),
            size: z.number().int().nonnegative(),
            offset: z.number().int().nonnegative(),
            revision: z.number().int().nonnegative(),
            status: z.literal("committed"),
            expectedHash: Hash.nullable(),
            sha256: Hash,
            pendingOffset: z.null(),
            pendingHash: z.null(),
            cleanupPending: z.literal(false),
            createdAt: DateValue,
            expiresAt: DateValue,
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();
export const RECOVERY_METADATA_BYTES = 32 * 1024 * 1024;
