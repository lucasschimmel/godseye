import { type BackupPolicyInput, FOUNDATION_DEFAULTS } from "@godseye/contracts";
import type { CompiledDatabaseProfile } from "./database-policy.js";
import type { DatabaseProviderBinding, DatabaseProviderScope } from "./database-provider.js";
import { immutableSnapshot } from "./infra-policy.js";
import { fingerprint } from "./journal.js";

export interface RecoveryScope {
  preparationId: string;
  preparationHash: string;
  projectId: string;
  sourceEnvironmentId: string;
  sourceAllocationId: string;
  repositoryId: string;
  environmentId: string;
  allocationId: string;
  epoch: number;
  kind: "full" | "diff" | "restore" | "check";
  policy: BackupPolicyInput;
  sourceScope: DatabaseProviderScope;
  sourceCatalog: CompiledDatabaseProfile;
  sourceSystemIdentifier: string;
  backup: RecoveryMetadata | null;
  targetTime: string | null;
}
export interface RecoveryQualification extends DatabaseProviderBinding {
  scopeHash: string;
  observedAt: string;
  expiresAt: string;
  encryptedRepository: true;
  independentRepository: true;
  capacityEnforced: true;
  privateNetwork: true;
  isolatedRestore: true;
  evidence: string;
}
export interface RecoveryMetadata {
  repositoryId: string;
  sourceAllocationId: string;
  sourceSystemIdentifier: string;
  sourceCatalogHash: string;
  backupLabel: string;
  kind: "full" | "diff";
  baseBackupLabel: string;
  manifestHash: string;
  startedAt: string;
  completedAt: string;
  recoverableFrom: string;
  recoverableTo: string;
  startLsn: string;
  stopLsn: string;
  timeline: number;
  archiveCheckedAt: string;
  archiveContinuous: boolean;
  repositoryUsedGiB: number;
  archiveFreeGiB: number;
  evidence: string;
}
export interface RecoveryInspection {
  scopeHash: string;
  metadata: RecoveryMetadata;
  destination: null | {
    allocationId: string;
    environmentId: string;
    sourceSystemIdentifier: string;
    sourceCatalogHash: string;
    dataVolume: string;
    walVolume: string;
    networkId: string;
    sourceNetworkId: string;
    sourceRetained: true;
    configurationReplaced: true;
    runtimeAccessBlocked: true;
    inRecovery: true;
    replayPaused: true;
    replayTime: string;
    targetTime: string;
    targetReached: true;
    timeline: number;
    evidence: string;
  };
}
/** Independent physical proof that the exact restored destination left recovery and may open runtime access. */
export interface RecoveryPromotion {
  scopeHash: string;
  allocationId: string;
  environmentId: string;
  promoted: true;
  inRecovery: false;
  runtimeAccessBlocked: false;
  evidence: string;
}
/** Private physical backup transport, independent of the logical NOREPLICATION SQL backup role. */
export interface RecoveryProvider {
  readonly binding: DatabaseProviderBinding;
  qualification(scope: RecoveryScope): Promise<RecoveryQualification | null>;
  backup(scope: RecoveryScope, gate: () => Promise<void>): Promise<void>;
  check(scope: RecoveryScope, gate: () => Promise<void>): Promise<void>;
  restore(scope: RecoveryScope, gate: () => Promise<void>): Promise<void>;
  inspect(scope: RecoveryScope): Promise<RecoveryInspection | null>;
  /**
   * Optional activation capability. A provider implements both methods or neither: until it does, the
   * control plane refuses activation (`PROMOTION_UNAVAILABLE`) rather than designating an unreachable
   * database as active. `promote` ends recovery on the exact restored destination and must be idempotent
   * for the same scope; `inspectPromotion` reports the physical outcome without mutating anything.
   */
  promote?(scope: RecoveryScope, gate: () => Promise<void>): Promise<void>;
  inspectPromotion?(scope: RecoveryScope): Promise<RecoveryPromotion | null>;
}
export const recoveryScopeHash = (scope: RecoveryScope) => fingerprint(scope);
export const canPromote = (provider: RecoveryProvider | undefined) =>
  !!provider &&
  typeof provider.promote === "function" &&
  typeof provider.inspectPromotion === "function";
export function assertRecoveryPromotion(
  scopeInput: RecoveryScope,
  valueInput: RecoveryPromotion | null,
) {
  const scope = immutableSnapshot(scopeInput),
    value = immutableSnapshot(valueInput);
  if (
    scope.kind !== "restore" ||
    !value ||
    value.scopeHash !== recoveryScopeHash(scope) ||
    value.allocationId !== scope.allocationId ||
    value.environmentId !== scope.environmentId ||
    value.promoted !== true ||
    value.inRecovery !== false ||
    value.runtimeAccessBlocked !== false ||
    !value.evidence?.trim()
  )
    throw new Error("Recovery destination is not an independently promoted physical clone");
  return value;
}
export function assertRecoveryInspection(
  scopeInput: RecoveryScope,
  valueInput: RecoveryInspection | null,
  now: Date,
) {
  const scope = immutableSnapshot(scopeInput),
    value = immutableSnapshot(valueInput);
  const metadata = value?.metadata;
  const date = (text: string) =>
    Number.isFinite(Date.parse(text)) && Date.parse(text) <= now.getTime();
  const label = /^\d{8}-\d{6}F(?:_\d{8}-\d{6}[DI])?$/;
  const lsn = (text: string) => {
    const [high = "0", low = "0"] = text.split("/");
    return (BigInt(`0x${high}`) << 32n) + BigInt(`0x${low}`);
  };
  if (
    !value ||
    value.scopeHash !== recoveryScopeHash(scope) ||
    !metadata ||
    metadata.repositoryId !== scope.repositoryId ||
    metadata.sourceAllocationId !== scope.sourceAllocationId ||
    metadata.sourceSystemIdentifier !== scope.sourceSystemIdentifier ||
    metadata.sourceCatalogHash !== fingerprint(scope.sourceCatalog) ||
    !label.test(metadata.backupLabel) ||
    !label.test(metadata.baseBackupLabel) ||
    !/^[a-f0-9]{64}$/.test(metadata.manifestHash) ||
    !metadata.evidence?.trim() ||
    metadata.archiveContinuous !== true ||
    !date(metadata.archiveCheckedAt) ||
    now.getTime() - Date.parse(metadata.archiveCheckedAt) >
      scope.policy.maxArchiveAgeSeconds * 1000 ||
    ![
      metadata.startedAt,
      metadata.completedAt,
      metadata.recoverableFrom,
      metadata.recoverableTo,
    ].every(date) ||
    Date.parse(metadata.startedAt) > Date.parse(metadata.completedAt) ||
    Date.parse(metadata.recoverableFrom) < Date.parse(metadata.completedAt) ||
    Date.parse(metadata.recoverableTo) < Date.parse(metadata.recoverableFrom) ||
    now.getTime() - Date.parse(metadata.recoverableFrom) > FOUNDATION_DEFAULTS.restoreWindowMs ||
    ![metadata.startLsn, metadata.stopLsn].every((s) => /^[A-F0-9]+\/[A-F0-9]+$/.test(s)) ||
    !Number.isSafeInteger(metadata.timeline) ||
    metadata.timeline <= 0 ||
    !Number.isFinite(metadata.repositoryUsedGiB) ||
    metadata.repositoryUsedGiB < 0 ||
    metadata.repositoryUsedGiB > scope.policy.repositoryGiB ||
    !Number.isFinite(metadata.archiveFreeGiB) ||
    metadata.archiveFreeGiB < scope.policy.archiveHeadroomGiB
  )
    throw new Error("Recovery metadata is incomplete, stale or outside its exact scope");
  if (
    (metadata.kind === "full" &&
      (metadata.backupLabel !== metadata.baseBackupLabel || metadata.backupLabel.includes("_"))) ||
    (metadata.kind === "diff" &&
      (!metadata.backupLabel.endsWith("D") ||
        metadata.backupLabel.split("_")[0] !== metadata.baseBackupLabel)) ||
    lsn(metadata.startLsn) > lsn(metadata.stopLsn)
  )
    throw new Error("Backup chain or LSN ordering differs");
  if (scope.kind === "check") {
    if (!scope.backup || value.destination)
      throw new Error("Archive check requires the exact existing backup");
    const identity = (item: RecoveryMetadata) => ({
      label: item.backupLabel,
      kind: item.kind,
      base: item.baseBackupLabel,
      manifest: item.manifestHash,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      from: item.recoverableFrom,
      start: item.startLsn,
      stop: item.stopLsn,
      timeline: item.timeline,
    });
    if (
      fingerprint(identity(metadata)) !== fingerprint(identity(scope.backup)) ||
      Date.parse(metadata.recoverableTo) < Date.parse(scope.backup.recoverableTo)
    )
      throw new Error("Archive check backup lineage changed");
    return value;
  }
  if (scope.kind !== "restore") {
    if (metadata.kind !== scope.kind || value.destination)
      throw new Error("Backup inspection differs");
    return value;
  }
  const target = value.destination;
  if (
    !scope.backup ||
    metadata.backupLabel !== scope.backup.backupLabel ||
    fingerprint(metadata) !== fingerprint(scope.backup) ||
    !scope.targetTime ||
    Date.parse(scope.targetTime) < Date.parse(metadata.recoverableFrom) ||
    Date.parse(scope.targetTime) > Date.parse(metadata.recoverableTo) ||
    !target ||
    target.allocationId !== scope.allocationId ||
    target.environmentId !== scope.environmentId ||
    scope.allocationId === scope.sourceAllocationId ||
    scope.environmentId === scope.sourceEnvironmentId ||
    target.sourceSystemIdentifier !== scope.sourceSystemIdentifier ||
    target.sourceCatalogHash !== fingerprint(scope.sourceCatalog) ||
    [scope.sourceCatalog.dataVolume, scope.sourceCatalog.walVolume].includes(target.dataVolume) ||
    [scope.sourceCatalog.dataVolume, scope.sourceCatalog.walVolume].includes(target.walVolume) ||
    !target.dataVolume ||
    !target.walVolume ||
    target.dataVolume === target.walVolume ||
    !target.networkId ||
    !target.sourceNetworkId ||
    target.networkId === target.sourceNetworkId ||
    target.configurationReplaced !== true ||
    target.runtimeAccessBlocked !== true ||
    target.sourceRetained !== true ||
    target.inRecovery !== true ||
    target.replayPaused !== true ||
    target.targetReached !== true ||
    target.targetTime !== scope.targetTime ||
    target.timeline !== scope.backup.timeline ||
    !date(target.replayTime) ||
    Date.parse(target.replayTime) > Date.parse(scope.targetTime) ||
    !target.evidence?.trim()
  )
    throw new Error("Recovery destination is not an independently held paused physical clone");
  return value;
}
