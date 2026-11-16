import { createHash, randomUUID } from "node:crypto";
import {
  CreateNotificationChannel,
  type CreateNotificationChannelInput,
  MAX_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_KINDS,
  type NotificationChannelOverviewView,
  type NotificationChannelView,
  RemoveNotificationChannel,
  type RemoveNotificationChannelInput,
  TestNotificationChannel,
  type TestNotificationChannelInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, asc, eq } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { assertFresh, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import type { IncidentNotifier } from "./incidents-state.js";
import { appendAudit, write } from "./journal.js";
import type { SecretSealer } from "./notification-seal.js";
import {
  DEFAULT_SEND_POLICY,
  httpsTransport,
  type SendPolicy,
  type SendResult,
  sendWebhook,
  type WebhookTransport,
} from "./notification-webhook.js";
import { type Actor, assertOwner } from "./policy.js";

export interface NotificationChannelOptions {
  now: () => Date;
  /** Without sealing material channels cannot be stored, and the adapter reports `unavailable`. */
  sealer?: SecretSealer | undefined;
  transport?: WebhookTransport | undefined;
  policy?: Partial<SendPolicy> | undefined;
}
type Row = typeof schema.notificationChannels.$inferSelect;
interface Target {
  url: string;
  secret: string | null;
}
const iso = (value: Date | null) => value?.toISOString() ?? null;

/**
 * Owner notification channels (webhook). The URL, which usually embeds a token, and the optional
 * signing secret are sealed before they reach the database and are never logged, audited or
 * returned. Creating, testing and removing a channel need a fresh owner passkey session.
 * `confirmed` is reported only when the receiver answered 2xx.
 */
export class NotificationChannelEngine {
  private readonly testing = new Set<string>();
  private readonly transport: WebhookTransport;
  private readonly policy: SendPolicy;
  constructor(
    private readonly store: Store,
    private readonly options: NotificationChannelOptions,
  ) {
    this.transport = options.transport ?? httpsTransport();
    this.policy = { ...DEFAULT_SEND_POLICY, ...options.policy };
  }
  private get fresh() {
    return foundationState(this.store, { now: this.options.now });
  }
  private sealer(): SecretSealer {
    if (!this.options.sealer)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        "Notification channels cannot be stored without sealing material",
        503,
      );
    return this.options.sealer;
  }
  private view(row: Row): NotificationChannelView {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      host: row.host,
      signed: row.signed,
      revision: row.revision,
      test: {
        state: row.testState,
        at: iso(row.testAt),
        reason: row.testReason,
        httpStatus: row.testHttpStatus,
        attempts: row.testAttempts,
      },
      delivery: {
        state: row.deliveryState,
        at: iso(row.deliveryAt),
        reason: row.deliveryReason,
        httpStatus: row.deliveryHttpStatus,
        attempts: row.deliveryAttempts,
      },
      createdAt: row.createdAt.toISOString(),
    };
  }
  private async live(db: DatabaseAccess) {
    return db
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.state, "active"))
      .orderBy(asc(schema.notificationChannels.createdAt), asc(schema.notificationChannels.id));
  }
  private async row(db: DatabaseAccess, id: string) {
    const [row] = await db
      .select()
      .from(schema.notificationChannels)
      .where(
        and(
          eq(schema.notificationChannels.id, id),
          eq(schema.notificationChannels.state, "active"),
        ),
      );
    if (!row) throw new DomainError("NOT_FOUND", "Notification channel not found", 404);
    return row;
  }
  private target(row: Row): Target {
    return JSON.parse(this.sealer().open(row.sealedTarget, row.id)) as Target;
  }

  async overview(actor: Actor): Promise<NotificationChannelOverviewView> {
    assertOwner(actor);
    return {
      adapter: this.options.sealer ? "available" : "unavailable",
      kinds: [...NOTIFICATION_CHANNEL_KINDS],
      limit: MAX_NOTIFICATION_CHANNELS,
      channels: (await this.live(this.store.db)).map((row) => this.view(row)),
    };
  }
  /** True when the adapter can seal/open targets and at least one channel is live. */
  async configured(): Promise<boolean> {
    if (!this.options.sealer) return false;
    return (await this.live(this.store.db)).length > 0;
  }

  async create(actor: Actor, input: CreateNotificationChannelInput, key: string) {
    assertFresh(actor, this.fresh);
    const sealer = this.sealer();
    const data = parseInput(CreateNotificationChannel, input);
    const url = new URL(data.url);
    return write(this.store, async (tx) => {
      // The request fingerprint never contains the URL or secret, only a digest of them.
      const secretDigest = createHash("sha256")
        .update(`${data.url}\n${data.signingSecret ?? ""}`)
        .digest("hex");
      const request = await requestFor(tx, actor, key, "notification.channel.create", {
        kind: data.kind,
        label: data.label,
        secretDigest,
      });
      if (request.existing) return this.view(await this.row(tx, request.existing.resourceId));
      const live = await this.live(tx);
      if (live.length >= MAX_NOTIFICATION_CHANNELS)
        throw new DomainError(
          "NOTIFICATION_CHANNEL_LIMIT",
          `At most ${MAX_NOTIFICATION_CHANNELS} notification channels are allowed`,
          409,
        );
      const now = this.options.now();
      const id = randomUUID();
      const target: Target = { url: data.url, secret: data.signingSecret ?? null };
      const row: Row = {
        id,
        kind: data.kind,
        label: data.label,
        host: url.hostname,
        signed: target.secret !== null,
        sealedTarget: sealer.seal(JSON.stringify(target), id),
        state: "active",
        revision: 1,
        testState: "never",
        testAt: null,
        testReason: null,
        testHttpStatus: null,
        testAttempts: 0,
        deliveryState: "never",
        deliveryAt: null,
        deliveryReason: null,
        deliveryHttpStatus: null,
        deliveryAttempts: 0,
        createdAt: now,
        updatedAt: now,
        removedAt: null,
      };
      await tx.insert(schema.notificationChannels).values(row);
      await recordRequest(tx, this.fresh, key, request.digest, id, "notification.channel.create");
      await appendAudit(
        tx,
        actor,
        null,
        "notification.channel.created",
        `Webhook channel ${id} on host ${row.host}`,
      );
      return this.view(row);
    });
  }

  async remove(actor: Actor, id: string, input: RemoveNotificationChannelInput, key: string) {
    assertFresh(actor, this.fresh);
    const data = parseInput(RemoveNotificationChannel, input);
    return write(this.store, async (tx) => {
      const kind = "notification.channel.remove";
      const request = await requestFor(tx, actor, key, kind, { id, data });
      if (request.existing) return this.view(await this.any(tx, id));
      const row = await this.row(tx, id);
      if (row.revision !== data.expectedRevision)
        throw new DomainError("REVISION_CONFLICT", "Notification channel changed", 409);
      const now = this.options.now();
      const next = {
        state: "removed" as const,
        // The sealed target is destroyed with the channel; only the placeholder remains.
        sealedTarget: "removed",
        revision: row.revision + 1,
        removedAt: now,
        updatedAt: now,
      };
      await tx
        .update(schema.notificationChannels)
        .set(next)
        .where(eq(schema.notificationChannels.id, id));
      await recordRequest(tx, this.fresh, key, request.digest, id, kind);
      await appendAudit(tx, actor, null, "notification.channel.removed", `Channel ${id}`);
      return this.view({ ...row, ...next });
    });
  }
  private async any(db: DatabaseAccess, id: string) {
    const [row] = await db
      .select()
      .from(schema.notificationChannels)
      .where(eq(schema.notificationChannels.id, id));
    if (!row) throw new DomainError("NOT_FOUND", "Notification channel not found", 404);
    return row;
  }

  /**
   * Sends one real arrival-test event and stores the honest result. A replay of the same
   * idempotency key returns the stored channel and never sends again.
   */
  async test(actor: Actor, id: string, input: TestNotificationChannelInput, key: string) {
    assertFresh(actor, this.fresh);
    const data = parseInput(TestNotificationChannel, input);
    const kind = "notification.channel.test";
    this.sealer();
    let held = false;
    try {
      const start = await write(this.store, async (tx) => {
        const request = await requestFor(tx, actor, key, kind, { id, data });
        if (request.existing) return { replay: this.view(await this.any(tx, id)) };
        const row = await this.row(tx, id);
        if (row.revision !== data.expectedRevision)
          throw new DomainError("REVISION_CONFLICT", "Notification channel changed", 409);
        if (this.testing.has(id))
          throw new DomainError("NOTIFICATION_TEST_BUSY", "A test is already running", 409);
        await recordRequest(tx, this.fresh, key, request.digest, id, kind);
        this.testing.add(id);
        held = true;
        return { row };
      });
      if ("replay" in start) return start.replay;
      const event = {
        type: "arrival_test",
        channelId: id,
        sentAt: this.options.now().toISOString(),
        note: "Test message from the G.O.D.S.E.Y.E controller. No incident is involved.",
      };
      const result = await this.deliver(start.row, event, `test:${randomUUID()}`);
      return await this.record(actor, id, "test", result);
    } finally {
      if (held) this.testing.delete(id);
    }
  }

  private async deliver(
    row: Row,
    event: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<SendResult> {
    try {
      return await sendWebhook(
        this.transport,
        this.policy,
        this.target(row),
        event,
        idempotencyKey,
        this.options.now,
      );
    } catch {
      // Unsealing or an unexpected transport fault: the send is not proven either way.
      return { state: "failed", reason: "NO_CONFIRMATION", httpStatus: null, attempts: 0 };
    }
  }
  private async record(
    actor: Actor | null,
    id: string,
    purpose: "test" | "delivery",
    result: SendResult,
  ) {
    return write(this.store, async (tx) => {
      const now = this.options.now();
      const columns =
        purpose === "test"
          ? {
              testState: result.state,
              testAt: now,
              testReason: result.reason,
              testHttpStatus: result.httpStatus,
              testAttempts: result.attempts,
            }
          : {
              deliveryState: result.state,
              deliveryAt: now,
              deliveryReason: result.reason,
              deliveryHttpStatus: result.httpStatus,
              deliveryAttempts: result.attempts,
            };
      const [current] = await tx
        .select()
        .from(schema.notificationChannels)
        .where(eq(schema.notificationChannels.id, id));
      if (!current) throw new DomainError("NOT_FOUND", "Notification channel not found", 404);
      // A channel removed while a send was in flight keeps its removal; the result is dropped.
      if (current.state !== "active") return this.view(current);
      await tx
        .update(schema.notificationChannels)
        .set({ ...columns, updatedAt: now })
        .where(eq(schema.notificationChannels.id, id));
      if (actor)
        await appendAudit(
          tx,
          actor,
          null,
          `notification.channel.${purpose}`,
          `Channel ${id}: ${result.state}${result.reason ? ` (${result.reason})` : ""}`,
        );
      return this.view({ ...current, ...columns, updatedAt: now });
    });
  }

  /** The `IncidentNotifier` the incident outbox calls: fans one incident out to every live channel. */
  notifier(): IncidentNotifier {
    return {
      configured: () => this.configured(),
      notify: async (incident, context) => {
        const rows = await this.live(this.store.db);
        if (!rows.length || !this.options.sealer)
          return { state: "failed", receipt: "no-live-channel" };
        const key = context?.idempotencyKey ?? `incident:${incident.id}`;
        const event = {
          type: "incident",
          id: incident.id,
          kind: incident.kind,
          severity: incident.severity,
          state: incident.state,
          subject: incident.subject,
          projectId: incident.projectId,
          environmentId: incident.environmentId,
          reason: incident.reason,
          summary: incident.summary,
          occurrences: incident.occurrences,
          raisedAt: incident.lastRaisedAt,
        };
        const results = await Promise.all(
          rows.map(async (row) => {
            const result = await this.deliver(row, event, key);
            await this.record(null, row.id, "delivery", result).catch(() => undefined);
            return result;
          }),
        );
        const confirmed = results.filter((result) => result.state === "confirmed").length;
        const state = confirmed
          ? "notified"
          : results.some((result) => result.state === "unknown")
            ? "unknown"
            : "failed";
        return { state, receipt: `confirmed:${confirmed}/${results.length}` };
      },
    };
  }
}
