import { InfrastructureEngine, runJobScheduler } from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { jobsOptions } from "../apps/control-api/src/jobs-fixtures.js";
import { type JobsFixture, jobsFixture } from "./jobs-helpers.js";

const local = { GODSEYE_MODE: "local" } as const;
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return true;
    await new Promise((done) => setTimeout(done, 20));
  }
  return false;
}

describe("job scheduler pump and opt-in local fixtures", () => {
  let fixture: JobsFixture;
  beforeEach(async () => {
    fixture = await jobsFixture();
  });
  afterEach(async () => {
    await fixture.store.close();
  });

  it("never enables local fixtures by default", () => {
    expect(loadConfiguration(local).jobsLocalFixtures).toBe(false);
    expect(jobsOptions(loadConfiguration(local).jobsLocalFixtures)).toBeUndefined();
  });
  it("enables local fixtures only for the explicit enabled value", () => {
    expect(
      loadConfiguration({ ...local, GODSEYE_JOBS_LOCAL_FIXTURES: "1" }).jobsLocalFixtures,
    ).toBe(false);
    const config = loadConfiguration({ ...local, GODSEYE_JOBS_LOCAL_FIXTURES: "enabled" });
    expect([...(jobsOptions(config.jobsLocalFixtures)?.handlers?.keys() ?? [])]).toContain(
      "fixture.noop",
    );
  });
  it("leaves the overview unconfigured when no registry is injected", async () => {
    const engine = new InfrastructureEngine(fixture.store, {
      jobs: jobsOptions(false),
    });
    const overview = await engine.jobs.overview(fixture.freshOwner());
    expect(overview.engine.state).toBe("unconfigured");
  });
  it("settles a triggered run through the pump and the foundation consumer, then stops on abort", async () => {
    const definition = await fixture.register();
    const run = await fixture.trigger(definition.id, 0, "pump-0000001");
    const abort = new AbortController();
    const pump = runJobScheduler(fixture.jobs(), { signal: abort.signal, intervalMs: 10 });
    const consumer = (async () => {
      while (!abort.signal.aborted) {
        await fixture.infrastructure.foundation.tick("pump-worker");
        await new Promise((done) => setTimeout(done, 10));
      }
    })();
    const settled = await until(async () => (await fixture.state(run.id)).state === "succeeded");
    abort.abort();
    await Promise.all([pump, consumer]);
    expect(settled).toBe(true);
  });
  it("rejects when a tick fails so the server can stop admission", async () => {
    const abort = new AbortController();
    const engine = fixture.jobs();
    engine.tick = async () => {
      throw new Error("tick failed");
    };
    await expect(runJobScheduler(engine, { signal: abort.signal, intervalMs: 5 })).rejects.toThrow(
      "tick failed",
    );
  });
});
