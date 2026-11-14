import type { DatabaseAccess } from "@godseye/store";
/** Only trusted in-process orchestration may supply this seam. It is revalidated under write(). */
export interface DelegatedTask {
  taskId: string;
  authorize(tx: DatabaseAccess): Promise<void>;
}
