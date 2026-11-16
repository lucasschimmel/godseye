import {
  BackupEnvironment,
  type BackupEnvironmentView,
  type BackupOverviewView,
  type ProtectionStateView,
} from "@godseye/contracts";
import { schema } from "@godseye/store";
import { currentEpoch } from "./foundation-data.js";
import type { RecoveryMetadata } from "./recovery-provider.js";
import { qualifyRecovery, type RecoveryState, recoveryScope } from "./recovery-state.js";

type Row = typeof schema.recoveryBackups.$inferSelect;
type Policy = typeof schema.recoveryPreparations.$inferSelect.policy;
type Provider = "unconfigured" | "unavailable" | "qualified";

const instant = (value: unknown) => {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const gib = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

/** Pure derivation: missing, invalid or provider-unverified data is `unknown`, never healthy. */
export function backupEnvironment(
  row: Row,
  policy: Policy,
  provider: Provider,
  now: Date,
): BackupEnvironmentView {
  const metadata = row.metadata as unknown as Partial<RecoveryMetadata>;
  const reasons: string[] = [];
  const checked = instant(metadata.archiveCheckedAt);
  const completed = instant(metadata.completedAt);
  const from = instant(metadata.recoverableFrom);
  const to = instant(metadata.recoverableTo);
  const free = gib(metadata.archiveFreeGiB);
  const used = gib(metadata.repositoryUsedGiB);
  const lag = checked === null ? null : Math.max(0, Math.floor((now.getTime() - checked) / 1000));
  let archive: BackupEnvironmentView["archive"]["state"] = "healthy";
  if (provider !== "qualified") {
    archive = "unknown";
    reasons.push(provider === "unconfigured" ? "PROVIDER_UNCONFIGURED" : "PROVIDER_UNAVAILABLE");
  } else if (lag === null || completed === null) {
    archive = "unknown";
    reasons.push("EVIDENCE_INVALID");
  } else if (metadata.archiveContinuous !== true) {
    archive = "lagging";
    reasons.push("ARCHIVE_DISCONTINUOUS");
  } else if (lag > policy.maxArchiveAgeSeconds) {
    archive = "lagging";
    reasons.push("ARCHIVE_STALE");
  }
  let headroom: BackupEnvironmentView["headroom"]["state"] = "ok";
  if (archive === "unknown" || free === null || used === null) headroom = "unknown";
  else if (free < policy.archiveHeadroomGiB || used > policy.repositoryGiB) {
    headroom = "low";
    reasons.push("HEADROOM_LOW");
  }
  const known = headroom !== "unknown";
  const status =
    archive === "unknown" || headroom === "unknown"
      ? "unknown"
      : archive === "lagging"
        ? "lagging"
        : headroom === "low"
          ? "headroom-low"
          : "healthy";
  return BackupEnvironment.parse({
    projectId: row.projectId,
    environmentId: row.environmentId,
    allocationId: row.sourceAllocationId,
    status,
    lastBaseBackup:
      completed === null
        ? null
        : { backupId: row.id, kind: row.kind, completedAt: new Date(completed).toISOString() },
    archive: {
      state: archive,
      checkedAt: checked === null ? null : new Date(checked).toISOString(),
      lagSeconds: lag,
      maxAgeSeconds: policy.maxArchiveAgeSeconds,
    },
    recoveryWindow:
      archive === "healthy" && from !== null && to !== null
        ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() }
        : null,
    headroom: {
      state: headroom,
      archiveFreeGiB: known ? free : null,
      requiredGiB: policy.archiveHeadroomGiB,
      repositoryUsedGiB: known ? used : null,
      repositoryGiB: policy.repositoryGiB,
    },
    reasons,
  });
}
async function providerFor(
  state: RecoveryState,
  preparation: typeof schema.recoveryPreparations.$inferSelect,
): Promise<Provider> {
  if (!state.provider) return "unconfigured";
  try {
    const epoch = await currentEpoch(state.store.db, preparation.sourceEnvironmentId);
    await qualifyRecovery(state, await recoveryScope(state.store.db, preparation, epoch));
    return "qualified";
  } catch {
    // Degraded providers must not break read-only status; the reason is surfaced as `unavailable`.
    return "unavailable";
  }
}
/** Latest retained base backup per source allocation, with per-scope live provider qualification. */
export async function backupOverview(
  state: RecoveryState,
): Promise<BackupOverviewView & { verified: ReadonlySet<string> }> {
  const backups = await state.store.db.select().from(schema.recoveryBackups);
  const preparations = await state.store.db.select().from(schema.recoveryPreparations);
  const latest = new Map<string, Row>();
  for (const row of backups) {
    const prior = latest.get(row.sourceAllocationId);
    if (!prior || prior.createdAt.getTime() < row.createdAt.getTime())
      latest.set(row.sourceAllocationId, row);
  }
  const environments: BackupEnvironmentView[] = [];
  const results = new Set<Provider>();
  for (const row of latest.values()) {
    const preparation = preparations.find((item) => item.id === row.preparationId);
    const provider = preparation ? await providerFor(state, preparation) : "unavailable";
    results.add(provider);
    environments.push(
      backupEnvironment(
        row,
        preparation?.policy ?? { ...zeroPolicy },
        preparation ? provider : "unavailable",
        state.now(),
      ),
    );
  }
  const provider: Provider = !state.provider
    ? "unconfigured"
    : results.size && !results.has("unavailable")
      ? "qualified"
      : "unavailable";
  return {
    provider,
    environments,
    verified: new Set(backups.filter((row) => row.verifiedAt).map((row) => row.environmentId)),
  };
}
const zeroPolicy = {
  fullRetention: 2,
  differentialRetention: 1,
  repositoryGiB: 1,
  stagingGiB: 1,
  archiveHeadroomGiB: 1,
  maxArchiveAgeSeconds: 60,
};
/** Summarize the overview into the two database-level flags. */
export function backupProtection(view: Awaited<ReturnType<typeof backupOverview>>): {
  backup: ProtectionStateView;
  restore: ProtectionStateView;
} {
  if (view.provider === "unconfigured") return { backup: "unconfigured", restore: "unconfigured" };
  const rows = view.environments;
  const rank = (items: BackupEnvironmentView[]): ProtectionStateView =>
    !items.length
      ? "none"
      : items.some((item) => item.status === "unknown")
        ? view.provider === "qualified"
          ? "unknown"
          : "unavailable"
        : items.some((item) => item.status !== "healthy")
          ? "degraded"
          : "healthy";
  const verifiedRows = rows.filter((item) => view.verified.has(item.environmentId));
  return { backup: rank(rows), restore: rank(verifiedRows) };
}
