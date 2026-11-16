import { z } from "zod";

const Origin = z
  .string()
  .max(512)
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      url.origin === value &&
      !url.hostname.includes("*") &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  }, "An exact HTTPS origin or loopback HTTP origin is required");
export const BackendConfiguration = z
  .object({
    enabled: z.boolean(),
    registrationEnabled: z.boolean(),
    allowedOrigins: z
      .array(Origin)
      .min(1)
      .max(8)
      .refine((items) => new Set(items).size === items.length),
    maxFileMiB: z.number().int().min(1).max(1024),
    storageMiB: z.number().int().min(1).max(1048576),
    maxFiles: z.number().int().min(1).max(100000),
    eventRetention: z.number().int().min(10).max(10000),
  })
  .strict()
  .refine((value) => value.maxFileMiB <= value.storageMiB, "File limit exceeds total quota");
export const ConfigureBackend = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    expectedProjectRevision: z.number().int().nonnegative(),
    expectedEnvironmentRevision: z.number().int().nonnegative(),
    configuration: BackendConfiguration,
  })
  .strict();
export const BackendConfigurationView = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    configuration: BackendConfiguration.nullable(),
    state: z.enum(["unconfigured", "prepared", "disabled", "held", "stale"]),
    runtimeConnected: z.literal(false),
    reasons: z.array(z.string().max(512)).max(16),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();
export type BackendConfigurationInput = z.infer<typeof BackendConfiguration>;
export type ConfigureBackendInput = z.infer<typeof ConfigureBackend>;
export type BackendConfigurationDTO = z.infer<typeof BackendConfigurationView>;
