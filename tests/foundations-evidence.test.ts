import { randomUUID } from "node:crypto";
import { verifyAuditExport } from "@godseye/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeFixture,
  type FoundationFixture,
  fixturePlan,
  foundationFixture,
} from "./foundations-helpers.js";
import { owner } from "./helpers.js";

describe("independently anchored audit export", () => {
  let fixture: FoundationFixture;
  beforeEach(async () => {
    fixture = await foundationFixture();
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  async function exportPages() {
    await fixturePlan(fixture);
    const snapshot = await fixture.engine.exportAudit(owner, 0, 100);
    const trustedAnchor = { ...snapshot.anchor };
    const pages: (typeof snapshot)[] = [];
    let cursor = 0;
    while (cursor < trustedAnchor.sequence) {
      const page = await fixture.engine.exportAudit(owner, cursor, 2);
      if (page.to <= cursor) throw new Error("Audit export cursor did not advance");
      pages.push(page);
      cursor = page.to;
    }
    return { pages, trustedAnchor };
  }

  it("T-AC-10 T37 verifies ordered pages against a separately retained final sequence and digest", async () => {
    const { pages, trustedAnchor } = await exportPages();

    expect(verifyAuditExport(pages, trustedAnchor)).toBe(true);
    expect(pages.length).toBeGreaterThan(1);
  });

  it("T37 detects missing, reordered or truncated exported pages even when surviving records are unchanged", async () => {
    const { pages, trustedAnchor } = await exportPages();

    expect(verifyAuditExport(pages.slice(1), trustedAnchor)).toBe(false);
    expect(verifyAuditExport([...pages].reverse(), trustedAnchor)).toBe(false);
    expect(verifyAuditExport(pages.slice(0, -1), trustedAnchor)).toBe(false);
  });

  it("T37 rejects an exported record changed after the owner's anchor was retained", async () => {
    const { pages, trustedAnchor } = await exportPages();
    const changed = structuredClone(pages);
    const entry = changed[0]?.entries[0];
    if (!entry) throw new Error("Audit export fixture missing");
    entry.summary = "Altered export fixture";

    expect(verifyAuditExport(changed, trustedAnchor)).toBe(false);
  });
});

describe("deduplication and recovery evidence retention", () => {
  let fixture: FoundationFixture;
  beforeEach(async () => {
    fixture = await foundationFixture();
  });
  afterEach(async () => {
    await closeFixture(fixture);
  });

  it("T18 T37 never expires an unresolved intention or its effect receipt", async () => {
    fixture.provider.executeWith(async () => ({ status: "unknown", costMicros: 0 }));
    const plan = await fixturePlan(fixture);
    const key = randomUUID();
    const run = await fixture.engine.enqueue(owner, plan.id, key);
    await fixture.engine.tick("unknown-retention-worker");
    fixture.clock.advance(60 * 24 * 60 * 60_000);

    expect(await fixture.engine.prune(owner)).toMatchObject({ effects: 0 });
    const otherPlan = await fixturePlan(fixture, {
      command: { ...fixture.planInput.command, artifactDigest: `sha256:${"b".repeat(64)}` },
    });
    await expect(fixture.engine.enqueue(owner, otherPlan.id, key)).rejects.toMatchObject({
      status: 409,
    });
    expect((await fixture.engine.enqueue(owner, plan.id, key)).id).toBe(run.id);
    expect(await fixture.engine.tick("unsafe-retry-worker")).toBe(false);
    expect(await fixture.engine.getBudget(owner, fixture.project.id)).toMatchObject({
      reservedMicros: 50,
    });
  });

  it("T07 T37 retains completed effects past request retention until the restore window plus seven days", async () => {
    const plan = await fixturePlan(fixture);
    await fixture.engine.enqueue(owner, plan.id, randomUUID());
    await fixture.engine.tick("terminal-retention-worker");
    fixture.clock.advance(7 * 24 * 60 * 60_000 - 1);

    expect(await fixture.engine.prune(owner)).toMatchObject({ idempotency: 0, effects: 0 });
    fixture.clock.advance(2);
    const afterRequestMinimum = await fixture.engine.prune(owner);
    expect(afterRequestMinimum.idempotency).toBeGreaterThanOrEqual(1);
    expect(afterRequestMinimum.effects).toBe(0);
    fixture.clock.advance(30 * 24 * 60 * 60_000);
    expect((await fixture.engine.prune(owner)).effects).toBe(1);
  });
});
