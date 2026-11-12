import { randomUUID } from "node:crypto";
import { ApplicationJobEnvelope } from "@godseye/contracts";
import {
  type ApplicationEventAuthority,
  applicationLifecycleGuard,
  fingerprint,
  type InfrastructureEngine,
  type JobHandlerContext,
  type OutboxDelivery,
} from "@godseye/core";
import { type Store, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { LocalInngestCell } from "../../control-api/src/inngest-config.js";
import type { WorkerChild } from "./child.js";
import { RpcError } from "./ipc.js";

const OutboxRequest = z
  .object({
    attemptKey: z.string().max(160),
    intent: z
      .object({
        effectKey: z.string().min(8).max(128),
        destination: z.string().max(64),
        payload: z.record(z.string(), z.json()),
      })
      .strict(),
  })
  .strict();
export function createCellBroker(
  store: Store,
  cell: LocalInngestCell,
  configurationRevision: number,
  admission: () => boolean = () => true,
) {
  const lifecycle = applicationLifecycleGuard(store, {
    projectId: cell.projectId,
    environmentId: cell.environmentId,
    configurationRevision,
  });
  const active = new Map<string, JobHandlerContext>();
  const authorized = new Set<string>();
  const probes = new Set<string>();
  const outboxCalls = new Map<
    string,
    { delivery: OutboxDelivery; inspect: boolean; signal?: AbortSignal; authorized: boolean }
  >();
  let infrastructure: InfrastructureEngine | undefined, worker: WorkerChild | undefined;
  const authority = (): ApplicationEventAuthority => {
    if (!worker) throw new RpcError("NOT_READY");
    return {
      projectId: cell.projectId,
      environmentId: cell.environmentId,
      producerId: worker.producerId,
    };
  };
  return {
    bind(engine: InfrastructureEngine, child: WorkerChild) {
      infrastructure = engine;
      worker = child;
    },
    async onRequest(method: string, payload: unknown) {
      if (!admission()) throw new RpcError("FENCED");
      if (method === "lifecycle") {
        z.null().parse(payload);
        const current = await lifecycle();
        if (!admission()) throw new RpcError("FENCED");
        return current;
      }
      if (!infrastructure || !worker) throw new RpcError("NOT_READY");
      const jobs = infrastructure.jobs;
      if (["ingest", "runs", "accepted", "settled"].includes(method)) {
        const envelope = ApplicationJobEnvelope.parse(payload),
          scope = authority();
        if (
          envelope.projectId !== scope.projectId ||
          envelope.environmentId !== scope.environmentId ||
          envelope.producerId !== scope.producerId
        )
          throw new RpcError("FORBIDDEN");
        if (method === "ingest") {
          if (!(await lifecycle()).available || !admission()) throw new RpcError("FENCED");
          return jobs.ingestApplicationEvent(scope, envelope);
        }
        if (method === "runs") return jobs.applicationEventRuns(scope, envelope);
        if (method === "accepted") return jobs.applicationEventAccepted(scope, envelope);
        return jobs.applicationEventSettled(scope, envelope);
      }
      if (method === "cron") {
        const input = z
          .object({
            definitionId: z.string().uuid(),
            hash: z.string().regex(/^[a-f0-9]{64}$/),
            eventId: z.string().max(120),
          })
          .strict()
          .parse(payload);
        if (!(await lifecycle()).available || !admission()) throw new RpcError("FENCED");
        return jobs.triggerInngestCron(authority(), input.definitionId, input.hash, input.eventId);
      }
      if (method === "outbox") {
        const input = OutboxRequest.parse(payload),
          context = active.get(input.attemptKey);
        if (!context || context.signal.aborted || !(await lifecycle()).available)
          throw new RpcError("FENCED");
        await context.assertActive();
        if (!admission() || context.signal.aborted) throw new RpcError("FENCED");
        return context.outbox(input.intent);
      }
      if (
        method === "authorize-execution" ||
        method === "check-execution" ||
        method === "check-reconciliation"
      ) {
        const key = z.string().max(160).parse(payload),
          context = active.get(key);
        if (
          !context ||
          (method === "authorize-execution" && authorized.has(key)) ||
          context.signal.aborted ||
          !(await lifecycle()).available
        )
          throw new RpcError("FENCED");
        if (
          method === "check-reconciliation" ||
          (method === "authorize-execution" && probes.has(key))
        ) {
          if (!probes.has(key)) throw new RpcError("FENCED");
          await context.assertReconciliation();
        } else await context.assertActive();
        if (!admission() || context.signal.aborted) throw new RpcError("FENCED");
        if (method === "authorize-execution") authorized.add(key);
        return null;
      }
      if (method === "authorize-outbox") {
        const call = outboxCalls.get(z.string().uuid().parse(payload));
        if (!call || call.authorized || call.signal?.aborted) throw new RpcError("FENCED");
        const [row] = await store.db
          .select()
          .from(schema.jobOutbox)
          .where(
            and(
              eq(schema.jobOutbox.environmentId, cell.environmentId),
              eq(schema.jobOutbox.effectKey, call.delivery.effectKey),
            ),
          );
        if (
          !row ||
          row.projectId !== cell.projectId ||
          row.destination !== call.delivery.destination ||
          row.attempts !== call.delivery.attempt ||
          row.payloadHash !==
            fingerprint({
              destination: call.delivery.destination,
              payload: call.delivery.payload,
            }) ||
          (!call.inspect && row.state !== "dispatching") ||
          !(await lifecycle()).available ||
          !admission() ||
          call.signal?.aborted
        )
          throw new RpcError("FENCED");
        call.authorized = true;
        return null;
      }
      throw new RpcError("METHOD_NOT_ALLOWED");
    },
    async execute(context: JobHandlerContext, reconcile = false) {
      if (
        !admission() ||
        !worker ||
        !infrastructure ||
        context.projectId !== cell.projectId ||
        context.environmentId !== cell.environmentId ||
        active.has(context.attemptKey) ||
        active.size >= 16
      )
        throw new RpcError("FORBIDDEN");
      if (!(await lifecycle()).available || context.signal.aborted || !admission())
        throw new RpcError("FENCED");
      if (reconcile) await context.assertReconciliation();
      else await context.assertActive();
      if (!admission() || context.signal.aborted) throw new RpcError("FENCED");
      active.set(context.attemptKey, context);
      if (reconcile) probes.add(context.attemptKey);
      const child = worker;
      const stop = () => {
        void child.peer.request("abort", context.attemptKey).catch(() => undefined);
      };
      context.signal.addEventListener("abort", stop, { once: true });
      try {
        const {
          signal: _signal,
          outbox: _outbox,
          assertActive: _assertActive,
          assertReconciliation: _assertReconciliation,
          event,
          ...wire
        } = context;
        const result = await child.peer.request("execute", {
          ...wire,
          ...(event ? { event } : {}),
          reconcile,
        });
        return z
          .object({
            status: z.enum(["succeeded", "failed", "unknown"]),
            evidenceRef: z.string().min(1).max(160).optional(),
          })
          .strict()
          .parse(result);
      } finally {
        context.signal.removeEventListener("abort", stop);
        active.delete(context.attemptKey);
        authorized.delete(context.attemptKey);
        probes.delete(context.attemptKey);
      }
    },
    async outbox(delivery: OutboxDelivery, inspect: boolean, signal?: AbortSignal) {
      if (
        !admission() ||
        !worker ||
        delivery.projectId !== cell.projectId ||
        delivery.environmentId !== cell.environmentId ||
        outboxCalls.size >= 16 ||
        signal?.aborted
      )
        throw new RpcError("FENCED");
      if (!(await lifecycle()).available || !admission() || signal?.aborted)
        throw new RpcError("FENCED");
      const callId = randomUUID(),
        child = worker;
      outboxCalls.set(callId, { delivery, inspect, signal, authorized: false });
      const stop = () => {
        void child.peer.request("abort", `outbox:${callId}`).catch(() => undefined);
      };
      signal?.addEventListener("abort", stop, { once: true });
      try {
        return await child.peer.request("deliver-outbox", { callId, delivery, inspect });
      } finally {
        signal?.removeEventListener("abort", stop);
        outboxCalls.delete(callId);
      }
    },
  };
}
