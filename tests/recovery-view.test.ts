import { InfrastructureEngine } from "@godseye/core";
import { schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RecoveryFixture, recoveryFixture } from "./recovery-helpers.js";

describe("per-environment backup view and derived database protection states", () => {
  let fixture: RecoveryFixture;
  beforeEach(async () => {
    fixture = await recoveryFixture();
  });
  afterEach(async () => {
    await fixture.store.close();
  });
  const view = async (engine = fixture.infrastructure) => {
    const result = await engine.recovery.backups(fixture.freshOwner());
    const item = result.environments[0];
    if (!item) throw new Error("Backup view fixture is empty");
    return { result, item };
  };
  async function patchMetadata(change: Record<string, unknown>) {
    const [row] = await fixture.store.db.select().from(schema.recoveryBackups);
    if (!row) throw new Error("Backup fixture missing");
    await fixture.store.db
      .update(schema.recoveryBackups)
      .set({ metadata: { ...row.metadata, ...change } })
      .where(eq(schema.recoveryBackups.id, row.id));
  }

  it("reports a fresh archive as healthy with its recovery window and headroom", async () => {
    await fixture.backup();

    const { result, item } = await view();

    expect(result.provider).toBe("qualified");
    expect(item).toMatchObject({
      status: "healthy",
      archive: { state: "healthy", lagSeconds: 0 },
      headroom: { state: "ok", archiveFreeGiB: 2, requiredGiB: 1 },
      lastBaseBackup: { kind: "full" },
    });
    expect(item.recoveryWindow).not.toBeNull();
  });

  it("reports lagging with no advertised window once the archive check is older than policy", async () => {
    await fixture.backup();
    fixture.clock.advance(301_000);

    const { item } = await view();

    expect(item).toMatchObject({ status: "lagging", reasons: ["ARCHIVE_STALE"] });
    expect(item.recoveryWindow).toBeNull();
  });

  it("reports headroom-low when archive free space falls below the policy requirement", async () => {
    await fixture.backup();
    await patchMetadata({ archiveFreeGiB: 0.5 });

    const { item } = await view();

    expect(item).toMatchObject({ status: "headroom-low", headroom: { state: "low" } });
  });

  it("reports unknown, not healthy, when the provider is degraded and still answers read-only", async () => {
    await fixture.backup();
    fixture.recoveryProvider.qualificationResult = () => null;

    const { result, item } = await view();

    expect(result.provider).toBe("unavailable");
    expect(item).toMatchObject({ status: "unknown", reasons: ["PROVIDER_UNAVAILABLE"] });
    expect(item.headroom.archiveFreeGiB).toBeNull();
  });

  it("reports unknown when the provider throws during qualification", async () => {
    await fixture.backup();
    fixture.recoveryProvider.beforeAction = async (action) => {
      if (action === "qualification") throw new Error("provider down");
    };

    const { item } = await view();

    expect(item.status).toBe("unknown");
  });

  it("reports unknown for invalid stored evidence", async () => {
    await fixture.backup();
    await patchMetadata({ archiveCheckedAt: "not-a-date" });

    const { item } = await view();

    expect(item).toMatchObject({ status: "unknown", reasons: ["EVIDENCE_INVALID"] });
  });

  it("reports unconfigured when no recovery provider is injected", async () => {
    await fixture.backup();
    const bare = new InfrastructureEngine(fixture.store, {
      ...fixture.configuration,
      recoveryProvider: undefined,
    });

    const { result, item } = await view(bare);

    expect(result.provider).toBe("unconfigured");
    expect(item.reasons).toEqual(["PROVIDER_UNCONFIGURED"]);
  });

  it("derives database backup and restore flags from the same evidence", async () => {
    await fixture.backup();
    const flags = async () => {
      const overview = await fixture.infrastructure.database.overview(fixture.freshOwner());
      return { backup: overview.backup, restore: overview.restore, rotation: overview.rotation };
    };

    expect(await flags()).toEqual({ backup: "healthy", restore: "none", rotation: "unconfigured" });
    fixture.clock.advance(301_000);
    expect((await flags()).backup).toBe("degraded");
    fixture.recoveryProvider.qualificationResult = () => null;
    expect((await flags()).backup).toBe("unavailable");
  });

  it("reports no backup when a provider exists but nothing was backed up", async () => {
    const overview = await fixture.infrastructure.database.overview(fixture.freshOwner());

    expect(overview).toMatchObject({ backup: "none", restore: "none" });
  });
});
