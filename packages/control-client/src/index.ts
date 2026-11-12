import type {
  AcknowledgeIncidentInput,
  ActivationAssessment,
  AdmitDeliveryInput,
  AdmitRecoveryInput,
  BackendConfigurationDTO,
  BackupOverviewView,
  ConfigureBackendInput,
  CreateDeliveryPolicyInput,
  CreateProjectExportInput,
  DeliveryOverviewView,
  DeliveryPolicyView,
  DeliveryPreparationView,
  DeliveryRunView,
  IncidentOverviewView,
  IncidentView,
  JobDefinitionView,
  JobRunView,
  JobsOverviewView,
  MuteIncidentInput,
  OutboxIntentView,
  PrepareArchiveCheckInput,
  PrepareBackupInput,
  PrepareDeliveryInput,
  PrepareRestoreInput,
  ProjectExportView,
  ProjectLifecycleView,
  PurgeProjectInput,
  QuarantineProjectInput,
  ReconcileJobRunInput,
  ReconcileOutboxInput,
  RecoveryOverviewView,
  RecoveryPreparationView,
  RecoveryRunView,
  RegisterJobDefinitionInput,
  ReleaseQuarantineInput,
  ResumeProjectInput,
  RotateDatabaseRoleInput,
  RotationOverviewView,
  RotationRecordView,
  SuspendProjectInput,
  TriggerJobInput,
} from "@godseye/contracts";
import {
  type AccessOperation,
  type AccessOverviewView,
  type AccessSlot,
  type AdmissionControlView,
  type AdmitDatabaseInput,
  type AdmitInfrastructureInput,
  type AuditAnchor,
  type AuditExportPage,
  type AuditResponse,
  type BudgetResponse,
  type CiRunResponse,
  type CreateAccessSlotInput,
  type CreateEnvironmentInput,
  type CreateExecutionPlanInput,
  type CreateProjectInput,
  type CreateServiceIdentityInput,
  type DatabaseAllocationView,
  type DatabaseOverviewView,
  type DatabasePreparationView,
  type DeclareInventoryInput,
  type ExecutionPlanResponse,
  type ExecutionRunResponse,
  type HealthResponse,
  HttpId,
  type InfrastructureAllocation,
  type InfrastructureHeadroomView,
  type InfrastructureOverviewView,
  type InfrastructurePreparationView,
  type OperationRequest,
  type OperationResponse,
  type OverviewResponse,
  type OwnerSecurityView,
  type OwnerStatusView,
  type PrepareDatabaseInput,
  type PrepareInfrastructureInput,
  type ProjectDTO,
  type RegisterResourceInput,
  type RepositoryConfigurationInput,
  type ResourceResponse,
  type ServiceIdentity,
  type SetAdmissionInput,
  type UpdateEnvironmentInput,
  type UpdateProjectInput,
} from "@godseye/contracts";
import type { z } from "zod";
import { type ControlClientOptions, controlTransport } from "./transport.js";

export { ControlContractError } from "@godseye/contracts";
export { type ControlClientOptions, ControlHttpError } from "./transport.js";

const id = (value: string) => encodeURIComponent(HttpId.parse(value));
const identityId = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Invalid owner identity object ID");
  return encodeURIComponent(value);
};

/** Internal OWNER client. Never ship this as the application-project SDK or grant it to project workloads. */
export function createControlClient(options: ControlClientOptions = {}) {
  const request = controlTransport(options);
  return {
    backendConfiguration: (projectId: string, environmentId: string) =>
      request<BackendConfigurationDTO>(
        "GET",
        `/projects/${id(projectId)}/environments/${id(environmentId)}/backend`,
      ),
    configureBackend: (
      projectId: string,
      environmentId: string,
      input: ConfigureBackendInput,
      key: string,
    ) =>
      request<BackendConfigurationDTO>(
        "PUT",
        `/projects/${id(projectId)}/environments/${id(environmentId)}/backend`,
        input,
        key,
      ),
    jobsOverview: () => request<JobsOverviewView>("GET", "/jobs"),
    registerJobDefinition: (input: RegisterJobDefinitionInput, key: string) =>
      request<JobDefinitionView>("POST", "/jobs/definitions", input, key),
    pauseJobDefinition: (value: string, expectedRevision: number, key: string) =>
      request<JobDefinitionView>(
        "POST",
        `/jobs/definitions/${id(value)}/pause`,
        { expectedRevision },
        key,
      ),
    resumeJobDefinition: (value: string, expectedRevision: number, key: string) =>
      request<JobDefinitionView>(
        "POST",
        `/jobs/definitions/${id(value)}/resume`,
        { expectedRevision },
        key,
      ),
    triggerJob: (value: string, input: TriggerJobInput, key: string) =>
      request<JobRunView>("POST", `/jobs/definitions/${id(value)}/trigger`, input, key),
    cancelJobRun: (value: string, reason: string, key: string) =>
      request<JobRunView>("POST", `/jobs/runs/${id(value)}/cancel`, { reason }, key),
    reconcileJobRun: (value: string, input: ReconcileJobRunInput, key: string) =>
      request<JobRunView>("POST", `/jobs/runs/${id(value)}/reconcile`, input, key),
    reconcileOutboxIntent: (value: string, input: ReconcileOutboxInput, key: string) =>
      request<OutboxIntentView>("POST", `/jobs/outbox/${id(value)}/reconcile`, input, key),
    deliveryOverview: () => request<DeliveryOverviewView>("GET", "/delivery"),
    createDeliveryPolicy: (input: CreateDeliveryPolicyInput, key: string) =>
      request<DeliveryPolicyView>("POST", "/delivery/policies", input, key),
    revokeDeliveryPolicy: (value: string, expectedRevision: number, key: string) =>
      request<DeliveryPolicyView>(
        "POST",
        `/delivery/policies/${id(value)}/revoke`,
        { expectedRevision },
        key,
      ),
    synchronizeDelivery: (input: { policyId: string }, key: string) =>
      request<{ prepared: string[]; blocked: number }>("POST", "/delivery/synchronize", input, key),
    prepareDelivery: (input: PrepareDeliveryInput, key: string) =>
      request<DeliveryPreparationView>("POST", "/delivery/preparations", input, key),
    admitDelivery: (input: AdmitDeliveryInput, key: string) =>
      request<DeliveryRunView>("POST", "/delivery/admissions", input, key),
    cleanupDeliveryPreviews: (key: string) =>
      request<{ prepared: string[]; blocked: number }>("POST", "/delivery/cleanup", {}, key),
    databaseOverview: () => request<DatabaseOverviewView>("GET", "/databases"),
    databaseBackups: () => request<BackupOverviewView>("GET", "/databases/backups"),
    databaseRotations: () => request<RotationOverviewView>("GET", "/databases/rotations"),
    rotateDatabaseRole: (input: RotateDatabaseRoleInput, key: string) =>
      request<RotationRecordView>("POST", "/databases/rotations", input, key),
    reconcileDatabaseRotation: (value: string, key: string) =>
      request<RotationRecordView>("POST", `/databases/rotations/${id(value)}/reconcile`, {}, key),
    incidentOverview: () => request<IncidentOverviewView>("GET", "/incidents"),
    evaluateIncidents: (key: string) =>
      request<IncidentOverviewView>("POST", "/incidents/evaluations", {}, key),
    acknowledgeIncident: (value: string, input: AcknowledgeIncidentInput, key: string) =>
      request<IncidentView>("POST", `/incidents/${id(value)}/acknowledge`, input, key),
    muteIncident: (value: string, input: MuteIncidentInput, key: string) =>
      request<IncidentView>("POST", `/incidents/${id(value)}/mute`, input, key),
    resolveIncident: (value: string, input: AcknowledgeIncidentInput, key: string) =>
      request<IncidentView>("POST", `/incidents/${id(value)}/resolve`, input, key),
    projectLifecycle: (project: string) =>
      request<ProjectLifecycleView>("GET", `/projects/${id(project)}/lifecycle`),
    suspendProject: (project: string, input: SuspendProjectInput, key: string) =>
      request<ProjectLifecycleView>(
        "POST",
        `/projects/${id(project)}/lifecycle/suspend`,
        input,
        key,
      ),
    resumeProject: (project: string, input: ResumeProjectInput, key: string) =>
      request<ProjectLifecycleView>(
        "POST",
        `/projects/${id(project)}/lifecycle/resume`,
        input,
        key,
      ),
    quarantineProject: (project: string, input: QuarantineProjectInput, key: string) =>
      request<ProjectLifecycleView>(
        "POST",
        `/projects/${id(project)}/lifecycle/quarantine`,
        input,
        key,
      ),
    releaseProject: (project: string, input: ReleaseQuarantineInput, key: string) =>
      request<ProjectLifecycleView>(
        "POST",
        `/projects/${id(project)}/lifecycle/release`,
        input,
        key,
      ),
    purgeProject: (project: string, input: PurgeProjectInput, key: string) =>
      request<ProjectLifecycleView>("POST", `/projects/${id(project)}/lifecycle/purge`, input, key),
    createProjectExport: (project: string, input: CreateProjectExportInput, key: string) =>
      request<ProjectExportView>("POST", `/projects/${id(project)}/exports`, input, key),
    projectExport: (project: string, exportId: string) =>
      request<ProjectExportView>("GET", `/projects/${id(project)}/exports/${id(exportId)}`),
    recoveryOverview: () => request<RecoveryOverviewView>("GET", "/recovery"),
    prepareArchiveCheck: (input: PrepareArchiveCheckInput, key: string) =>
      request<RecoveryPreparationView>("POST", "/recovery/archives/preparations", input, key),
    prepareBackup: (input: PrepareBackupInput, key: string) =>
      request<RecoveryPreparationView>("POST", "/recovery/backups/preparations", input, key),
    prepareRestore: (input: PrepareRestoreInput, key: string) =>
      request<RecoveryPreparationView>("POST", "/recovery/restores/preparations", input, key),
    admitRecovery: (input: AdmitRecoveryInput, key: string) =>
      request<RecoveryRunView>("POST", "/recovery/admissions", input, key),
    assessRecoveryActivation: (value: string) =>
      request<z.infer<typeof ActivationAssessment>>(
        "GET",
        `/recovery/environments/${id(value)}/activation`,
      ),
    prepareDatabase: (input: PrepareDatabaseInput, key: string) =>
      request<DatabasePreparationView>("POST", "/databases/preparations", input, key),
    admitDatabase: (input: AdmitDatabaseInput, key: string) =>
      request<DatabaseAllocationView>("POST", "/databases/admissions", input, key),
    updateProject: (value: string, input: UpdateProjectInput, key: string) =>
      request<ProjectDTO>("PUT", `/projects/${id(value)}`, input, key),
    createEnvironment: (value: string, input: CreateEnvironmentInput, key: string) =>
      request<ProjectDTO>("POST", `/projects/${id(value)}/environments`, input, key),
    updateEnvironment: (
      value: string,
      environmentId: string,
      input: UpdateEnvironmentInput,
      key: string,
    ) =>
      request<ProjectDTO>(
        "PUT",
        `/projects/${id(value)}/environments/${id(environmentId)}`,
        input,
        key,
      ),
    infrastructureOverview: () => request<InfrastructureOverviewView>("GET", "/infrastructure"),
    infrastructureHeadroom: () =>
      request<InfrastructureHeadroomView>("GET", "/infrastructure/headroom"),
    setInfrastructureAdmission: (input: SetAdmissionInput, key: string) =>
      request<AdmissionControlView>("PUT", "/infrastructure/admission", input, key),
    declareInfrastructure: (input: DeclareInventoryInput, key: string) =>
      request<InfrastructureOverviewView>("PUT", "/infrastructure/inventory", input, key),
    refreshInfrastructure: (input: { expectedRevision: number }, key: string) =>
      request<InfrastructureOverviewView>("POST", "/infrastructure/refresh", input, key),
    prepareInfrastructure: (input: PrepareInfrastructureInput, key: string) =>
      request<InfrastructurePreparationView>("POST", "/infrastructure/preparations", input, key),
    admitInfrastructure: (input: AdmitInfrastructureInput, key: string) =>
      request<z.infer<typeof InfrastructureAllocation>>(
        "POST",
        "/infrastructure/admissions",
        input,
        key,
      ),
    accessOverview: () => request<AccessOverviewView>("GET", "/access"),
    createServiceIdentity: (input: CreateServiceIdentityInput, key: string) =>
      request<ServiceIdentity>("POST", "/access/identities", input, key),
    createAccessSlot: (input: CreateAccessSlotInput, key: string) =>
      request<AccessSlot>("POST", "/access/slots", input, key),
    revokeServiceIdentity: (value: string, expectedRevision: number, key: string) =>
      request<ServiceIdentity>(
        "POST",
        `/access/identities/${id(value)}/revoke`,
        { expectedRevision },
        key,
      ),
    activateAccessSlot: (value: string, adapterId: string, expectedRevision: number, key: string) =>
      request<AccessOperation>(
        "POST",
        `/access/slots/${id(value)}/activate`,
        { adapterId, expectedRevision },
        key,
      ),
    reconcileAccessOperation: (value: string, key: string) =>
      request<AccessOperation>("POST", `/access/operations/${id(value)}/reconcile`, {}, key),
    health: () => request<z.infer<typeof HealthResponse>>("GET", "/health"),
    overview: () => request<z.infer<typeof OverviewResponse>>("GET", "/overview"),
    ownerSession: () => request<OwnerStatusView>("GET", "/owner/session"),
    ownerSecurity: () => request<OwnerSecurityView>("GET", "/owner/security"),
    revokeSession: (value: string, key: string) =>
      request<{ revoked: true }>("POST", `/owner/sessions/${identityId(value)}/revoke`, {}, key),
    revokePasskey: (value: string, key: string) =>
      request<{ revoked: true }>("POST", `/owner/passkeys/${identityId(value)}/revoke`, {}, key),
    listProjects: () => request<ProjectDTO[]>("GET", "/projects"),
    getProject: (value: string) => request<ProjectDTO>("GET", `/projects/${id(value)}`),
    createProject: (input: CreateProjectInput, key: string) =>
      request<ProjectDTO>("POST", "/projects", input, key),
    configureRepository: (
      value: string,
      input: { repository: RepositoryConfigurationInput; expectedRevision: number },
      key: string,
    ) => request<ProjectDTO>("PUT", `/projects/${id(value)}/repository`, input, key),
    requestOperation: (value: string, input: z.infer<typeof OperationRequest>, key: string) =>
      request<z.infer<typeof OperationResponse>>(
        "POST",
        `/projects/${id(value)}/operations`,
        input,
        key,
      ),
    listOperations: () => request<z.infer<typeof OperationResponse>[]>("GET", "/operations"),
    getOperation: (value: string) =>
      request<z.infer<typeof OperationResponse>>("GET", `/operations/${id(value)}`),
    listCiRuns: () => request<z.infer<typeof CiRunResponse>[]>("GET", "/ci/runs"),
    listAudit: () => request<z.infer<typeof AuditResponse>[]>("GET", "/audit"),
    registerResource: (input: RegisterResourceInput, key: string) =>
      request<z.infer<typeof ResourceResponse>>("POST", "/foundation/resources", input, key),
    getBudget: (projectId: string) =>
      request<z.infer<typeof BudgetResponse>>("GET", `/foundation/budgets/${id(projectId)}`),
    configureBudget: (
      projectId: string,
      input: { limitMicros: number; expectedRevision: number },
      key: string,
    ) =>
      request<z.infer<typeof BudgetResponse>>(
        "PUT",
        `/foundation/budgets/${id(projectId)}`,
        input,
        key,
      ),
    createPlan: (input: CreateExecutionPlanInput, key: string) =>
      request<z.infer<typeof ExecutionPlanResponse>>("POST", "/foundation/plans", input, key),
    getPlan: (value: string) =>
      request<z.infer<typeof ExecutionPlanResponse>>("GET", `/foundation/plans/${id(value)}`),
    approvePlan: (value: string, expectedHash: string, key: string) =>
      request<z.infer<typeof ExecutionPlanResponse>>(
        "POST",
        `/foundation/plans/${id(value)}/approve`,
        { expectedHash },
        key,
      ),
    enqueuePlan: (value: string, key: string) =>
      request<z.infer<typeof ExecutionRunResponse>>(
        "POST",
        `/foundation/plans/${id(value)}/enqueue`,
        {},
        key,
      ),
    listRuns: () => request<z.infer<typeof ExecutionRunResponse>[]>("GET", "/foundation/runs"),
    getRun: (value: string) =>
      request<z.infer<typeof ExecutionRunResponse>>("GET", `/foundation/runs/${id(value)}`),
    cancelRun: (value: string, key: string) =>
      request<z.infer<typeof ExecutionRunResponse>>(
        "POST",
        `/foundation/runs/${id(value)}/cancel`,
        {},
        key,
      ),
    reconcileRun: (value: string, key: string) =>
      request<z.infer<typeof ExecutionRunResponse>>(
        "POST",
        `/foundation/runs/${id(value)}/reconcile`,
        {},
        key,
      ),
    exportAudit: (query: { cursor?: number; limit?: number } = {}) => {
      const parameters = new URLSearchParams();
      if (query.cursor !== undefined) parameters.set("cursor", String(query.cursor));
      if (query.limit !== undefined) parameters.set("limit", String(query.limit));
      return request<AuditExportPage>(
        "GET",
        `/audit/export${parameters.size ? `?${parameters}` : ""}`,
      );
    },
    auditAnchor: () => request<AuditAnchor>("GET", "/audit/anchor"),
  };
}
export type ControlClient = ReturnType<typeof createControlClient>;
