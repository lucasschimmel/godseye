import { randomBytes, randomUUID } from "node:crypto";
import {
  AddProjectDomain,
  type AddProjectDomainInput,
  isPublicHostname,
  MAX_DOMAINS_PER_PROJECT,
  type ProjectDomainListView,
  type ProjectDomainView,
  RemoveProjectDomain,
  type RemoveProjectDomainInput,
  VerifyProjectDomain,
  type VerifyProjectDomainInput,
} from "@godseye/contracts";
import { type DatabaseAccess, type Store, schema } from "@godseye/store";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { DomainError, parseInput } from "./errors.js";
import { assertFresh, foundationState, recordRequest, requestFor } from "./foundation-data.js";
import { appendAudit } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";
import {
  challengeRecordName,
  challengeRecordValue,
  type DomainResolver,
  type DomainRoutePublisher,
  type DomainTarget,
  evaluateChallenge,
  evaluateRouting,
  isApexDomain,
  isPlatformHostname,
} from "./project-domain-policy.js";
import { loadProject } from "./project-lifecycle-view.js";

export type {
  DomainResolver,
  DomainRoutePublisher,
  DomainTarget,
} from "./project-domain-policy.js";

export interface ProjectDomainOptions {
  now: () => Date;
  resolver?: DomainResolver | undefined;
  publisher?: DomainRoutePublisher | undefined;
  target?: DomainTarget | undefined;
  /** Test seam for the challenge token (32 lowercase hex characters). */
  token?: () => string;
}
type Row = typeof schema.projectDomains.$inferSelect;
type Failure = Row["failureCode"];
const FAILURE_MESSAGES: Record<NonNullable<Failure>, string> = {
  DNS_NOT_FOUND: "No DNS record points this name at the platform yet",
  DNS_POINTS_ELSEWHERE: "The name resolves to addresses that do not belong to the platform",
  TXT_NOT_FOUND: "The ownership challenge TXT record was not found",
  TXT_MISMATCH: "The ownership challenge TXT record does not match this binding",
  PUBLISH_FAILED: "The edge route could not be applied; the previous routes were kept",
};
const sqlLock = sql`SELECT id FROM control_lock WHERE id = 1 FOR UPDATE`;
const SERVED = ["verified", "active"] as const;
const iso = (value: Date | null) => value?.toISOString() ?? null;
const conflict = (code: string, message: string): never => {
  throw new DomainError(code, message, 409);
};

/**
 * Custom application domains (Vercel-style): one hostname bound to one project environment, in
 * addition to its platform host. A binding is only served once its DNS ownership is verified; the
 * edge asks {@link ProjectDomainEngine.servable} before requesting any certificate, and the route
 * publisher writes the Caddy blocks for exactly the verified set. Adding and removing need a fresh
 * owner passkey session; verification only reads DNS and is safe to repeat.
 */
export class ProjectDomainEngine {
  private readonly chains = new Map<string, Promise<unknown>>();
  constructor(
    private readonly store: Store,
    private readonly options: ProjectDomainOptions,
  ) {}
  private get fresh() {
    return foundationState(this.store, { now: this.options.now });
  }
  private ready() {
    const { resolver, target } = this.options;
    if (!resolver || !target)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "Custom domains are not configured", 503);
    return { resolver, target };
  }
  private view(row: Row): ProjectDomainView {
    return {
      id: row.id,
      projectId: row.projectId,
      environmentId: row.environmentId,
      hostname: row.hostname,
      state: row.state,
      method: row.method,
      apex: isApexDomain(row.hostname),
      revision: row.revision,
      challenge:
        row.method === "txt"
          ? {
              name: challengeRecordName(row.hostname),
              value: challengeRecordValue(row.challengeToken),
            }
          : null,
      failure: row.failureCode
        ? { code: row.failureCode, message: FAILURE_MESSAGES[row.failureCode] }
        : null,
      lastCheckedAt: iso(row.lastCheckedAt),
      verifiedAt: iso(row.verifiedAt),
      activatedAt: iso(row.activatedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private async row(tx: DatabaseAccess, actor: Actor, projectId: string, domainId: string) {
    await loadProject(tx, actor, projectId);
    const [row] = await tx
      .select()
      .from(schema.projectDomains)
      .where(
        and(eq(schema.projectDomains.id, domainId), eq(schema.projectDomains.projectId, projectId)),
      );
    if (!row) throw new DomainError("NOT_FOUND", "Domain not found", 404);
    return row;
  }

  async list(actor: Actor, projectId: string): Promise<ProjectDomainListView> {
    assertOwner(actor);
    await loadProject(this.store.db, actor, projectId);
    const rows = await this.store.db
      .select()
      .from(schema.projectDomains)
      .where(
        and(
          eq(schema.projectDomains.projectId, projectId),
          ne(schema.projectDomains.state, "removed"),
        ),
      )
      .orderBy(asc(schema.projectDomains.createdAt));
    const { target } = this.options;
    return {
      domains: rows.map((row) => this.view(row)),
      limit: MAX_DOMAINS_PER_PROJECT,
      target: target && this.options.resolver ? { cname: target.cname, ipv4: target.ipv4 } : null,
    };
  }

  /** Edge `ask` guard: true only for a live binding whose ownership was verified. */
  async servable(hostname: string): Promise<boolean> {
    const name = hostname.trim().toLowerCase();
    if (!isPublicHostname(name)) return false;
    const [row] = await this.store.db
      .select({ id: schema.projectDomains.id })
      .from(schema.projectDomains)
      .where(
        and(
          eq(schema.projectDomains.hostname, name),
          inArray(schema.projectDomains.state, [...SERVED]),
        ),
      );
    return Boolean(row);
  }

  async add(actor: Actor, projectId: string, input: AddProjectDomainInput, key: string) {
    assertFresh(actor, this.fresh);
    const data = parseInput(AddProjectDomain, input);
    const { resolver, target } = this.ready();
    if (isPlatformHostname(data.hostname, target.platformDomain))
      throw new DomainError("INVALID_DOMAIN", "Platform hostnames cannot be bound", 422);
    const replay = await this.store.transaction(async (tx) => {
      const request = await requestFor(tx, actor, key, "domain.add", { projectId, data });
      if (!request.existing) return null;
      return this.view(await this.row(tx, actor, projectId, request.existing.resourceId));
    });
    if (replay) return replay;
    // An apex that already resolves somewhere else is refused up front; DNS is read outside the lock.
    if (isApexDomain(data.hostname)) {
      const routing = await evaluateRouting(resolver, data.hostname, target);
      if (routing.status === "elsewhere")
        throw new DomainError(
          "DOMAIN_POINTS_ELSEWHERE",
          "The apex domain already points at another host; point it at the platform first",
          422,
        );
    }
    return this.store.transaction(async (tx) => {
      await tx.execute(sqlLock);
      const request = await requestFor(tx, actor, key, "domain.add", { projectId, data });
      if (request.existing)
        return this.view(await this.row(tx, actor, projectId, request.existing.resourceId));
      const { lifecycle } = await loadProject(tx, actor, projectId);
      if (lifecycle) conflict("INVALID_LIFECYCLE", "The project is not active");
      const [environment] = await tx
        .select()
        .from(schema.environments)
        .where(
          and(
            eq(schema.environments.id, data.environmentId),
            eq(schema.environments.projectId, projectId),
          ),
        );
      if (!environment || environment.kind === "recovery")
        throw new DomainError("NOT_FOUND", "Environment not found", 404);
      const live = await tx
        .select({ id: schema.projectDomains.id, hostname: schema.projectDomains.hostname })
        .from(schema.projectDomains)
        .where(
          and(
            eq(schema.projectDomains.projectId, projectId),
            ne(schema.projectDomains.state, "removed"),
          ),
        );
      if (live.length >= MAX_DOMAINS_PER_PROJECT)
        conflict("DOMAIN_LIMIT", `A project holds at most ${MAX_DOMAINS_PER_PROJECT} domains`);
      const [taken] = await tx
        .select({ id: schema.projectDomains.id })
        .from(schema.projectDomains)
        .where(
          and(
            eq(schema.projectDomains.hostname, data.hostname),
            ne(schema.projectDomains.state, "removed"),
          ),
        );
      if (taken) conflict("DOMAIN_TAKEN", "This hostname is already bound");
      const now = this.options.now();
      const row: Row = {
        id: randomUUID(),
        projectId,
        environmentId: data.environmentId,
        hostname: data.hostname,
        state: "pending_verification",
        method: data.method,
        challengeToken: (this.options.token ?? (() => randomBytes(16).toString("hex")))(),
        revision: 1,
        failureCode: null,
        lastCheckedAt: null,
        verifiedAt: null,
        activatedAt: null,
        removedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(schema.projectDomains).values(row);
      await recordRequest(tx, this.fresh, key, request.digest, row.id, "domain.add");
      await appendAudit(
        tx,
        actor,
        projectId,
        "domain.added",
        `Bound ${row.hostname} to environment ${row.environmentId} (${row.method} verification)`,
      );
      return this.view(row);
    });
  }

  async verify(
    actor: Actor,
    projectId: string,
    domainId: string,
    input: VerifyProjectDomainInput,
    key: string,
  ) {
    assertOwner(actor);
    const data = parseInput(VerifyProjectDomain, input);
    const { resolver, target } = this.ready();
    const kind = "domain.verify";
    const start = await this.store.transaction(async (tx) => {
      const request = await requestFor(tx, actor, key, kind, { projectId, domainId, data });
      const row = await this.row(tx, actor, projectId, domainId);
      if (request.existing) return { replay: this.view(row) };
      if (row.state === "removed") conflict("DOMAIN_REMOVED", "The domain was removed");
      if (row.revision !== data.expectedRevision)
        conflict("REVISION_CONFLICT", "Domain has changed");
      return { row, digest: request.digest };
    });
    if ("replay" in start) return start.replay;
    const outcome = await this.check(resolver, target, start.row);
    const settled = await this.store.transaction(async (tx) => {
      await tx.execute(sqlLock);
      const current = await this.row(tx, actor, projectId, domainId);
      if (current.revision !== data.expectedRevision)
        conflict("REVISION_CONFLICT", "Domain has changed");
      const now = this.options.now();
      const wasServed = current.state === "verified" || current.state === "active";
      const next = outcome.failure
        ? {
            state:
              outcome.pending && !wasServed
                ? ("pending_verification" as const)
                : ("failed" as const),
            failureCode: outcome.failure,
            verifiedAt: wasServed ? null : current.verifiedAt,
            activatedAt: null,
          }
        : {
            state: current.state === "active" ? ("active" as const) : ("verified" as const),
            failureCode: null,
            verifiedAt: current.verifiedAt ?? now,
            activatedAt: current.activatedAt,
          };
      const updated = {
        ...current,
        ...next,
        revision: current.revision + 1,
        lastCheckedAt: now,
        updatedAt: now,
      };
      await tx
        .update(schema.projectDomains)
        .set({ ...next, revision: updated.revision, lastCheckedAt: now, updatedAt: now })
        .where(eq(schema.projectDomains.id, domainId));
      await recordRequest(tx, this.fresh, key, start.digest, domainId, kind);
      await appendAudit(
        tx,
        actor,
        projectId,
        "domain.checked",
        `Checked ${current.hostname}: ${updated.state}${outcome.failure ? ` (${outcome.failure})` : ""}`,
      );
      return { row: updated, wasServed };
    });
    const served = settled.row.state === "verified" || settled.row.state === "active";
    if (!served && !settled.wasServed) return this.view(settled.row);
    return this.reconcile(settled.row, served);
  }

  async remove(
    actor: Actor,
    projectId: string,
    domainId: string,
    input: RemoveProjectDomainInput,
    key: string,
  ) {
    assertFresh(actor, this.fresh);
    const data = parseInput(RemoveProjectDomain, input);
    const kind = "domain.remove";
    const start = await this.store.transaction(async (tx) => {
      const request = await requestFor(tx, actor, key, kind, { projectId, domainId, data });
      const row = await this.row(tx, actor, projectId, domainId);
      if (request.existing) return { replay: this.view(row) };
      if (row.state === "removed") conflict("DOMAIN_REMOVED", "The domain was already removed");
      if (row.revision !== data.expectedRevision)
        conflict("REVISION_CONFLICT", "Domain has changed");
      return { row, digest: request.digest };
    });
    if ("replay" in start) return start.replay;
    // Withdraw the route first: if the edge refuses the change the binding stays as it was.
    if (start.row.state === "verified" || start.row.state === "active")
      await this.republish(start.row.environmentId, start.row.id).catch(() => {
        throw new DomainError(
          "DOMAIN_UNPUBLISH_FAILED",
          "The edge route could not be withdrawn; the domain was not removed",
          502,
        );
      });
    return this.store.transaction(async (tx) => {
      await tx.execute(sqlLock);
      const current = await this.row(tx, actor, projectId, domainId);
      if (current.revision !== data.expectedRevision)
        conflict("REVISION_CONFLICT", "Domain has changed");
      const now = this.options.now();
      const removed: Row = {
        ...current,
        state: "removed",
        revision: current.revision + 1,
        removedAt: now,
        updatedAt: now,
      };
      await tx
        .update(schema.projectDomains)
        .set({
          state: "removed",
          revision: removed.revision,
          removedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.projectDomains.id, domainId));
      await recordRequest(tx, this.fresh, key, start.digest, domainId, kind);
      await appendAudit(tx, actor, projectId, "domain.removed", `Removed ${current.hostname}`);
      return this.view(removed);
    });
  }

  /** Reads DNS only: ownership by method, plus the apex-must-not-point-elsewhere rule. */
  private async check(resolver: DomainResolver, target: DomainTarget, row: Row) {
    const none = (failure: NonNullable<Failure>): { failure: Failure; pending: boolean } => ({
      failure,
      pending: failure === "DNS_NOT_FOUND" || failure === "TXT_NOT_FOUND",
    });
    const routing = await evaluateRouting(resolver, row.hostname, target);
    if (row.method === "txt") {
      const challenge = await evaluateChallenge(resolver, row.hostname, row.challengeToken);
      if (challenge === "none") return none("TXT_NOT_FOUND");
      if (challenge === "mismatch") return none("TXT_MISMATCH");
      if (routing.status === "elsewhere" && isApexDomain(row.hostname))
        return none("DNS_POINTS_ELSEWHERE");
      return { failure: null, pending: false };
    }
    if (routing.status === "none") return none("DNS_NOT_FOUND");
    if (routing.status === "elsewhere") return none("DNS_POINTS_ELSEWHERE");
    return { failure: null, pending: false };
  }

  /** Publishes the served set and promotes verified bindings to active; a failed publish keeps verified. */
  private async reconcile(row: Row, served: boolean): Promise<ProjectDomainView> {
    try {
      await this.republish(row.environmentId);
    } catch {
      if (!served)
        throw new DomainError(
          "DOMAIN_UNPUBLISH_FAILED",
          "The edge route could not be withdrawn; verification state was recorded",
          502,
        );
      return this.view(await this.mark(row.id, { failureCode: "PUBLISH_FAILED" }));
    }
    if (!served || !this.options.publisher) return this.view(row);
    const now = this.options.now();
    return this.view(
      row.state === "active"
        ? row
        : await this.mark(row.id, { state: "active", activatedAt: now, failureCode: null }),
    );
  }
  private async mark(id: string, patch: Partial<Row>) {
    return this.store.transaction(async (tx) => {
      await tx.execute(sqlLock);
      const [current] = await tx
        .select()
        .from(schema.projectDomains)
        .where(eq(schema.projectDomains.id, id));
      if (!current) throw new DomainError("NOT_FOUND", "Domain not found", 404);
      if (current.state === "removed") return current;
      const next = { ...patch, revision: current.revision + 1, updatedAt: this.options.now() };
      await tx.update(schema.projectDomains).set(next).where(eq(schema.projectDomains.id, id));
      return { ...current, ...next };
    });
  }

  /** Serialized per environment: always writes the full verified set read at the time it runs. */
  private republish(environmentId: string, excluding?: string) {
    const previous = this.chains.get(environmentId) ?? Promise.resolve();
    const run = async () => {
      const publisher = this.options.publisher;
      if (!publisher) return;
      const rows = await this.store.db
        .select()
        .from(schema.projectDomains)
        .where(
          and(
            eq(schema.projectDomains.environmentId, environmentId),
            inArray(schema.projectDomains.state, [...SERVED]),
          ),
        )
        .orderBy(asc(schema.projectDomains.hostname));
      const hostnames = rows.filter((row) => row.id !== excluding).map((row) => row.hostname);
      await publisher.publish({ environmentId, hostnames });
    };
    const next = previous.then(run, run);
    this.chains.set(
      environmentId,
      next.catch(() => undefined),
    );
    return next;
  }
}
