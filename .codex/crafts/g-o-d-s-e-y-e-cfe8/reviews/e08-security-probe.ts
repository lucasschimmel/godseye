import { randomUUID } from 'node:crypto';
import { openStore, schema } from '../../../../packages/store/src/index.js';
import { deliverIncidents } from '../../../../packages/core/src/incidents-delivery.js';
import { e08ObservabilityFixture } from '../../../../tests/helpers/e08-observability.js';

const store = await openStore();
const now = new Date('2026-11-14T12:00:00.000Z');
const ids = [randomUUID(), randomUUID()];
let deliveries = 0;
try {
  for (const [index, id] of ids.entries()) {
    await store.db.insert(schema.incidents).values({ id, key: `review:${id}`, kind: 'health', severity: 'warning', projectId: null, environmentId: null, allocationId: null, subject: null, state: 'open', reason: 'SYNTHETIC', summary: 'Synthetic review fixture', occurrences: 1, revision: 1, mutedUntil: index === 0 ? new Date(now.getTime() + 60000) : null, resolution: null, deliveryState: 'pending', deliveryAttempts: 0, deliveryAttemptedAt: null, firstRaisedAt: now, lastRaisedAt: now, acknowledgedAt: null, resolvedAt: null });
    await store.db.insert(schema.incidentOutbox).values({id: randomUUID(), incidentId: id, payloadKey: `review:${id}`, state: 'pending', attempts: 0, claimId: null, claimedAt: null, updatedAt: now, receipt: null});
  }
  const notifier = { notify: async () => { deliveries++; return { state: 'notified' as const }; } };
  await deliverIncidents(store, () => now, notifier);
  await deliverIncidents(store, () => now, notifier);
  console.log(JSON.stringify({probe: 'muted-first-starvation', deliveries, expectedEligibleDeliveries: 1}));
} finally { await store.close(); }

const f = await e08ObservabilityFixture();
try {
  const source = await f.register();
  await f.engine.ingest(f.service, source.id, f.event({event: 'accounting.unknown', state: 'degraded'}), randomUUID());
  await f.infrastructure.incidents.evaluateSystem();
  const key = `telemetry:accounting:${source.id}`;
  const before = (await f.infrastructure.incidents.overview(f.freshOwner())).incidents.find(i => i.key === key);
  await f.engine.ingest(f.service, source.id, f.event({state: 'unknown'}), randomUUID());
  f.clock.advance(6000);
  await f.infrastructure.incidents.evaluateSystem();
  const after = (await f.infrastructure.incidents.overview(f.freshOwner())).incidents.find(i => i.key === key);
  console.log(JSON.stringify({probe: 'stale-accounting-false-clear', before: before?.state, after: after?.state, resolution: after?.resolution}));
  f.clock.advance(8 * 86400000);
  await f.engine.prune(f.freshOwner());
  const retained = await f.store.db.select().from(schema.telemetryRecords);
  const visible = await f.engine.logs(f.freshOwner());
  console.log(JSON.stringify({probe: 'expired-full-log-retained', retainedRows: retained.length, retainedEvent: retained[0]?.data.event, visibleRows: visible.records.length, advertisedRetentionDays: visible.retentionDays}));
} finally { await f.store.close(); }
