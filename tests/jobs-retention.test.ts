import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type JobsFixture, jobsFixture } from "./jobs-helpers.js";

const DAY_MS = 86_400_000;
const limits = (retentionDays: number) => ({
  maxConcurrent: 2,
  maxAttempts: 1,
  timeoutSeconds: 30,
  retentionDays,
});

describe("job and outbox retention", () => {
  let fixture: JobsFixture;
  beforeEach(async () => {
    fixture = await jobsFixture();
  });
  afterEach(async () => {
    await fixture.store.close();
  });

  it("keeps settled history inside the retention window", async () => {
    const definition = await fixture.register({ limits: limits(7) });
    await fixture.trigger(definition.id, 0, "retained-0001");
    await fixture.work();
    fixture.clock.advance(6 * DAY_MS);
    await fixture.jobs().tick();
    expect((await fixture.jobs().overview(fixture.freshOwner())).runs).toHaveLength(1);
  });
  it("deletes terminal runs and settled outbox rows older than retention", async () => {
    const definition = await fixture.register({ limits: limits(1) });
    await fixture.trigger(definition.id, 0, "expired-00001");
    await fixture
      .jobs()
      .transact((tx) => fixture.jobs().enqueueOutbox(tx, fixture.intent("expired-intent-1")));
    await fixture.work();
    expect(await fixture.outboxRows()).toMatchObject([{ state: "delivered" }]);
    fixture.clock.advance(2 * DAY_MS);
    const result = await fixture.jobs().tick();
    const overview = await fixture.jobs().overview(fixture.freshOwner());
    expect(result.pruned).toEqual({ runs: 1, outbox: 1 });
    expect(overview.runs).toHaveLength(0);
    expect(overview.outbox).toHaveLength(0);
  });
  it("never deletes unknown protected runs or unknown outbox rows however old", async () => {
    const definition = await fixture.register({ effectPolicy: "protected", limits: limits(1) });
    fixture.handler.script = async () => ({ status: "unknown" });
    fixture.sender.behavior = async () => ({ status: "unknown" });
    const run = await fixture.trigger(definition.id, 0, "unknown-00001");
    await fixture
      .jobs()
      .transact((tx) => fixture.jobs().enqueueOutbox(tx, fixture.intent("unknown-intent-1")));
    await fixture.work();
    fixture.clock.advance(30 * DAY_MS);
    await fixture.jobs().tick();
    const overview = await fixture.jobs().overview(fixture.freshOwner());
    expect(overview.runs.map((row) => [row.id, row.state])).toEqual([[run.id, "unknown"]]);
    expect(overview.outbox.map((row) => row.state)).toEqual(["unknown"]);
  });
  it("keeps a terminal run while an unresolved outbox intent still references it", async () => {
    const definition = await fixture.register({ limits: limits(1) });
    fixture.sender.behavior = async () => ({ status: "unknown" });
    const run = await fixture.trigger(definition.id, 0, "referenced-001");
    await fixture.work();
    await fixture
      .jobs()
      .transact((tx) =>
        fixture
          .jobs()
          .enqueueOutbox(tx, { ...fixture.intent("referenced-intent"), jobRunId: run.id }),
      );
    await fixture.work();
    fixture.clock.advance(5 * DAY_MS);
    await fixture.jobs().tick();
    const overview = await fixture.jobs().overview(fixture.freshOwner());
    expect(overview.runs.map((row) => row.state)).toEqual(["succeeded"]);
    expect(overview.outbox.map((row) => row.state)).toEqual(["unknown"]);
  });
  it("applies each definition's own retention to its runs", async () => {
    const short = await fixture.register({ name: "short-lived", limits: limits(1) });
    const long = await fixture.register({ name: "long-lived", limits: limits(30) });
    await fixture.trigger(short.id, 0, "short-0000001");
    await fixture.trigger(long.id, 0, "long-00000001");
    await fixture.work();
    await fixture.work();
    fixture.clock.advance(3 * DAY_MS);
    await fixture.jobs().tick();
    const overview = await fixture.jobs().overview(fixture.freshOwner());
    expect(overview.runs.map((row) => row.definitionId)).toEqual([long.id]);
  });
  it("performs no pruning while the engine is unconfigured", async () => {
    const idle = await jobsFixture({ configured: false });
    const result = await idle.jobs().tick();
    await idle.store.close();
    expect(result.pruned).toEqual({ runs: 0, outbox: 0 });
  });
});
