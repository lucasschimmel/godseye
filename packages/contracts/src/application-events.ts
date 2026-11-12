import { z } from "zod";

/** Private service event; never accept a browser-supplied scope or producer identity. */
export const ApplicationJobEnvelope = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    producerId: z.string().uuid(),
    epoch: z.number().int().nonnegative(),
    eventType: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
    userId: z.string().min(1).max(100),
    payload: z.json(),
    occurredAt: z.string().datetime(),
  })
  .strict();
export type ApplicationJobEnvelopeInput = z.infer<typeof ApplicationJobEnvelope>;
export const APPLICATION_JOB_EVENT = "godseye/application.event" as const;
