import type { LocalApplicationOptions } from "@godseye/app-backend";
import type { JobHandler, OutboxSender } from "@godseye/core";

export interface ApplicationWorkerModule {
  routes?: LocalApplicationOptions["routes"];
  handlers: ReadonlyMap<string, JobHandler>;
  senders?: ReadonlyMap<string, OutboxSender>;
}
/** Loaded exclusively in its cell process. Modules are owner-selected first-party application code. */
export type CreateApplicationWorker = (input: {
  scope: { projectId: string; environmentId: string };
}) => ApplicationWorkerModule | Promise<ApplicationWorkerModule>;

export const builtinWorker: ApplicationWorkerModule = {
  handlers: new Map([
    [
      "application.archive",
      {
        async execute(context) {
          return context.event
            ? { status: "succeeded", evidenceRef: `application-event:${context.event.id}` }
            : { status: "failed", evidenceRef: "application:event-missing" };
        },
      },
    ],
  ]),
};
