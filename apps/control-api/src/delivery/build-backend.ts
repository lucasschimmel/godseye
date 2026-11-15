import { MigrationBinding, ScannerEvidence } from "@godseye/contracts";
import {
  type BuildEvidence,
  type DeliveryManifest,
  type DeliveryScope,
  deliveryConfigurationHash,
  deliveryProvenanceHash,
  fingerprint,
} from "@godseye/core";
import { z } from "zod";
import type { JenkinsClient } from "./jenkins-client.js";
import type { RegistryClient } from "./registry-client.js";

const DEFAULT_POLL_MS = 5000;
const DEFAULT_DEADLINE_MS = 25 * 60 * 1000;
const sleepFor = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The document the job template archives as `evidence.json`; it is a claim to verify, not trust. */
export const JenkinsEvidenceDocument = z
  .object({
    version: z.literal(1),
    imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    checks: z
      .array(z.object({ name: z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/), passed: z.boolean() }))
      .max(32),
    scanner: ScannerEvidence,
    migration: MigrationBinding,
    builderId: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  })
  .strict();

/** Name of the image repository owned by a project inside the private registry. */
export const imageName = (manifest: DeliveryManifest) => `p-${manifest.projectId}`;
/** Deterministic idempotency token: one Jenkins build per delivery scope and commit. */
export const buildToken = (scope: DeliveryScope, manifest: DeliveryManifest) =>
  fingerprint({ scope, commit: manifest.source.commitSha, purpose: "jenkins-build" });

export interface BuildBackendOptions {
  pollMs?: number;
  deadlineMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Drives the per-project parameterized Jenkins job and verifies its evidence into BuildEvidence. */
export class JenkinsBuildBackend {
  constructor(
    private readonly jenkins: JenkinsClient,
    private readonly registry: RegistryClient,
    private readonly options: BuildBackendOptions = {},
  ) {}
  async build(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    guard: () => Promise<void>,
  ): Promise<BuildEvidence> {
    const token = buildToken(scope, manifest);
    await this.jenkins.submit(token, this.parameters(scope, manifest));
    const sleep = this.options.sleep ?? sleepFor;
    const now = this.options.now ?? Date.now;
    const deadline = now() + (this.options.deadlineMs ?? DEFAULT_DEADLINE_MS);
    for (;;) {
      await guard();
      const state = await this.jenkins.find(token);
      if (state.state === "finished") {
        const evidence = await this.verify(scope, manifest, token, state);
        if (evidence) return evidence;
        throw new Error("Jenkins build did not produce verifiable evidence");
      }
      if (state.state === "absent") throw new Error("Jenkins build disappeared before completion");
      // Timeout leaves the effect "unknown"; reconciliation re-reads via inspectBuild, never resubmits.
      if (now() >= deadline) throw new Error("Jenkins build did not finish within its deadline");
      await sleep(this.options.pollMs ?? DEFAULT_POLL_MS);
    }
  }
  async inspectBuild(scope: DeliveryScope, manifest: DeliveryManifest) {
    const token = buildToken(scope, manifest);
    const state = await this.jenkins.find(token);
    return state.state === "finished" ? this.verify(scope, manifest, token, state) : null;
  }
  private parameters(scope: DeliveryScope, manifest: DeliveryManifest) {
    return {
      SOURCE_COMMIT: manifest.source.commitSha,
      REPOSITORY_FULL_NAME: manifest.repository.fullName,
      RECIPE_KIND: manifest.recipe.kind,
      RECIPE_CONTEXT: manifest.recipe.context,
      RUN_ID: scope.runId,
      SCOPE_HASH: fingerprint(scope),
      IMAGE_NAME: imageName(manifest),
      REQUIRED_CHECKS: manifest.requiredChecks.join(","),
      MAX_ARTIFACT_MIB: String(manifest.maxArtifactMiB),
    };
  }
  private async verify(
    scope: DeliveryScope,
    manifest: DeliveryManifest,
    token: string,
    state: { number: number; result: string },
  ): Promise<BuildEvidence | null> {
    if (state.result !== "SUCCESS") return null;
    const ran = await this.jenkins.buildParameters(state.number);
    const expected = this.parameters(scope, manifest);
    if (ran.IDEMPOTENCY_TOKEN !== token || Object.entries(expected).some(([k, v]) => ran[k] !== v))
      return null;
    const doc = JenkinsEvidenceDocument.safeParse(await this.jenkins.evidence(state.number));
    if (!doc.success || doc.data.scanner.artifactDigest !== doc.data.imageDigest) return null;
    const image = await this.registry.verify(imageName(manifest), doc.data.imageDigest);
    if (!image) return null;
    const base = {
      scope: structuredClone(scope),
      digest: image.digest,
      sizeBytes: image.sizeBytes,
      commitSha: manifest.source.commitSha,
      repositoryId: manifest.repository.repositoryId,
      installationId: manifest.repository.installationId,
      recipeHash: fingerprint(manifest.recipe),
      checks: doc.data.checks,
      // Scanner completion only; the policy threshold gate (assertScanGate) decides on findings.
      scan: "passed" as const,
      builderId: doc.data.builderId,
      configurationHash: deliveryConfigurationHash(manifest),
      schemaCompatibility:
        doc.data.migration.class === "destructive"
          ? ("incompatible" as const)
          : ("compatible" as const),
      scanner: doc.data.scanner,
      migration: doc.data.migration,
    };
    return {
      ...base,
      provenanceHash: deliveryProvenanceHash(base),
      evidence: `jenkins-build-${state.number}`,
    };
  }
}
