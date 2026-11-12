import { z } from "zod";

export const APP_API_VERSION = "1.0.0";
export const APP_API_HEADER = "X-Godseye-App-Version";
export const APP_PROJECT_HEADER = "X-Godseye-Project";
export const APP_ENVIRONMENT_HEADER = "X-Godseye-Environment";
export const APP_BASE = "/api/app/v1";
export const ApplicationScope = z.object({ projectId: z.uuid(), environmentId: z.uuid() }).strict();
export type ApplicationScopeInput = z.infer<typeof ApplicationScope>;
export const ApplicationLimits = z
  .object({
    objectBytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024 * 1024)
      .default(16 * 1024 * 1024),
    storageBytes: z
      .number()
      .int()
      .min(1)
      .max(1024 ** 4)
      .default(128 * 1024 * 1024),
    maxFiles: z.number().int().min(1).max(100000).default(1000),
    chunkBytes: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024 * 1024)
      .default(1024 * 1024),
    uploadTtlMs: z.number().int().min(1000).max(86400000).default(3600000),
    downloadTtlMs: z.number().int().min(1000).max(3600000).default(300000),
    eventRetention: z.number().int().min(1).max(10000).default(1000),
    eventBytes: z.number().int().min(64).max(65536).default(8192),
    streamConnections: z.number().int().min(1).max(1000).default(16),
    streamPollMs: z.number().int().min(10).max(30000).default(1000),
    streamLifetimeMs: z.number().int().min(100).max(3600000).default(60000),
    sessionSeconds: z.number().int().min(60).max(2592000).default(86400),
    authAttempts: z.number().int().min(1).max(1000).default(30),
    authWindowMs: z.number().int().min(1000).max(3600000).default(60000),
  })
  .strict();
export type ApplicationLimitsInput = z.input<typeof ApplicationLimits>;
export const InitiateFile = z
  .object({
    name: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (name) =>
          !Array.from(name).some(
            (value) =>
              value.charCodeAt(0) < 32 ||
              value.charCodeAt(0) === 127 ||
              value === "/" ||
              value === "\\",
          ),
      ),
    contentType: z
      .string()
      .max(100)
      .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i),
    size: z.number().int().nonnegative(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type InitiateFileInput = z.infer<typeof InitiateFile>;
export const FileView = z
  .object({
    id: z.uuid(),
    name: z.string(),
    contentType: z.string(),
    size: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    status: z.enum(["uploading", "committed", "deleted"]),
    sha256: z.string().nullable(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export type ApplicationFileView = z.infer<typeof FileView>;
export const EventView = z
  .object({
    id: z.string().regex(/^[0-9]+$/),
    type: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    payload: z.unknown(),
    occurredAt: z.iso.datetime(),
  })
  .strict();
export type ApplicationEventView = z.infer<typeof EventView>;
export interface ApplicationUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}
export interface ApplicationSession {
  user: ApplicationUser;
  session: { id: string; expiresAt: string };
}

export class ApplicationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
