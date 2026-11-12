import type {
  CreateAccessSlotInput,
  CreateServiceIdentityInput,
  ExecutionContext,
} from "@godseye/contracts";
import type { Store } from "@godseye/store";
import { activate, reconcile, stage } from "./access-operations.js";
import { type AccessTaskUse, consume, type PrivateMaterialHandoff } from "./access-redemption.js";
import {
  createIdentity,
  createSlot,
  issueProof,
  overview,
  revokeIdentity,
} from "./access-registry.js";
import { type AccessBrokerOptions, accessState } from "./access-state.js";
import type { Actor } from "./policy.js";

export * from "./access-provider.js";
export type { AccessTaskUse, PrivateMaterialHandoff } from "./access-redemption.js";
export type { AccessBrokerOptions } from "./access-state.js";
export * from "./bao-policy.js";
export * from "./bao-provider.js";

/** Values never enter the owner HTTP surface. Only trusted private consumers receive material. */
export class AccessBroker {
  private readonly state;
  constructor(store: Store, options: AccessBrokerOptions) {
    this.state = accessState(store, options);
  }
  overview(actor: Actor) {
    return overview(this.state, actor);
  }
  createIdentity(actor: Actor, input: CreateServiceIdentityInput, key: string) {
    return createIdentity(this.state, actor, input, key);
  }
  createSlot(actor: Actor, input: CreateAccessSlotInput, key: string) {
    return createSlot(this.state, actor, input, key);
  }
  revokeIdentity(actor: Actor, id: string, expectedRevision: number, key: string) {
    return revokeIdentity(this.state, actor, id, expectedRevision, key);
  }
  issueProof(
    actor: Actor,
    id: string,
    expectedRevision: number,
    key: string,
    deliver: (proof: string) => Promise<void> | void,
  ) {
    return issueProof(this.state, actor, id, expectedRevision, key, deliver);
  }
  stage(
    actor: Actor,
    input: { slotId: string; expectedRevision: number },
    value: string,
    key: string,
  ) {
    return stage(this.state, actor, input, value, key);
  }
  activate(actor: Actor, slotId: string, adapterId: string, expectedRevision: number, key: string) {
    return activate(this.state, actor, slotId, adapterId, expectedRevision, key);
  }
  reconcile(actor: Actor, id: string, key: string) {
    return reconcile(this.state, actor, id, key);
  }
  consumeStatic(proof: string, slotId: string, deliver: PrivateMaterialHandoff) {
    return consume(this.state, proof, slotId, deliver);
  }
  consumeTask(
    proof: string,
    slotId: string,
    context: ExecutionContext,
    use: AccessTaskUse,
    deliver: PrivateMaterialHandoff,
  ) {
    return consume(this.state, proof, slotId, deliver, { context, use });
  }
  /** Private fixed-info recovery consumer only; no mutating grant is renewed. */
  consumeRecoveryInspection(
    proof: string,
    slotId: string,
    context: ExecutionContext,
    use: AccessTaskUse,
    deliver: PrivateMaterialHandoff,
  ) {
    return consume(this.state, proof, slotId, deliver, { context, use, inspection: true });
  }
}
