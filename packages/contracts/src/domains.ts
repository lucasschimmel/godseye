import { z } from "zod";

const Id = z.string().uuid();
const Moment = z.string().datetime();
const Revision = z.number().int().nonnegative();

/** Lifecycle of a custom domain bound to one project environment. */
export const DOMAIN_STATES = [
  "pending_verification",
  "verified",
  "active",
  "failed",
  "removed",
] as const;
/** `dns` proves control by pointing the name at the platform; `txt` proves it with a challenge record. */
export const DOMAIN_VERIFICATION_METHODS = ["dns", "txt"] as const;
export const DOMAIN_FAILURE_CODES = [
  "DNS_NOT_FOUND",
  "DNS_POINTS_ELSEWHERE",
  "TXT_NOT_FOUND",
  "TXT_MISMATCH",
  "PUBLISH_FAILED",
] as const;
/** Active (non-removed) custom domains one project may hold. */
export const MAX_DOMAINS_PER_PROJECT = 5;
export const DOMAIN_CHALLENGE_LABEL = "_godseye-challenge";
export const DOMAIN_CHALLENGE_PREFIX = "godseye-verify=";

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const RESERVED_SUFFIXES = [".local", ".localhost", ".internal", ".test", ".invalid", ".example"];

/** Pure syntax check for a public DNS hostname: lowercase, at least two labels, alphabetic TLD, no IP. */
export function isPublicHostname(value: string): boolean {
  if (value.length > 253 || value !== value.toLowerCase()) return false;
  const labels = value.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false;
  const tld = labels[labels.length - 1] ?? "";
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return false;
  return !RESERVED_SUFFIXES.some((suffix) => value.endsWith(suffix));
}
export const CustomHostname = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isPublicHostname, "A public DNS hostname without wildcard, port or path is required");

export const AddProjectDomain = z
  .object({
    environmentId: Id,
    hostname: CustomHostname,
    method: z.enum(DOMAIN_VERIFICATION_METHODS).default("dns"),
  })
  .strict();
export const VerifyProjectDomain = z.object({ expectedRevision: Revision }).strict();
export const RemoveProjectDomain = z.object({ expectedRevision: Revision }).strict();
export const DomainAskQuery = z.object({ domain: z.string().min(1).max(253) }).strict();
export type AddProjectDomainInput = z.input<typeof AddProjectDomain>;
export type VerifyProjectDomainInput = z.infer<typeof VerifyProjectDomain>;
export type RemoveProjectDomainInput = z.infer<typeof RemoveProjectDomain>;

export const ProjectDomain = z
  .object({
    id: Id,
    projectId: Id,
    environmentId: Id,
    hostname: z.string(),
    state: z.enum(DOMAIN_STATES),
    method: z.enum(DOMAIN_VERIFICATION_METHODS),
    apex: z.boolean(),
    revision: Revision,
    /** TXT record to publish for the `txt` method; null for `dns`. */
    challenge: z.object({ name: z.string(), value: z.string() }).strict().nullable(),
    /** Latest verification outcome that is not a success; cleared once verified. */
    failure: z
      .object({ code: z.enum(DOMAIN_FAILURE_CODES), message: z.string().max(200) })
      .strict()
      .nullable(),
    lastCheckedAt: Moment.nullable(),
    verifiedAt: Moment.nullable(),
    activatedAt: Moment.nullable(),
    createdAt: Moment,
    updatedAt: Moment,
  })
  .strict();
export const ProjectDomainList = z
  .object({
    domains: z.array(ProjectDomain),
    limit: z.number().int().positive(),
    /** Records the owner points the name at; null when the platform has no public target configured. */
    target: z
      .object({ cname: z.string(), ipv4: z.array(z.string()) })
      .strict()
      .nullable(),
  })
  .strict();
export const DomainAskResponse = z.object({ allowed: z.literal(true) }).strict();
export type ProjectDomainView = z.infer<typeof ProjectDomain>;
export type ProjectDomainListView = z.infer<typeof ProjectDomainList>;
