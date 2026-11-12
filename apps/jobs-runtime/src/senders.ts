import type { OutboxSender } from "@godseye/core";
import { z } from "zod";
import type { LocalInngestCell } from "../../control-api/src/inngest-config.js";
import type { createCellBroker } from "./broker.js";
import type { WorkerChild } from "./child.js";

interface SenderCell {
  config: LocalInngestCell;
  worker?: WorkerChild;
  broker: Pick<ReturnType<typeof createCellBroker>, "outbox">;
}
/** Registry entries dispatch through their own cell capability, never application code in the supervisor. */
export function registerWorkerSenders(
  cell: SenderCell,
  cells: SenderCell[],
  senders: Map<string, OutboxSender>,
) {
  for (const descriptor of cell.worker?.senders ?? []) {
    const previous = senders.get(descriptor.destination);
    senders.set(descriptor.destination, {
      dedupesByEffectKey: descriptor.dedupesByEffectKey && (previous?.dedupesByEffectKey ?? true),
      send: async (delivery, signal) => {
        const target = cells.find(
          ({ config }) =>
            config.projectId === delivery.projectId &&
            config.environmentId === delivery.environmentId,
        );
        if (!target) throw new Error("Outbox destination does not belong to a managed cell");
        return z
          .discriminatedUnion("status", [
            z
              .object({ status: z.literal("delivered"), evidenceRef: z.string().optional() })
              .strict(),
            z.object({ status: z.literal("rejected"), reason: z.string().max(240) }).strict(),
            z.object({ status: z.literal("unknown") }).strict(),
          ])
          .parse(await target.broker.outbox(delivery, false, signal));
      },
      inspect: async (delivery, signal) => {
        const target = cells.find(
          ({ config }) =>
            config.projectId === delivery.projectId &&
            config.environmentId === delivery.environmentId,
        );
        if (!target) throw new Error("Outbox probe does not belong to a managed cell");
        return z
          .enum(["delivered", "absent", "unknown"])
          .parse(await target.broker.outbox(delivery, true, signal));
      },
    });
  }
}
