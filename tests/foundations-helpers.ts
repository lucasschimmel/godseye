import { randomUUID } from "node:crypto";
import {
  type Actor,
  ControlPlane,
  type EffectOutcomeInput,
  type ExecutionAdapter,
  type ExecutionContext,
  FoundationEngine,
} from "@godseye/core";
import { openStore, type Store } from "@godseye/store";
import { owner, projectInput } from "./helpers.js";

export class FoundationClock {
  private time = Date.parse("2026-11-11T12:00:00.000Z");
  now = () => new Date(this.time);
  advance(milliseconds: number) {
    this.time += milliseconds;
  }
}

export function fixtureAdapter() {
  const executions: ExecutionContext[] = [];
  const reconciliations: ExecutionContext[] = [];
  let execute: (context: ExecutionContext) => Promise<EffectOutcomeInput> = async () => ({
    status: "succeeded",
    evidenceRef: "fixture:receipt",
    costMicros: 20,
  });
  let reconcile: (context: ExecutionContext) => Promise<EffectOutcomeInput> = async () => ({
    status: "succeeded",
    evidenceRef: "fixture:receipt",
    costMicros: 20,
  });
  const adapter: ExecutionAdapter = {
    id: "qualified-fixture",
    qualified: true,
    async execute(context) {
      executions.push(context);
      return execute(context);
    },
    async reconcile(context) {
      reconciliations.push(context);
      return reconcile(context);
    },
  };
  return {
    adapter,
    executions,
    reconciliations,
    executeWith(handler: typeof execute) {
      execute = handler;
    },
    reconcileWith(handler: typeof reconcile) {
      reconcile = handler;
    },
  };
}

export async function foundationFixture(
  options: { dataDir?: string; budgetMicros?: number; leaseMs?: number } = {},
) {
  const store = await openStore(options.dataDir ? { dataDir: options.dataDir } : {});
  try {
    const core = new ControlPlane(store);
    const clock = new FoundationClock();
    const provider = fixtureAdapter();
    const engine = new FoundationEngine(store, {
      adapters: [provider.adapter],
      now: clock.now,
      leaseMs: options.leaseMs ?? 60_000,
    });
    const project = await core.createProject(owner, projectInput, randomUUID());
    const development = project.environments.find(
      (environment) => environment.kind === "development",
    );
    const production = project.environments.find(
      (environment) => environment.kind === "production",
    );
    if (!development || !production)
      throw new Error("Foundation environment fixture is incomplete");
    const freshOwner = (): Actor => ({
      ...owner,
      sessionId: "fixture-owner-session",
      authenticatedAt: clock.now().toISOString(),
    });
    await engine.configureBudget(
      owner,
      project.id,
      { limitMicros: options.budgetMicros ?? 1000, expectedRevision: 0 },
      randomUUID(),
    );
    const resource = await engine.registerResource(
      owner,
      {
        projectId: project.id,
        environmentId: development.id,
        kind: "configuration",
        name: "Development release configuration",
      },
      randomUUID(),
    );
    const planInput = {
      projectId: project.id,
      environmentId: development.id,
      targetId: development.id,
      expectedRevision: project.revision,
      adapterId: provider.adapter.id,
      command: {
        kind: "deployment.release" as const,
        intent: "deploy" as const,
        artifactDigest: `sha256:${"a".repeat(64)}`,
        configurationRef: resource.id,
      },
      maxCostMicros: 50,
      tools: ["fixture.publish"],
      destinations: ["fixture.invalid"],
    };
    return {
      store,
      core,
      clock,
      provider,
      engine,
      project,
      development,
      production,
      resource,
      planInput,
      freshOwner,
    };
  } catch (error) {
    await store.close();
    throw error;
  }
}

export type FoundationFixture = Awaited<ReturnType<typeof foundationFixture>>;

export async function fixturePlan(
  fixture: FoundationFixture,
  overrides: Partial<FoundationFixture["planInput"]> = {},
) {
  return fixture.engine.createPlan(owner, { ...fixture.planInput, ...overrides }, randomUUID());
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

export async function closeFixture(fixture: { store: Store } | undefined) {
  await fixture?.store.close();
}
