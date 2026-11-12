import type {
  AdmitInfrastructureInput,
  DeclareInventoryInput,
  PrepareInfrastructureInput,
  SetAdmissionInput,
} from "@godseye/contracts";
import type { Store } from "@godseye/store";
import { DATABASE_ADAPTER_ID, DatabaseEngine, type DatabaseProvider } from "./database.js";
import { DatabaseRotationEngine, type DatabaseRotationProvider } from "./database-rotation.js";
import {
  DELIVERY_ADAPTER_ID,
  DeliveryEngine,
  type DeliveryProvider,
  type GithubSourceProvider,
} from "./delivery.js";
import type { FoundationOptions } from "./foundation-data.js";
import { FoundationEngine } from "./foundations.js";
import { IncidentEngine, type IncidentNotifier } from "./incidents.js";
import { gateAdmission, setAdmission } from "./infra-admission.js";
import { LocalSystemCollector } from "./infra-collector.js";
import { executeInfrastructure, reconcileInfrastructure } from "./infra-execution.js";
import { infrastructureHeadroom } from "./infra-headroom.js";
import { defaultHeavyPolicy, type HeavyTaskPolicy, heavySlotFree } from "./infra-heavy.js";
import {
  declareInfrastructure,
  infrastructureOverview,
  refreshInfrastructure,
} from "./infra-inventory.js";
import {
  admitInfrastructure,
  prepareInfrastructure,
  releaseQueuedInfrastructure,
  reserveInfrastructure,
} from "./infra-preparation.js";
import type { InfrastructureCollector, InfrastructureProvider } from "./infra-provider.js";
import { fenceInfrastructure } from "./infra-quarantine.js";
import { markInfrastructureUncertain, settleInfrastructure } from "./infra-settlement.js";
import { INFRA_ADAPTER_ID, type InfrastructureState } from "./infra-state.js";
import { JobEngine, type JobOptions } from "./jobs.js";
import type { Actor } from "./policy.js";
import { ProjectLifecycleEngine } from "./project-lifecycle.js";
import { RECOVERY_ADAPTER_ID, RecoveryEngine, type RecoveryProvider } from "./recovery.js";

export interface InfrastructureOptions {
  foundationConsumer?: FoundationOptions["consumer"];
  now?: () => Date;
  collector?: InfrastructureCollector;
  provider?: InfrastructureProvider;
  leaseMs?: number;
  databaseProvider?: DatabaseProvider;
  recoveryProvider?: RecoveryProvider;
  /** Private role-rotation provider; omitting it keeps rotation honestly unconfigured. */
  rotationProvider?: DatabaseRotationProvider;
  /** Optional external owner notifier; omitting it keeps incident delivery `unconfigured`. */
  incidentNotifier?: IncidentNotifier;
  deliveryProvider?: DeliveryProvider;
  sourceProvider?: GithubSourceProvider;
  /** Explicit local fixtures; omitting them leaves the job engine honestly unconfigured. */
  jobs?: Partial<Omit<JobOptions, "now">>;
  /** Overrides the bounded heavy-task class (tests and tuning); defaults come from the contracts. */
  heavyTasks?: Partial<HeavyTaskPolicy>;
}
/** Server-owned infrastructure boundary; the default has inventory/preparation and no execution authority. */
export class InfrastructureEngine {
  readonly foundation: FoundationEngine;
  readonly database: DatabaseEngine;
  readonly recovery: RecoveryEngine;
  readonly rotation: DatabaseRotationEngine;
  readonly incidents: IncidentEngine;
  readonly delivery: DeliveryEngine;
  readonly jobs: JobEngine;
  readonly lifecycle: ProjectLifecycleEngine;
  private readonly state: InfrastructureState;
  private readonly heavy: HeavyTaskPolicy;
  constructor(store: Store, options: InfrastructureOptions = {}) {
    this.heavy = { ...defaultHeavyPolicy(), ...options.heavyTasks };
    const now = options.now ?? (() => new Date());
    const provider = options.provider;
    this.database = new DatabaseEngine(store, { now, provider: options.databaseProvider });
    this.recovery = new RecoveryEngine(store, { now, provider: options.recoveryProvider });
    this.rotation = new DatabaseRotationEngine(store, { now, provider: options.rotationProvider });
    this.incidents = new IncidentEngine(store, {
      now,
      notifier: options.incidentNotifier,
      sources: {
        backups: (actor) => this.recovery.backups(actor),
        rotations: (actor) => this.rotation.overview(actor),
      },
    });
    this.database.bindProtection(async () => ({
      ...(await this.recovery.protection()),
      rotation: await this.rotation.protection(),
    }));
    this.delivery = new DeliveryEngine(store, {
      now,
      provider: options.deliveryProvider,
      sourceProvider: options.sourceProvider,
    });
    this.jobs = new JobEngine(store, { ...options.jobs, now });
    this.lifecycle = new ProjectLifecycleEngine(store, { now });
    this.foundation = new FoundationEngine(store, {
      consumer: options.foundationConsumer,
      now,
      leaseMs: options.leaseMs,
      delegatedAuthority: async (tx, plan, phase, actor) =>
        (await this.delivery.delegatedAuthority(tx, plan, phase, actor)) ||
        this.jobs.delegatedAuthority(tx, plan, phase, actor),
      claimGate: (tx, plan, runId) => heavySlotFree(tx, this.heavy, plan.command, runId),
      requeueAdmission: (tx, plan, runId) => gateAdmission(this.heavy, tx, plan.command, runId),
      admission: async (tx, plan, runId, actor) => {
        await gateAdmission(this.heavy, tx, plan.command, runId);
        await reserveInfrastructure(this.state, tx, plan, runId, actor);
        await this.database.reserve(tx, plan, runId, actor);
        await this.recovery.reserve(tx, plan, runId, actor);
        await this.delivery.reserve(tx, plan, runId, actor);
      },
      releaseQueued: async (tx, runId) => {
        await releaseQueuedInfrastructure(this.state, tx, runId);
        await this.database.releaseQueued(tx, runId);
        await this.recovery.releaseQueued(tx, runId);
        await this.delivery.releaseQueued(tx, runId);
      },
      settlement: async (tx, runId, status) => {
        await settleInfrastructure(this.state, tx, runId, status);
        await this.database.settlement(tx, runId, status);
        await this.recovery.settlement(tx, runId, status);
        await this.delivery.settlement(tx, runId, status);
      },
      uncertainty: async (tx, runId) => {
        await markInfrastructureUncertain(this.state, tx, runId);
        await this.database.uncertainty(tx, runId);
        await this.recovery.uncertainty(tx, runId);
        await this.delivery.uncertainty(tx, runId);
      },
      approvalPolicy: (input) =>
        [INFRA_ADAPTER_ID, DATABASE_ADAPTER_ID, RECOVERY_ADAPTER_ID, DELIVERY_ADAPTER_ID].includes(
          input.adapterId,
        ),
      adapters: [
        this.database.adapter,
        this.recovery.adapter,
        this.delivery.adapter,
        this.jobs.adapter,
        {
          id: INFRA_ADAPTER_ID,
          get qualified() {
            return provider?.qualified === true;
          },
          execute: (context) => executeInfrastructure(this.state, context),
          reconcile: (context) => reconcileInfrastructure(this.state, context),
          onFenced: (context) => fenceInfrastructure(this.state, context),
        },
      ],
    });
    this.database.bind(this.foundation);
    this.recovery.bind(this.foundation);
    this.delivery.bind(this.foundation);
    this.jobs.bind(this.foundation);
    this.state = {
      store,
      now,
      collector: options.collector ?? new LocalSystemCollector(now),
      provider,
      foundation: this.foundation,
    };
  }
  overview(actor: Actor) {
    return infrastructureOverview(this.state, actor);
  }
  headroom(actor: Actor) {
    return infrastructureHeadroom(this.state, this.heavy, actor);
  }
  setAdmission(actor: Actor, input: SetAdmissionInput, key: string) {
    return setAdmission(this.state, actor, input, key);
  }
  declareInventory(actor: Actor, input: DeclareInventoryInput, key: string) {
    return declareInfrastructure(this.state, actor, input, key);
  }
  refreshInventory(actor: Actor, input: { expectedRevision: number }, key: string) {
    return refreshInfrastructure(this.state, actor, input, key);
  }
  prepare(actor: Actor, input: PrepareInfrastructureInput, key: string) {
    return prepareInfrastructure(this.state, actor, input, key);
  }
  admit(actor: Actor, input: AdmitInfrastructureInput, key: string) {
    return admitInfrastructure(this.state, actor, input, key);
  }
}
export { LocalSystemCollector } from "./infra-collector.js";
export * from "./infra-docker-policy.js";
export * from "./infra-docker-provider.js";
export * from "./infra-docker-transport.js";
export * from "./infra-network.js";
export * from "./infra-policy.js";
export type * from "./infra-provider.js";
