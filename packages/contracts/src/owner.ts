import { z } from "zod";

const IdentityId = z.string().min(1).max(128);
const OwnerStatusBase = { configured: z.boolean(), origin: z.string().url().max(2048) };
export const OwnerStatusResponse = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(false), ...OwnerStatusBase }).strict(),
  z
    .object({
      authenticated: z.literal(true),
      ...OwnerStatusBase,
      owner: z.object({ id: IdentityId, name: z.string().min(1).max(100) }).strict(),
      session: z
        .object({
          id: IdentityId,
          createdAt: z.string().datetime(),
          expiresAt: z.string().datetime(),
        })
        .strict(),
    })
    .strict(),
]);
export type OwnerStatusView = z.infer<typeof OwnerStatusResponse>;
export type OwnerAuthenticatedView = Extract<OwnerStatusView, { authenticated: true }>;
export const OwnerSecurityResponse = z
  .object({
    fresh: z.boolean(),
    sessions: z
      .array(
        z
          .object({
            id: IdentityId,
            createdAt: z.string().datetime(),
            expiresAt: z.string().datetime(),
            current: z.boolean(),
          })
          .strict(),
      )
      .max(10000),
    passkeys: z
      .array(
        z
          .object({
            id: IdentityId,
            name: z.string().min(1).max(262144),
            createdAt: z.string().datetime().nullable(),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type OwnerSecurityView = z.infer<typeof OwnerSecurityResponse>;
export const OWNER_SESSION_QUERY = "owner-session";
export const OWNER_AUTH_REQUIRED_EVENT = "godseye-owner-auth-required";
export const OWNER_POLL_MS = 30_000;
