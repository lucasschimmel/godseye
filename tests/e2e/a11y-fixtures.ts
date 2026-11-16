import { CONTROL_API_HEADER, CONTROL_API_VERSION } from "@godseye/contracts";
import { expect, type Page, type Route } from "@playwright/test";

const API = "/api/v1";
const JENKINS = "http://10.20.1.10:8080";
const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const DIGEST = `sha256:${"c".repeat(64)}`;
const HASH = "d".repeat(64);
const NOW = Date.now();
const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

export interface CreatedProject {
  id: string;
  name: string;
  revision: number;
  environments: { id: string; kind: string; revision: number }[];
}

/** Creates a project through the real console form so tables render persisted rows. */
export async function createProject(page: Page, name: string): Promise<CreatedProject> {
  await page.goto("/projects/new");
  await page.getByLabel("Nom du projet", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Enregistrer le projet", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  const response = await page.request.get(`${API}/projects`, {
    headers: { [CONTROL_API_HEADER]: CONTROL_API_VERSION },
  });
  const projects = (await response.json()) as CreatedProject[];
  const project = projects.find((item) => item.name === name);
  if (!project) throw new Error("Created project missing from the project list");
  return project;
}

/** Reads the real response, lets `patch` return the synthetic body, and serves it with real headers. */
async function serve(route: Route, patch: (real: unknown) => unknown) {
  const response = await route.fetch();
  await route.fulfill({ response, json: patch(await response.json()) });
}

/**
 * Serves a verified current release for the project's production environment: active deployment,
 * current policy, configured delivery, fresh passkey, one CI run linked to a Jenkins build and
 * platform builds. The panels are the real ones; only these read-only responses are synthetic.
 */
export async function mockReleaseData(page: Page, project: CreatedProject) {
  const environment =
    project.environments.find((item) => item.kind === "production") ?? project.environments[0];
  if (!environment) throw new Error("Project has no environment");
  const ids = {
    policy: "11111111-1111-4111-8111-111111111111",
    artifact: "22222222-2222-4222-8222-222222222222",
    preparation: "33333333-3333-4333-8333-333333333333",
    run: "44444444-4444-4444-8444-444444444444",
    deployment: "55555555-5555-4555-8555-555555555555",
    ci: "66666666-6666-4666-8666-666666666666",
  };
  const repository = {
    fullName: "fixture/a11y",
    repositoryId: 1,
    installationId: 2,
    branch: "main",
    autoDeploy: false,
  };
  await page.route(`**${API}/delivery`, (route) =>
    serve(route, (real) => ({
      ...(real as object),
      source: "configured",
      execution: "configured",
      policies: [
        {
          id: ids.policy,
          projectId: project.id,
          environmentId: environment.id,
          expectedProjectRevision: project.revision,
          expectedEnvironmentRevision: environment.revision,
          recipe: { kind: "static", context: "." },
          requiredChecks: ["ci"],
          maxArtifactMiB: 64,
          maxConcurrentPreviews: 0,
          previewTtlHours: 24,
          limits: { cpuMilliCores: 500, memoryMiB: 256, storageGiB: 1, pids: 64 },
          autoDeploy: false,
          expiresAt: iso(7 * DAY),
          repository,
          revision: 1,
          hash: HASH,
          revokedAt: null,
          createdAt: iso(-DAY),
        },
      ],
      artifacts: [
        {
          id: ids.artifact,
          preparationId: ids.preparation,
          projectId: project.id,
          environmentId: environment.id,
          ciRunId: ids.ci,
          commitSha: COMMIT,
          digest: DIGEST,
          sizeBytes: 1_048_576,
          recipeHash: HASH,
          checks: [{ name: "ci", passed: true }],
          scan: "passed",
          scanner: null,
          migration: null,
          provenanceHash: HASH,
          createdAt: iso(-DAY),
        },
      ],
      deployments: [
        {
          id: ids.deployment,
          preparationId: ids.preparation,
          runId: ids.run,
          projectId: project.id,
          environmentId: environment.id,
          intent: "release",
          state: "active",
          artifactId: ids.artifact,
          previousDeploymentId: null,
          reason: null,
          updatedAt: iso(-3_600_000),
        },
      ],
    })),
  );
  await page.route(`**${API}/owner/security`, (route) =>
    serve(route, (real) => ({ ...(real as object), fresh: true })),
  );
  await page.route(`**${API}/ci/runs`, (route) =>
    serve(route, () => [
      {
        id: ids.ci,
        projectId: project.id,
        projectName: project.name,
        deliveryId: null,
        branch: "main",
        commitSha: COMMIT,
        status: "succeeded",
        trigger: "push",
        repositorySnapshot: repository,
        pullRequestNumber: null,
        eventAction: null,
        providerRef: `${JENKINS}/job/godseye-platform/42/`,
        errorCode: null,
        createdAt: iso(-DAY),
        updatedAt: iso(-DAY),
      },
    ]),
  );
  await page.route(`**${API}/infrastructure/jenkins`, (route) =>
    serve(route, () => {
      const build = (number: number, patch: Record<string, unknown>) => ({
        number,
        result: "SUCCESS",
        building: false,
        startedAt: iso(-DAY),
        durationMs: 61_000,
        branch: null,
        commitSha: null,
        url: `${JENKINS}/job/godseye-platform/${number}/`,
        ...patch,
      });
      return {
        state: "connected",
        observedAt: iso(0),
        jobs: [
          {
            name: "godseye-platform",
            state: "observed",
            builds: [
              build(43, {
                result: null,
                building: true,
                durationMs: null,
                startedAt: iso(-60_000),
              }),
              build(42, { commitSha: COMMIT }),
              build(41, { result: "FAILURE" }),
            ],
          },
          { name: "godseye-platform-candidate", state: "unavailable", reason: "TIMEOUT" },
        ],
      };
    }),
  );
}
