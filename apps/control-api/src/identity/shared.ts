import { createHash } from "node:crypto";
import type { Actor } from "@godseye/core";
import type { Store } from "@godseye/store";
import { APIError } from "better-auth/api";

export const OWNER_DEFAULTS = {
  sessionSeconds: 8 * 60 * 60,
  freshMs: 5 * 60_000,
  enrollmentMs: 10 * 60_000,
  rateWindowMs: 60_000,
  attempts: 60,
  proofMs: 30_000,
  authPath: "/api/auth",
} as const;
export const ticketIdentifier = (ticket: string) =>
  `owner-enrollment:${createHash("sha256").update(ticket).digest("hex")}`;
export interface IdentityOptions {
  origin: string;
  signingKey: string;
  now?: () => Date;
}
export interface OwnerStatus {
  authenticated: boolean;
  configured: boolean;
  origin: string;
  owner?: { id: string; name: string };
  session?: { id: string; createdAt: string; expiresAt: string };
}
export interface IdentityState {
  store: Store;
  ownerId: string;
  options: IdentityOptions;
  now: () => Date;
}

export function requireFresh(actor: Actor | null, now: Date) {
  const authenticatedAt = Date.parse(actor?.authenticatedAt ?? "");
  const age = now.getTime() - authenticatedAt;
  if (!actor || !Number.isFinite(age) || age < 0 || age > OWNER_DEFAULTS.freshMs) {
    throw new APIError("FORBIDDEN", {
      message: "A recent owner passkey authentication is required",
    });
  }
}

/** All identity requests, including recovery, use one serial authority lane. */
export function serialLane() {
  let tail: Promise<unknown> = Promise.resolve();
  return async <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work, work);
    tail = result.catch(() => undefined);
    return result;
  };
}
