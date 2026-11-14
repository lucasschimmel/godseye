# Repo map — ranked by reference count (top 60, method: grep)

- (163 refs) packages/app-backend/src/contracts.ts — const APP_API_VERSION = \;const APP_API_HEADER = \;const APP_PROJECT_HEADER = \;const APP_ENVIRONMENT_HEADER = \;const APP_BASE = \;
- (153 refs) packages/app-backend/src/local.ts — interface LocalApplicationOptions;function openLocalApplication(options: LocalApplicationOptions) {;
- (134 refs) packages/app-backend/src/store.ts — type ApplicationDatabase = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;;type ApplicationAccess = Pick<;interface ApplicationStore {;function serialApplicationLane() {;function openApplicationStore(options: {;
- (132 refs) packages/app-backend/src/state.ts — interface ApplicationLifecycle {;type ApplicationOAuthProvider = z.infer<typeof OAuthProvider>;;interface ApplicationBackendOptions {;function applicationState(input: ApplicationBackendOptions) {;type ApplicationState = ReturnType<typeof applicationState>;;
- (123 refs) apps/console/src/components/ui/input.tsx — no exported symbols
- (114 refs) packages/core/src/policy.ts — function assertTransition(from: OperationState, to: OperationState): void {;interface Actor {;function assertProjectAccess(actor: Actor, projectId: string): void {;function assertOwner(actor: Actor): void {;
- (110 refs) apps/console/src/lib/owner.ts — const ownerAuth = createAuthClient({ basePath: \;function forgetOwnerData(cache: QueryClient, status: OwnerStatusView) {;function ownerAuthenticationRequired() {;
- (109 refs) packages/contracts/src/owner.ts — const OwnerStatusResponse = z.discriminatedUnion(\;type OwnerStatusView = z.infer<typeof OwnerStatusResponse>;;type OwnerAuthenticatedView = Extract<OwnerStatusView, { authenticated: true }>;;const OwnerSecurityResponse = z;type OwnerSecurityView = z.infer<typeof OwnerSecurityResponse>;;
- (105 refs) packages/app-backend/src/schema.ts — const appScope = pgTable(\;const user = pgTable(\;const session = pgTable(\;const account = pgTable(\;const verification = pgTable(\;
- (104 refs) packages/store/src/schema.ts — const controlLock = pgTable(\;const projects = pgTable(;const environments = pgTable(;const operations = pgTable(;const requests = pgTable(;
- (84 refs) apps/control-api/src/identity/runtime.ts — function assertPrivateTarget(directory: string) {;function privateDirectory(directory: string) {;function loadIdentityMaterial(identityDir: string) {;function acquireInstance(stateDir: string) {;function identityPaths(dataDir: string, stateOverride?: string) {;
- (83 refs) packages/app-backend/src/runtime.ts — function createApplicationBackend(options: ApplicationBackendOptions) {;function boundedBody(request: Request, maximum: number) {;
- (77 refs) packages/contracts/src/database.ts — const DATABASE_POLICY_VERSION = \;const DATABASE_ROLES = [;type DatabaseRole = (typeof DATABASE_ROLES)[number];;const DatabaseProfile = z;type DatabaseProfileInput = z.infer<typeof DatabaseProfile>;;
- (77 refs) apps/console/src/lib/api.ts — function api<T>(path: string, init?: RequestInit): Promise<T> {;function resource<T>(key: string, path: string) {;function timestamp(value: string) {;
- (77 refs) apps/backend-template/src/application.ts — function createTemplateApplication(options: LocalApplicationOptions) {;
- (76 refs) packages/core/src/database.ts — class DatabaseEngine {;
- (67 refs) packages/core/src/recovery.ts — class RecoveryEngine {;
- (67 refs) packages/core/src/delivery.ts — interface DeliveryOptions {;class DeliveryEngine {;function runDeliveryScheduler(;
- (67 refs) packages/contracts/src/recovery.ts — const RECOVERY_POLICY_VERSION = \;const BackupPolicy = z;type BackupPolicyInput = z.infer<typeof BackupPolicy>;;const PrepareBackup = z;type PrepareBackupInput = z.infer<typeof PrepareBackup>;;
- (67 refs) packages/contracts/src/delivery.ts — const DELIVERY_POLICY_VERSION = \;const DELIVERY_INTENTS = [\;const DeliveryLimits = z;const DeliveryRecipe = z;const CreateDeliveryPolicy = z;
- (67 refs) packages/app-backend/src/recovery.ts — function exportApplicationRecovery(state: ApplicationState, input: { directory: string }) {;function importApplicationRecovery(;
- (66 refs) packages/core/src/projects.ts — function getProject(;function listProjects(store: Store, actor: Actor): Promise<ProjectView[]> {;function createProject(;function configureRepository(;
- (66 refs) packages/core/src/errors.ts — class DomainError extends Error {;function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {;
- (66 refs) packages/contracts/src/infrastructure.ts — const InfrastructureCapacity = z;type InfrastructureCapacityInput = z.infer<typeof InfrastructureCapacity>;;const DeclareInventory = z;type DeclareInventoryInput = z.infer<typeof DeclareInventory>;;const InfrastructureRevision = z;
- (65 refs) packages/core/src/journal.ts — function fingerprint(value: unknown): string {;function write<T>(store: Store, work: (tx: DatabaseAccess) => Promise<T>): Promise<T> {;function existingRequest(tx: DatabaseAccess, key: string, digest: string) {;function appendAudit(;function verifyAudit(store: Store): Promise<boolean> {;
- (65 refs) packages/core/src/infrastructure.ts — interface InfrastructureOptions {;class InfrastructureEngine {;
- (65 refs) apps/console/src/routes/infrastructure.tsx — const Route = createFileRoute(\;
- (62 refs) tests/helpers.ts — const owner = { id: \;const projectInput: CreateProjectInput = {;const repository: RepositoryConfigurationInput = {;const webhookKey = \;function githubPush(overrides: Record<string, unknown> = {}): Record<string, unknown> {;
- (62 refs) apps/control-api/src/app.ts — function createApp(;
- (61 refs) packages/app-backend/src/auth.ts — function applicationAuth(state: ApplicationState) {;type ApplicationAuth = ReturnType<typeof applicationAuth>;;function assertApplicationAuthRoute(state: ApplicationState, path: string, method: string) {;function handleApplicationAuth(;function requireApplicationSession(;
- (55 refs) packages/contracts/src/access.ts — const ACCESS_PURPOSES = [\;const AccessPurpose = z.enum(ACCESS_PURPOSES);;const CreateServiceIdentity = z.discriminatedUnion(\;type CreateServiceIdentityInput = z.infer<typeof CreateServiceIdentity>;;const CreateAccessSlot = z.object({ identityId: Id, name: Name }).strict();;
- (54 refs) packages/core/src/access.ts — class AccessBroker {;
- (54 refs) apps/console/src/routes/access.tsx — const Route = createFileRoute(\;
- (50 refs) packages/contracts/src/manifest.ts — const validateManifest = ajv.compile(manifestSchema);;const validateAction = ajv.compile(actionSchema);;const validateOperation = ajv.compile(operationSchema);;
- (46 refs) packages/contracts/src/http.ts — class ControlContractError extends Error {;function assertControlVersion(version: string, method = \;function parseControlResponse<T = unknown>(;function parseControlRequest<T = unknown>(;
- (40 refs) packages/contracts/src/config.ts — const LOCAL_DEFAULTS = {;
- (40 refs) apps/control-api/src/config.ts — function loadConfiguration(env: NodeJS.ProcessEnv = process.env) {;type Configuration = ReturnType<typeof loadConfiguration>;;
- (36 refs) packages/core/src/foundation-data.ts — interface FoundationOptions {;interface FoundationState {;function foundationState(store: Store, options: FoundationOptions): FoundationState {;function adapterFor(state: FoundationState, id: string) {;function assertFresh(actor: Actor, state: FoundationState) {;
- (35 refs) packages/store/src/index.ts — type ControlDatabase = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;;type DatabaseAccess = Pick<;interface Store {;function openStore(;
- (35 refs) packages/sdk/src/index.ts — function createGodseyeClient(options: GodseyeClientOptions) {;
- (35 refs) packages/core/src/index.ts — class ControlPlane {;
- (35 refs) packages/control-client/src/index.ts — function createControlClient(options: ControlClientOptions = {}) {;type ControlClient = ReturnType<typeof createControlClient>;;
- (35 refs) packages/contracts/src/index.ts — no exported symbols
- (35 refs) packages/app-backend/src/index.ts — no exported symbols
- (35 refs) apps/control-api/src/identity/index.ts — function createOwnerIdentity(store: Store, options: IdentityOptions) {;type OwnerIdentity = Awaited<ReturnType<typeof createOwnerIdentity>>;;
- (35 refs) apps/console/src/routes/index.tsx — const Route = createFileRoute(\;
- (34 refs) apps/control-api/src/server.ts — no exported symbols
- (34 refs) apps/backend-template/src/server.ts — no exported symbols
- (33 refs) packages/core/src/infra-policy.ts — const INFRASTRUCTURE_POLICY_VERSION = \;interface ApplicationScope {;type CompiledApplication = CompiledApplicationInput;;function immutableSnapshot<T>(input: T): T {;function compileApplication(;
- (32 refs) packages/sdk/src/files.ts — interface MutationOptions {;function applicationFiles(transport: ApplicationTransport, chunkBytes = 1024 * 1024) {;
- (32 refs) apps/control-api/src/identity/shared.ts — const OWNER_DEFAULTS = {;const ticketIdentifier = (ticket: string) =>;interface IdentityOptions {;interface OwnerStatus {;interface IdentityState {;
- (32 refs) apps/console/src/components/shared.tsx — function PageHeading({;function Status({ value }: { value: string }) {;function EmptyState({;function Loading() {;function Failure({ error, retry }: { error: Error; retry?: () => void }) {;
- (29 refs) packages/sdk/src/transport.ts — interface GodseyeClientOptions {;class GodseyeHttpError extends Error {;function boundedResponse(response: Response, maximum = 262144) {;function applicationTransport(options: GodseyeClientOptions) {;type ApplicationTransport = ReturnType<typeof applicationTransport>;;
- (29 refs) packages/core/src/operations.ts — const operationView = (row: typeof schema.operations.$inferSelect): OperationView => ({;function listOperations(store: Store, actor: Actor): Promise<OperationView[]> {;function requestOperation(;
- (29 refs) packages/core/src/foundations.ts — type EffectOutcome = EffectOutcomeInput;;class FoundationEngine {;function runFoundationWorker(;
- (29 refs) packages/contracts/src/foundations.ts — const ActionCommand = z.union([;type ActionCommandInput = z.infer<typeof ActionCommand>;;const RESOURCE_KINDS = [;const RegisterResource = z;type RegisterResourceInput = z.infer<typeof RegisterResource>;;
- (29 refs) apps/console/src/routes/operations.tsx — const Route = createFileRoute(\;
- (29 refs) apps/console/src/components/ui/button.tsx — interface ButtonProps;
- (28 refs) packages/control-client/src/transport.ts — interface ControlClientOptions {;class ControlHttpError extends Error {;function controlTransport(options: ControlClientOptions) {;
- (23 refs) packages/sdk/src/events.ts — type GodseyeEventMessage =;interface EventSubscriptionOptions {;function applicationEvents(transport: ApplicationTransport, reconnectMs = 1000) {;

Hermes tools continuation (2026-11-14): scoped grep symbol/reuse delta in ../reviews/hermes-tools-symbol-delta.json; frozen source hashes in ../reviews/hermes-tools-source-freeze.json. Fixed typed helper only; general-code KVM remains unavailable.

## Coding runners continuation — 2026-11-14

Focused graph delta; prior ranking above retained (grep/import approximation, no full AST rebuild).
- Contracts `coding.ts` / `coding-endpoints.ts` -> store `coding-schema.ts`, migration0021 -> core `coding*.ts` -> control routes/provider/startup -> control-client -> console `agents-coding.tsx`.
- CodingEngine composes existing Foundation admission, grants, epoch, budget, heavy pool, execution journal and read-only recovery. Do not fork the Hermes AgentProvider or add a second budget/recovery engine.
- Runtime path: fixed Windows WSL launcher -> `coding_guest_control.py` -> private source/object closure -> pinned QEMU/KVM jail -> trusted guest worker -> pinned Codex/Claude -> serial-only bounded model broker.
- Worktree source and CLI homes are disposable guest RAM. Result proof uses independent immutable file trees and trusted Git export, not the agent-controlled index.
- Public startup is optional/fail-closed; operator `coding-bindings.mjs` owns protected local configuration, `coding-runtime.mjs` owns fixed setup actions. No public host paths/argv/credential fields.
- Reuse existing owner session UI, environment labels, Foundation lifecycle and inert text artifact behavior; no alternate publication/deployment path.
- Evidence is split: ordinary coding tests, source/broker/readiness mechanisms, browser owner flows, real native qualification and genuine Foundation/native composition. Pure fixtures cannot qualify a CLI/VM.

## Approved orchestration continuation — 2026-11-14

Scoped grep/import delta, no full AST rebuild: contracts orchestration.ts/endpoints -> store orchestration-schema/migration0022 -> core orchestration{,-plans,-state,-authority,-scheduler,-delegation} -> Infrastructure/Foundation exact delegation and final authority fences -> owner API/client -> console agents-plans*. Reuses AgentEngine/CodingEngine, Foundation write/admission/budget/grants/effects and owner passkey. No parallel execution engine or alternate credential/deployment path. Context and evidence: orchestration-design.md, orchestration-report.md and reviews/orchestration-{tests,security,docs}.json.

## E08 continuation — 2026-11-14
Scoped grep/import delta (no full AST rebuild): usage/observability contracts -> migrations0023/0024 -> UsageEngine/ObservabilityEngine -> existing Foundation/IncidentEngine/Infrastructure -> owner routes/client -> Usage/Budgets and Observability pages. Native attempt evidence helper composes existing Hermes/Coding brokers; do not fork financial authority, incident lifecycle or execution engine. Resource inventory is explicitly global; invoice totals are not invented for narrower attribution. See e08-report.md and reviews/e08-tests.json.
