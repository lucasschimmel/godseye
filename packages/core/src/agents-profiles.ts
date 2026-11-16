import { randomUUID } from "node:crypto";
import {
  AGENT_DEFAULTS,
  ChangeAgentProfile,
  ConfigureAgentProfile,
  CreateAgentProfile,
} from "@godseye/contracts";
import { type DatabaseAccess, schema } from "@godseye/store";
import { and, eq } from "drizzle-orm";
import {
  type AgentState,
  activeScope,
  assertNotBusy,
  profileFor,
  profileHash,
  profileView,
  skill,
} from "./agents-state.js";
import { validateProfileToolPolicy } from "./agents-tools-policy.js";
import { DomainError, parseInput } from "./errors.js";
import { recordRequest, requestFor } from "./foundation-data.js";
import { appendAudit, write } from "./journal.js";
import { type Actor, assertOwner } from "./policy.js";

async function scopeRevisions(
  state: AgentState,
  tx: DatabaseAccess,
  actor: Actor,
  input: {
    projectId: string;
    environmentId: string;
    expectedProjectRevision: number;
    expectedEnvironmentRevision: number;
  },
) {
  const scope = await activeScope(state, tx, actor, input.projectId, input.environmentId);
  if (
    scope.project.revision !== input.expectedProjectRevision ||
    scope.environment.revision !== input.expectedEnvironmentRevision
  )
    throw new DomainError("REVISION_CONFLICT", "Project or environment changed", 409);
  return scope;
}
export async function createAgentProfile(
  state: AgentState,
  actor: Actor,
  raw: unknown,
  key: string,
) {
  assertOwner(actor);
  const input = parseInput(CreateAgentProfile, raw);
  if (input.toolPolicy) state.foundation.assertFreshOwner(actor);
  validateProfileToolPolicy(input.limits, input.toolPolicy ?? null);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "agent.profile.create", input);
    if (receipt.existing)
      return profileView(state, await profileFor(tx, receipt.existing.resourceId));
    await scopeRevisions(state, tx, actor, input);
    const rows = await tx
      .select({ id: schema.agentProfiles.id })
      .from(schema.agentProfiles)
      .limit(AGENT_DEFAULTS.maxProfiles);
    if (rows.length >= AGENT_DEFAULTS.maxProfiles)
      throw new DomainError("AGENT_PROFILE_LIMIT", "Agent profile capacity exceeded", 409);
    const [duplicate] = await tx
      .select()
      .from(schema.agentProfiles)
      .where(
        and(
          eq(schema.agentProfiles.projectId, input.projectId),
          eq(schema.agentProfiles.environmentId, input.environmentId),
          eq(schema.agentProfiles.role, input.role),
        ),
      );
    if (duplicate)
      throw new DomainError("AGENT_PROFILE_EXISTS", "This environment already has this role", 409);
    const profile = {
      id: randomUUID(),
      projectId: input.projectId,
      environmentId: input.environmentId,
      role: input.role,
      model: input.model,
      limits: input.limits,
      toolPolicy: input.toolPolicy ?? null,
      revision: 0,
      projectRevision: input.expectedProjectRevision,
      environmentRevision: input.expectedEnvironmentRevision,
      skill,
      skillRef: randomUUID(),
      grantRef: randomUUID(),
      hash: "",
      paused: false,
      createdAt: state.now(),
      updatedAt: state.now(),
    };
    profile.hash = profileHash(profile, profile.toolPolicy);
    await tx.insert(schema.agentProfiles).values(profile);
    await tx.insert(schema.resources).values([
      {
        id: profile.id,
        projectId: profile.projectId,
        environmentId: profile.environmentId,
        kind: "profile",
        name: "Hermes profile",
        createdAt: state.now(),
      },
      {
        id: profile.skillRef,
        projectId: profile.projectId,
        environmentId: profile.environmentId,
        kind: "skill-version",
        name: "Pinned Hermes context skill",
        createdAt: state.now(),
      },
      {
        id: profile.grantRef,
        projectId: profile.projectId,
        environmentId: profile.environmentId,
        kind: "grant",
        name: profile.toolPolicy ? "Bounded Hermes task policy" : "Bounded no-tools model policy",
        createdAt: state.now(),
      },
    ]);
    await recordRequest(tx, state.request, key, receipt.digest, profile.id, "agent.profile.create");
    await appendAudit(
      tx,
      actor,
      profile.projectId,
      "agent.profile.created",
      `Bound Hermes profile ${profile.id} to environment ${profile.environmentId}`,
    );
    return profileView(state, profile);
  });
}
export async function configureAgentProfile(
  state: AgentState,
  actor: Actor,
  id: string,
  raw: unknown,
  key: string,
) {
  assertOwner(actor);
  const input = parseInput(ConfigureAgentProfile, raw);
  return write(state.store, async (tx) => {
    const receipt = await requestFor(tx, actor, key, "agent.profile.configure", { id, ...input });
    const row = await profileFor(tx, id);
    if (receipt.existing) return profileView(state, row);
    const toolPolicy = input.toolPolicy === undefined ? row.toolPolicy : input.toolPolicy;
    validateProfileToolPolicy(input.limits, toolPolicy);
    if (
      toolPolicy &&
      (JSON.stringify(toolPolicy) !== JSON.stringify(row.toolPolicy) ||
        input.limits.maxRequests > row.limits.maxRequests ||
        input.limits.maxTurns > row.limits.maxTurns)
    )
      state.foundation.assertFreshOwner(actor);
    if (row.revision !== input.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Agent profile changed", 409);
    await assertNotBusy(tx, id);
    await scopeRevisions(state, tx, actor, {
      projectId: row.projectId,
      environmentId: row.environmentId,
      ...input,
    });
    const next = {
      ...row,
      model: input.model,
      limits: input.limits,
      toolPolicy,
      projectRevision: input.expectedProjectRevision,
      environmentRevision: input.expectedEnvironmentRevision,
      revision: row.revision + 1,
      skill,
      updatedAt: state.now(),
    };
    next.hash = profileHash(next, next.toolPolicy);
    await tx.update(schema.agentProfiles).set(next).where(eq(schema.agentProfiles.id, id));
    await recordRequest(tx, state.request, key, receipt.digest, id, "agent.profile.configure");
    await appendAudit(
      tx,
      actor,
      row.projectId,
      "agent.profile.configured",
      `Updated profile ${id} revision ${next.revision}`,
    );
    return profileView(state, next);
  });
}
export async function pauseAgentProfile(
  state: AgentState,
  actor: Actor,
  id: string,
  raw: unknown,
  key: string,
  paused: boolean,
) {
  assertOwner(actor);
  const input = parseInput(ChangeAgentProfile, raw);
  return write(state.store, async (tx) => {
    const kind = paused ? "agent.profile.pause" : "agent.profile.resume";
    const receipt = await requestFor(tx, actor, key, kind, { id, ...input });
    const row = await profileFor(tx, id);
    if (receipt.existing) return profileView(state, row);
    if (row.revision !== input.expectedRevision)
      throw new DomainError("REVISION_CONFLICT", "Agent profile changed", 409);
    await assertNotBusy(tx, id);
    if (!paused)
      await scopeRevisions(state, tx, actor, {
        projectId: row.projectId,
        environmentId: row.environmentId,
        expectedProjectRevision: row.projectRevision,
        expectedEnvironmentRevision: row.environmentRevision,
      });
    const next = { ...row, paused, revision: row.revision + 1, updatedAt: state.now() };
    next.hash = profileHash(next, next.toolPolicy);
    await tx.update(schema.agentProfiles).set(next).where(eq(schema.agentProfiles.id, id));
    await recordRequest(tx, state.request, key, receipt.digest, id, kind);
    await appendAudit(tx, actor, row.projectId, kind, `Changed admission for profile ${id}`);
    return profileView(state, next);
  });
}
