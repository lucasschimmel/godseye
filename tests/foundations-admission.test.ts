import { randomUUID } from "node:crypto";
import { FoundationEngine } from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeFixture,
  type FoundationFixture,
  fixturePlan,
  foundationFixture,
} from "./foundations-helpers.js";
import { owner, projectInput, repository } from "./helpers.js";

describe("durable foundation admission", () => {
  let fixture: FoundationFixture;
  beforeEach(async () => {
    fixture = await foundationFixture();
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  it("T09 T37 converges concurrent identical intentions to one run and one reservation", async () => {
    const plan = await fixturePlan(fixture);
    const key = randomUUID();

    const runs = await Promise.all(
      Array.from({ length: 5 }, () => fixture.engine.enqueue(owner, plan.id, key)),
    );

    expect(new Set(runs.map((run) => run.id)).size).toBe(1);
    expect(await fixture.engine.listRuns(owner)).toHaveLength(1);
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
      spentMicros: 0,
    });
  });

  it("T37 rejects a request key rebound to another immutable proposal", async () => {
    const first = await fixturePlan(fixture);
    const second = await fixturePlan(fixture, {
      command: { ...fixture.planInput.command, artifactDigest: `sha256:${"b".repeat(64)}` },
    });
    const key = randomUUID();
    await fixture.engine.enqueue(owner, first.id, key);

    await expect(fixture.engine.enqueue(owner, second.id, key)).rejects.toMatchObject({
      status: 409,
    });
    expect(await fixture.engine.listRuns(owner)).toHaveLength(1);
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
    });
  });

  it("T-AC-07 T34 rejects a configuration belonging to another project without admitting work", async () => {
    const other = await fixture.core.createProject(
      owner,
      { ...projectInput, slug: "other-foundation" },
      randomUUID(),
    );
    const environment = other.environments[0];
    if (!environment) throw new Error("Other environment fixture missing");
    const resource = await fixture.engine.registerResource(
      owner,
      {
        projectId: other.id,
        environmentId: environment.id,
        kind: "configuration",
        name: "Other configuration",
      },
      randomUUID(),
    );

    await expect(
      fixturePlan(fixture, {
        command: { ...fixture.planInput.command, configurationRef: resource.id },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await fixture.engine.listRuns(owner)).toHaveLength(0);
  });

  it("T34 rejects a registered reference of the wrong semantic kind", async () => {
    const input = await fixture.engine.registerResource(
      owner,
      {
        projectId: fixture.project.id,
        environmentId: fixture.development.id,
        kind: "input",
        name: "Agent input, not release configuration",
      },
      randomUUID(),
    );

    await expect(
      fixturePlan(fixture, {
        command: { ...fixture.planInput.command, configurationRef: input.id },
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await fixture.engine.listRuns(owner)).toHaveLength(0);
  });

  it("T34 denies missing or unqualified execution adapters", async () => {
    const unqualified = new FoundationEngine(fixture.store, {
      adapters: [{ ...fixture.provider.adapter, qualified: false }],
      now: fixture.clock.now,
    });

    await expect(
      unqualified.createPlan(owner, fixture.planInput, randomUUID()),
    ).rejects.toMatchObject({ status: 503 });
    await expect(fixturePlan(fixture, { adapterId: "unknown-adapter" })).rejects.toMatchObject({
      status: 503,
    });
    expect(await fixture.engine.listRuns(owner)).toHaveLength(0);
  });

  it("T22 refuses platform planning and another project's run to an application identity", async () => {
    const plan = await fixturePlan(fixture);
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());
    const service = { id: "project-worker", kind: "service" as const, projectIds: [] };

    await expect(
      fixture.engine.createPlan(service, fixture.planInput, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(fixture.engine.getRun(service, run.id)).rejects.toMatchObject({ status: 403 });
  });

  it("T37 rejects a proposal whose target revision changed before admission", async () => {
    const plan = await fixturePlan(fixture);
    await fixture.core.requestOperation(
      owner,
      fixture.project.id,
      { action: "project.validate", expectedRevision: fixture.project.revision },
      randomUUID(),
    );

    await expect(fixture.engine.enqueue(owner, plan.id, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
    });
  });

  it("T37 replays a repository mutation before its revision guard and rejects a changed payload under the same key", async () => {
    const key = randomUUID();
    const auditBefore = await fixture.core.listAudit(owner);
    const args = [owner, fixture.project.id, repository, fixture.project.revision, key] as const;

    const saved = await fixture.core.configureRepository(...args);
    const replay = await fixture.core.configureRepository(...args);

    expect(replay).toEqual(saved);
    expect(replay.revision).toBe(fixture.project.revision + 1);
    await expect(
      fixture.core.configureRepository(
        owner,
        fixture.project.id,
        { ...repository, branch: "changed-branch" },
        fixture.project.revision,
        key,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await fixture.core.listAudit(owner)).toHaveLength(auditBefore.length + 1);
  });
});

describe("exact owner approval", () => {
  let fixture: FoundationFixture;
  beforeEach(async () => {
    fixture = await foundationFixture();
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  async function productionPlan() {
    const resource = await fixture.engine.registerResource(
      owner,
      {
        projectId: fixture.project.id,
        environmentId: fixture.production.id,
        kind: "configuration",
        name: "Production configuration",
      },
      randomUUID(),
    );
    return fixturePlan(fixture, {
      environmentId: fixture.production.id,
      targetId: fixture.production.id,
      command: { ...fixture.planInput.command, configurationRef: resource.id },
    });
  }

  it("T22 T37 requires a fresh owner decision bound to the exact production proposal", async () => {
    const plan = await productionPlan();
    await expect(fixture.engine.enqueue(owner, plan.id, randomUUID())).rejects.toMatchObject({
      status: 409,
    });

    await fixture.engine.approve(fixture.freshOwner(), plan.id, plan.hash, randomUUID());
    const run = await fixture.engine.enqueue(owner, plan.id, randomUUID());

    expect(run.status).toBe("queued");
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
    });
  });

  it("T22 denies approval by a service even when it knows the proposal and hash", async () => {
    const plan = await productionPlan();
    const service = {
      ...fixture.freshOwner(),
      id: "agent",
      kind: "service" as const,
      projectIds: [fixture.project.id],
    };

    await expect(
      fixture.engine.approve(service, plan.id, plan.hash, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(fixture.engine.enqueue(owner, plan.id, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
  });

  it("T22 denies an approval after the owner's verification becomes stale", async () => {
    const plan = await productionPlan();
    const actor = fixture.freshOwner();
    fixture.clock.advance(5 * 60_000 + 1);

    await expect(
      fixture.engine.approve(actor, plan.id, plan.hash, randomUUID()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(fixture.engine.enqueue(owner, plan.id, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
  });

  it("T37 rejects a changed proposal hash and expires a previously valid approval", async () => {
    const plan = await productionPlan();
    await expect(
      fixture.engine.approve(fixture.freshOwner(), plan.id, "0".repeat(64), randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    await fixture.engine.approve(fixture.freshOwner(), plan.id, plan.hash, randomUUID());
    fixture.clock.advance(5 * 60_000 + 1);

    await expect(fixture.engine.enqueue(owner, plan.id, randomUUID())).rejects.toMatchObject({
      status: 409,
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
    });
  });

  it("T22 rechecks approval at dispatch without starving unrelated work and resumes only after fresh approval", async () => {
    const production = await productionPlan();
    await fixture.engine.approve(
      fixture.freshOwner(),
      production.id,
      production.hash,
      randomUUID(),
    );
    const protectedRun = await fixture.engine.enqueue(owner, production.id, randomUUID());
    fixture.clock.advance(5 * 60_000 + 1);
    const development = await fixturePlan(fixture);
    const ordinaryRun = await fixture.engine.enqueue(owner, development.id, randomUUID());

    await fixture.engine.tick("approval-check-worker");

    expect(await fixture.engine.getRun(owner, protectedRun.id)).toMatchObject({
      status: "awaiting_approval",
    });
    expect(await fixture.engine.getRun(owner, ordinaryRun.id)).toMatchObject({
      status: "succeeded",
    });
    expect(fixture.provider.executions.map((context) => context.runId)).toEqual([ordinaryRun.id]);
    await fixture.engine.approve(
      fixture.freshOwner(),
      production.id,
      production.hash,
      randomUUID(),
    );
    await fixture.engine.tick("fresh-approval-worker");
    expect(await fixture.engine.getRun(owner, protectedRun.id)).toMatchObject({
      status: "succeeded",
    });
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 0,
      spentMicros: 40,
    });
  });
});
