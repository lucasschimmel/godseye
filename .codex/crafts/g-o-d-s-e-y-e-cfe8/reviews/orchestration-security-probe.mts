import { orchestrationFixture } from '../../../../tests/helpers/orchestration-fixture.js';

const f = await orchestrationFixture();
try {
  f.agentProvider.inspectScript = async request => ({ state: 'succeeded', stopped: true, providerRunId: request.providerRunId, output: 'x'.repeat(8192) });
  const oversized = await f.prepare({ steps: [f.research, { ...f.research, id: 'followup', dependsOn: ['research'], includeDependencyOutputs: true }] });
  await f.approve(oversized);
  await f.tick();
  await f.work();
  const other = await f.prepare({steps:[{id:'question',kind:'clarification',question:'Independent plan',answer:'Approved input',dependsOn:[]}]});
  await f.approve(other);
  let failure: unknown = null;
  try { await f.tick(); } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  console.log(JSON.stringify({ scenario: 'bounded dependency overflow isolates one plan', failure, oversizedState: (await f.detail(oversized.plan.id)).state, independentState: (await f.detail(other.plan.id)).state }));
} finally { await f.store.close(); }
