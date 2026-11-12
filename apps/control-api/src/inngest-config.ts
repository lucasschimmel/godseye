import { z } from "zod";

const port = z.number().int().min(1024).max(65535);
export const LocalInngestCell = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    enginePort: port,
    workerPort: port,
    applicationPort: port,
    gatewayPort: port,
    gatewayGrpcPort: port,
    executorGrpcPort: port,
  })
  .strict();
export type LocalInngestCell = z.infer<typeof LocalInngestCell>;
export function parseInngestCells(
  raw: string | undefined,
  reservedPorts: number[] = [],
): LocalInngestCell[] {
  if (raw === undefined) return [];
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("Invalid local Inngest cell JSON");
  }
  const cells = z.array(LocalInngestCell).max(20).parse(input);
  const ports = [
    ...reservedPorts,
    ...cells.flatMap(({ projectId: _project, environmentId: _environment, ...listeners }) =>
      Object.values(listeners),
    ),
  ];
  if (
    new Set(ports).size !== ports.length ||
    new Set(cells.map((cell) => cell.environmentId)).size !== cells.length
  )
    throw new Error(
      "Local Inngest cells require distinct listener ports and environment identities",
    );
  return cells;
}
