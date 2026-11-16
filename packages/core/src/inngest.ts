import { randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import {
  APPLICATION_JOB_EVENT,
  ApplicationJobEnvelope,
  type ApplicationJobEnvelopeInput,
  type JobDefinitionView,
} from "@godseye/contracts";
import { Hono } from "hono";
import { Inngest, NonRetriableError } from "inngest";
import { serve } from "inngest/hono";
import { DomainError } from "./errors.js";
import type { JobEngine } from "./jobs.js";
import type { ApplicationEventAuthority } from "./jobs-application.js";

export interface InngestCellOptions {
  id: string;
  authority: ApplicationEventAuthority;
  jobs: Pick<
    JobEngine,
    | "ingestApplicationEvent"
    | "applicationEventRuns"
    | "applicationEventAccepted"
    | "applicationEventSettled"
    | "triggerInngestCron"
  >;
  baseUrl: string;
  sdkUrl: string;
  eventKey: string;
  signingKey: string;
  pollIntervalMs?: number;
  maxObservations?: number;
  cronDefinitions?: JobDefinitionView[];
}
function localUrl(raw: string) {
  const url = new URL(raw);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Local Inngest requires an exact loopback HTTP endpoint");
  return url;
}
function assertEnvelope(authority: ApplicationEventAuthority, raw: unknown) {
  const envelope = ApplicationJobEnvelope.parse(raw);
  if (
    envelope.projectId !== authority.projectId ||
    envelope.environmentId !== authority.environmentId ||
    envelope.producerId !== authority.producerId
  )
    throw new NonRetriableError("Application producer does not belong to this worker cell");
  return envelope;
}
/** One authenticated SDK endpoint and private engine per cell. Foundation alone executes effects. */
export function createInngestCell(options: InngestCellOptions) {
  const authority = Object.freeze(structuredClone(options.authority));
  const endpoint = localUrl(options.baseUrl),
    sdk = localUrl(options.sdkUrl);
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const observations = options.maxObservations ?? 300;
  if (
    !/^[a-z][a-z0-9-]{0,100}$/.test(options.id) ||
    options.eventKey.length < 32 ||
    !/^(?:[a-f0-9]{2}){16,}$/.test(options.signingKey) ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    !Number.isSafeInteger(observations) ||
    observations < 1 ||
    observations > 400
  )
    throw new Error("Invalid private Inngest cell configuration");
  const client = new Inngest({
    id: options.id,
    baseUrl: endpoint.origin,
    eventKey: options.eventKey,
    signingKey: options.signingKey,
    isDev: false,
  });
  const application = client.createFunction(
    {
      id: "application-events",
      triggers: { event: APPLICATION_JOB_EVENT },
      retries: 3,
      timeouts: { finish: "24h" },
    },
    async ({ event, step }) => {
      const envelope = assertEnvelope(authority, event.data);
      await step.run("accept-application-event", async () => {
        try {
          return await options.jobs.ingestApplicationEvent(authority, envelope);
        } catch (error) {
          if (
            error instanceof DomainError &&
            ["FORBIDDEN", "FENCED", "IDEMPOTENCY_CONFLICT"].includes(error.code)
          )
            throw new NonRetriableError(error.code);
          throw error;
        }
      });
      for (let index = 0; index < observations; index++) {
        const runs = await step.run(`observe-jobs-${index}`, () =>
          options.jobs.applicationEventRuns(authority, envelope),
        );
        if (runs.some((run) => ["unknown", "reconciling"].includes(run.state)))
          return { state: "requires_reconciliation", runs };
        if (runs.every((run) => ["succeeded", "failed", "cancelled"].includes(run.state)))
          return {
            state: runs.some((run) => run.state !== "succeeded") ? "unsuccessful" : "completed",
            runs,
          };
        await step.sleep(`await-jobs-${index}`, `${pollIntervalMs}ms`);
      }
      throw new NonRetriableError("Foundation jobs are still pending; no completion is claimed");
    },
  );
  const cronFunctions = (options.cronDefinitions ?? []).map((definition) => {
    if (
      definition.projectId !== authority.projectId ||
      definition.environmentId !== authority.environmentId ||
      definition.trigger.kind !== "cron"
    )
      throw new Error("Cron definition belongs to another cell or is not a cron");
    const cron = definition.trigger.cron;
    return client.createFunction(
      { id: `cron-${definition.id}`, triggers: { cron }, retries: 0 },
      async ({ event, step }) =>
        step.run("schedule-foundation-job", () =>
          options.jobs.triggerInngestCron(
            authority,
            definition.id,
            definition.hash,
            event.id ?? "",
          ),
        ),
    );
  });
  const functions = [application, ...cronFunctions];
  const app = new Hono();
  app.use("*", async (context, next) => {
    const requestUrl = new URL(context.req.url);
    // The native engine normalizes loopback callback hosts to localhost. Retain the exact port
    // boundary and SDK signature verification rather than rejecting its legitimate alias.
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname) ||
      requestUrl.port !== sdk.port
    )
      return context.json({ error: "Invalid worker host" }, 403);
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.on(
    ["GET", "POST", "PUT"],
    sdk.pathname,
    serve({ client, functions, serveOrigin: sdk.origin, servePath: sdk.pathname }),
  );
  return {
    app,
    client,
    functions,
    transport: {
      async settled(raw: ApplicationJobEnvelopeInput, signal: AbortSignal) {
        if (signal.aborted) return false;
        return options.jobs.applicationEventSettled(authority, assertEnvelope(authority, raw));
      },
      async send(raw: ApplicationJobEnvelopeInput, signal: AbortSignal) {
        const envelope = assertEnvelope(authority, raw);
        if (signal.aborted) throw new Error("Application event dispatch aborted");
        if (await options.jobs.applicationEventAccepted(authority, envelope)) return;
        // Explicit request abort prevents a stalled engine from retaining an unbounded HTTP transfer.
        const response = await fetch(
          new URL(`/e/${encodeURIComponent(options.eventKey)}`, endpoint),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            // New transport delivery identity permits safe redrive after SDK retry exhaustion.
            // The immutable domain id remains envelope.id and is deduplicated without a 24-hour expiry.
            body: JSON.stringify({ id: randomUUID(), name: APPLICATION_JOB_EVENT, data: envelope }),
            redirect: "error",
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Inngest did not durably accept the application event");
        }
        const result: unknown = await response.json();
        if (
          !result ||
          typeof result !== "object" ||
          !("ids" in result) ||
          !Array.isArray(result.ids) ||
          !result.ids.length
        )
          throw new Error("Inngest returned an invalid event acceptance");
        while (!(await options.jobs.applicationEventAccepted(authority, envelope)))
          await wait(pollIntervalMs, undefined, { signal });
      },
    },
  };
}
