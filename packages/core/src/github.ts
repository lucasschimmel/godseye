import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Store } from "@godseye/store";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { DomainError } from "./errors.js";
import { parseGithubEvent } from "./github-events.js";
import { appendAudit, fingerprint, write } from "./journal.js";

const MAX_DELIVERY_BYTES = 256 * 1024;

export interface GithubDelivery {
  deliveryId: string;
  event: string;
  rawBody: Uint8Array;
  signature: string | undefined;
}
export interface DeliveryResult {
  outcome: "queued" | "ignored" | "duplicate";
  runId?: string;
  runIds?: string[];
}

export function verifyGithubSignature(
  rawBody: Uint8Array,
  signature: string | undefined,
  key: string,
): void {
  if (!key)
    throw new DomainError("CAPABILITY_UNAVAILABLE", "GitHub webhook is not configured", 503);
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    throw new DomainError("INVALID_SIGNATURE", "Webhook signature is invalid", 401);
  }
  const expected = createHmac("sha256", key).update(rawBody).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"))) {
    throw new DomainError("INVALID_SIGNATURE", "Webhook signature is invalid", 401);
  }
}

export async function receiveGithubDelivery(
  store: Store,
  input: GithubDelivery,
  key: string,
): Promise<DeliveryResult> {
  if (input.rawBody.byteLength > MAX_DELIVERY_BYTES)
    throw new DomainError("BODY_TOO_LARGE", "Webhook payload is too large", 413);
  verifyGithubSignature(input.rawBody, input.signature, key);
  if (!/^[A-Za-z0-9-]{8,128}$/.test(input.deliveryId))
    throw new DomainError("INVALID_DELIVERY", "A valid delivery ID is required", 400);
  const digest = fingerprint({
    event: input.event,
    body: Buffer.from(input.rawBody).toString("base64"),
  });
  const source = parseGithubEvent(input.event, input.rawBody);
  return write(store, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.deliveries)
      .where(eq(schema.deliveries.id, input.deliveryId));
    if (existing) {
      if (existing.payloadHash !== digest)
        throw new DomainError(
          "DELIVERY_CONFLICT",
          "Delivery ID was reused with different contents",
          409,
        );
      return { outcome: "duplicate" };
    }
    const rows = await tx.select().from(schema.projects);
    const projects = source
      ? rows.filter(
          ({ repository }) =>
            repository &&
            repository.repositoryId === source.repositoryId &&
            repository.installationId === source.installationId &&
            repository.fullName.toLowerCase() === source.fullName.toLowerCase() &&
            source.trackedBranch === repository.branch,
        )
      : [];
    const outcome = projects.length ? "queued" : "ignored";
    const now = new Date();
    await tx
      .insert(schema.deliveries)
      .values({ id: input.deliveryId, payloadHash: digest, outcome, receivedAt: now });
    if (!projects.length || !source) return { outcome: "ignored" };
    const runIds: string[] = [];
    for (const project of projects) {
      const runId = randomUUID();
      runIds.push(runId);
      await tx.insert(schema.ciRuns).values({
        id: runId,
        projectId: project.id,
        deliveryId: input.deliveryId,
        branch: source.branch,
        commitSha: source.commitSha,
        status: "pending_verification",
        trigger: source.trigger,
        repositorySnapshot: project.repository,
        pullRequestNumber: source.pullRequestNumber,
        eventAction: source.action,
        createdAt: now,
        updatedAt: now,
      });
      await appendAudit(
        tx,
        { id: "github-webhook", kind: "service", projectIds: [project.id] },
        project.id,
        source.trigger === "push" ? "ci.push.received" : "ci.pull-request.received",
        `Received ${source.commitSha.slice(0, 12)}; live source verification is pending`,
      );
    }
    return { outcome: "queued", runId: runIds[0], runIds };
  });
}
