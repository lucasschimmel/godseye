import { randomUUID } from "node:crypto";
import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  type ProjectExportView,
  type ProjectLifecycleView,
} from "@godseye/contracts";
import { InfrastructureEngine } from "@godseye/core";
import { schema } from "@godseye/store";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../apps/control-api/src/app.js";
import { loadConfiguration } from "../apps/control-api/src/config.js";
import { projectInput } from "./helpers.js";
import { type OwnerAuthFixture, ownerAuthFixture } from "./owner-auth-fixture.js";

const STALE_MS = 3_600_000;

describe("project suspension, metadata export and staged deletion (D10)", () => {
  let fixture: OwnerAuthFixture;
  let app: ReturnType<typeof createApp>;
  let headers: Headers;
  let projectId: string;
  beforeEach(async () => {
    fixture = await ownerAuthFixture();
    const infrastructure = new InfrastructureEngine(fixture.store);
    app = createApp(
      fixture.core,
      loadConfiguration({ GODSEYE_MODE: "local" }),
      fixture.identity,
      infrastructure.foundation,
      undefined,
      infrastructure,
    );
    headers = (await fixture.session()).headers;
    headers.set(CONTROL_API_HEADER, CONTROL_API_VERSION);
    const created = await request("/projects", "POST", projectInput);
    projectId = ((await created.json()) as { id: string }).id;
  });
  afterEach(async () => {
    await fixture.close();
  });
  function request(
    path: string,
    method = "GET",
    body?: unknown,
    key: string = randomUUID(),
    from = headers,
  ) {
    const selected = new Headers(from);
    if (method !== "GET") selected.set("idempotency-key", key);
    return app.request(new URL(`/api/v1${path}`, fixture.origin), {
      method,
      headers: selected,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  const lifecycle = async () =>
    (await (await request(`/projects/${projectId}/lifecycle`)).json()) as ProjectLifecycleView;
  const command = (action: string, body: unknown, key?: string, from?: Headers) =>
    request(`/projects/${projectId}/lifecycle/${action}`, "POST", body, key, from);
  const suspend = async () => {
    const view = await lifecycle();
    return command("suspend", { expectedRevision: view.revision, reason: "Owner pause" });
  };
  const exportNow = async () => {
    const view = await lifecycle();
    const response = await request(`/projects/${projectId}/exports`, "POST", {
      expectedRevision: view.revision,
    });
    return { response, body: (await response.json()) as ProjectExportView };
  };
  const quarantine = async (exportId: string, from?: Headers) => {
    const view = await lifecycle();
    return command(
      "quarantine",
      { expectedRevision: view.revision, exportId, reason: "Retiring the project" },
      undefined,
      from,
    );
  };
  const elapseRetention = () =>
    fixture.store.db
      .update(schema.projectLifecycles)
      .set({ purgeAfter: new Date(Date.now() - 1000) })
      .where(eq(schema.projectLifecycles.projectId, projectId));

  it("reports an active project with nothing gated and asks to suspend first", async () => {
    const view = await lifecycle();

    expect(view).toMatchObject({ phase: "active", purgeable: false, quarantinable: false });
    expect(view.services.every((service) => service.state === "none")).toBe(true);
    expect(view.blockers).toContainEqual({ code: "SUSPEND_REQUIRED", count: 1 });
  });

  it("suspends once, gates the dependent services and refuses a second suspension", async () => {
    const before = await lifecycle();

    const response = await suspend();
    const view = (await response.json()) as ProjectLifecycleView;
    const again = await suspend();

    expect(response.status).toBe(200);
    expect(view).toMatchObject({ phase: "suspended", revision: before.revision + 1 });
    expect(view.services.filter((s) => s.state === "enforced").map((s) => s.service)).toEqual([
      "jobs",
      "backend",
      "delivery",
    ]);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_LIFECYCLE",
    );
  });

  it("replays the same idempotency key without bumping the revision twice", async () => {
    const view = await lifecycle();
    const key = randomUUID();
    const body = { expectedRevision: view.revision, reason: "Owner pause" };

    await command("suspend", body, key);
    const replay = await command("suspend", body, key);

    expect(replay.status).toBe(200);
    expect((await lifecycle()).revision).toBe(view.revision + 1);
  });

  it("rejects a stale revision with 409", async () => {
    const view = await lifecycle();

    const response = await command("suspend", {
      expectedRevision: view.revision + 5,
      reason: "Owner pause",
    });

    expect(response.status).toBe(409);
  });

  it("resumes a suspended project back to its prior status", async () => {
    await suspend();
    const view = await lifecycle();

    const response = await command("resume", { expectedRevision: view.revision });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ phase: "active" });
    const [project] = await fixture.store.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(project?.status).not.toBe("suspended");
  });

  it("exports a deterministic metadata manifest that never claims data was included", async () => {
    const first = await exportNow();
    const second = await exportNow();
    const fetched = (await (
      await request(`/projects/${projectId}/exports/${first.body.id}`)
    ).json()) as ProjectExportView;

    expect(first.response.status).toBe(201);
    expect(second.body.digest).toBe(first.body.digest);
    expect(fetched.manifest).toMatchObject({
      format: "godseye.project-export/1",
      data: { included: false },
    });
    expect(JSON.stringify(fetched.manifest)).not.toMatch(/password|secret|token/i);
  });

  it("refuses quarantine until the current revision has an export", async () => {
    const stale = await exportNow();
    await suspend();

    const response = await quarantine(stale.body.id);

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "EXPORT_REQUIRED",
    );
  });

  it("requires a recent passkey step-up to quarantine", async () => {
    await suspend();
    const current = await exportNow();
    const old = (await fixture.session(STALE_MS * 2)).headers;
    old.set(CONTROL_API_HEADER, CONTROL_API_VERSION);

    const response = await quarantine(current.body.id, old);

    expect(response.status).toBe(403);
  });

  it("quarantines for the retention window and then freezes project edits", async () => {
    await suspend();
    const exported = await exportNow();

    const response = await quarantine(exported.body.id);
    const view = (await response.json()) as ProjectLifecycleView;
    const edit = await request(`/projects/${projectId}`, "PUT", {
      expectedRevision: view.revision,
      name: "Renamed",
      description: "",
    });

    expect(response.status).toBe(200);
    expect(view.phase).toBe("quarantined");
    const days =
      (Date.parse(view.purgeAfter ?? "") - Date.parse(view.quarantinedAt ?? "")) / 86_400_000;
    expect(days).toBe(7);
    expect(edit.status).toBe(409);
    expect(((await edit.json()) as { error: { code: string } }).error.code).toBe(
      "PROJECT_QUARANTINED",
    );
  });

  it("blocks quarantine while an operation outcome is unresolved", async () => {
    await suspend();
    const exported = await exportNow();
    await fixture.store.db.insert(schema.operations).values({
      id: randomUUID(),
      projectId,
      action: "fixture",
      status: "unknown",
      revision: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await quarantine(exported.body.id);

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "LIFECYCLE_BLOCKED",
    );
  });

  it("releases a quarantined project back to suspension", async () => {
    await suspend();
    const exported = await exportNow();
    await quarantine(exported.body.id);
    const view = await lifecycle();

    const response = await command("release", { expectedRevision: view.revision });

    expect(await response.json()).toMatchObject({ phase: "suspended", purgeAfter: null });
  });

  it("refuses an early purge, keeps the refusal in the audit and demands the slug", async () => {
    await suspend();
    const exported = await exportNow();
    await quarantine(exported.body.id);
    const view = await lifecycle();

    const early = await command("purge", {
      expectedRevision: view.revision,
      confirmSlug: view.slug,
    });
    const wrong = await command("purge", { expectedRevision: view.revision, confirmSlug: "nope" });

    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe("PURGE_BLOCKED");
    expect(wrong.status).toBe(422);
    const audit = await fixture.store.db.select().from(schema.audit);
    expect(audit.some((entry) => entry.action === "project.purge_refused")).toBe(true);
  });

  it("refuses to purge while physical resources are still recorded", async () => {
    await suspend();
    const exported = await exportNow();
    await quarantine(exported.body.id);
    await elapseRetention();
    await fixture.store.db.execute(sql`SET session_replication_role = replica`);
    await fixture.store.db.insert(schema.recoveryBackups).values({
      id: randomUUID(),
      preparationId: randomUUID(),
      projectId,
      environmentId: randomUUID(),
      sourceAllocationId: randomUUID(),
      repositoryId: randomUUID(),
      kind: "full",
      metadata: {},
      createdAt: new Date(),
    });
    const view = await lifecycle();

    const response = await command("purge", {
      expectedRevision: view.revision,
      confirmSlug: view.slug,
    });

    expect(view.residual.map((item) => item.kind)).toEqual(["backup"]);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
      "physical resource",
    );
  });

  it("purges a retention-expired project with no residual resources and keeps a tombstone", async () => {
    await suspend();
    const exported = await exportNow();
    await quarantine(exported.body.id);
    await elapseRetention();
    const view = await lifecycle();

    const response = await command("purge", {
      expectedRevision: view.revision,
      confirmSlug: view.slug,
    });
    const after = (await response.json()) as ProjectLifecycleView;
    const again = await command("purge", {
      expectedRevision: after.revision,
      confirmSlug: view.slug,
    });

    expect(response.status).toBe(200);
    expect(after).toMatchObject({ phase: "purged", purgeable: false });
    expect(after.purgedAt).not.toBeNull();
    expect(again.status).toBe(409);
  });

  it("keeps lifecycle routes owner-only", async () => {
    const response = await app.request(
      new URL(`/api/v1/projects/${projectId}/lifecycle`, fixture.origin),
      { headers: fixture.headers() },
    );

    expect(response.status).toBe(401);
  });
});
