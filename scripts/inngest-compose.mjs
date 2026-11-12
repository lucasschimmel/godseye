import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const image = z.string().regex(/^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
const profile = z
  .object({
    projectId: z.string().uuid(),
    environmentId: z.string().uuid(),
    httpPort: z.number().int().min(1024).max(65535),
    queueWorkers: z.number().int().min(5).max(100).default(10),
    workerUrl: z.url(),
    workerNetwork: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/)
      .optional(),
    images: z.object({ inngest: image, redis: image, postgres: image }).strict(),
    material: z
      .object({
        event: z.string(),
        signing: z.string(),
        postgres: z.string(),
        postgresBootstrap: z.string(),
        redis: z.string(),
      })
      .strict(),
  })
  .strict();

/** Prepared deployment input only. Actual images/material/isolation are qualified on the target later. */
export function compileInngestCell(raw) {
  const input = profile.parse(raw);
  const worker = new URL(input.workerUrl);
  if (
    worker.protocol !== "http:" ||
    worker.username ||
    worker.password ||
    worker.search ||
    worker.hash ||
    !/^worker(?:-[a-z0-9-]+)?$/.test(worker.hostname) ||
    worker.pathname !== "/api/inngest"
  )
    throw new Error(
      "Worker URL must identify its private cell listener, not a host loopback endpoint",
    );
  const materialPaths = Object.values(input.material).map((path) => {
    if (!isAbsolute(path)) throw new Error("Mounted material requires absolute private paths");
    return resolve(path);
  });
  if (
    new Set(materialPaths.map((path) => (process.platform === "win32" ? path.toLowerCase() : path)))
      .size !== materialPaths.length
  )
    throw new Error("Each authority needs independent material");
  const name = `ge-${createHash("sha256").update(`${input.projectId}:${input.environmentId}`).digest("hex").slice(0, 32)}`;
  const workerNetwork = `${name}-worker`;
  if (input.workerNetwork && input.workerNetwork !== workerNetwork)
    throw new Error("Worker network must match this cell's derived network name");
  const common = {
    restart: "unless-stopped",
    security_opt: ["no-new-privileges:true"],
    cap_drop: ["ALL"],
    pids_limit: 256,
    networks: ["cell"],
  };
  const command = `set -eu
read_hex() { value="$$(cat "/run/secrets/$$1")"; case "$$value" in *[!0-9a-f]*|'') exit 64;; esac; [ "$$(printf '%s' "$$value" | wc -c)" -eq 64 ] || exit 64; printf '%s' "$$value"; }
export INNGEST_EVENT_KEY="$$(read_hex event)"
export INNGEST_SIGNING_KEY="$$(read_hex signing)"
export INNGEST_POSTGRES_URI="postgresql://workflow:$$(read_hex postgres)@postgres:5432/workflow?sslmode=disable"
export INNGEST_REDIS_URI="redis://:$$(read_hex redis)@redis:6379/0"
exec /bin/inngest start --host 0.0.0.0 --port 8288 --queue-workers ${input.queueWorkers} --sdk-url '${worker.href.replaceAll("'", "'\\''")}'`;
  const initializeWorkflow = `set -eu
export GODSEYE_WORKFLOW_MATERIAL="$$(cat /run/secrets/postgres)"
case "$$GODSEYE_WORKFLOW_MATERIAL" in *[!0-9a-f]*|'') exit 64;; esac
[ "$$(printf '%s' "$$GODSEYE_WORKFLOW_MATERIAL" | wc -c)" -eq 64 ] || exit 64
psql -X -q -v ON_ERROR_STOP=1 --username "$$POSTGRES_USER" --dbname workflow <<'SQL'
\\getenv workflow_material GODSEYE_WORKFLOW_MATERIAL
CREATE ROLE workflow LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'workflow_material';
ALTER DATABASE workflow OWNER TO workflow;
REVOKE ALL ON DATABASE workflow FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO workflow;
SQL
unset GODSEYE_WORKFLOW_MATERIAL
`;
  return {
    name,
    "x-godseye": {
      projectId: input.projectId,
      environmentId: input.environmentId,
      qualified: false,
      status: "prepared-only",
      composeMinimumVersion: "2.23.1",
      note: "Independent per-cell workflow storage; this configuration does not prove deployed isolation, image validity, encrypted transport or resource enforcement",
    },
    services: {
      inngest: {
        ...common,
        image: input.images.inngest,
        entrypoint: ["/bin/sh", "-ec"],
        command: [command],
        read_only: true,
        tmpfs: ["/tmp:size=67108864,mode=1777"],
        mem_limit: "768m",
        cpus: 1,
        secrets: ["event", "signing", "postgres", "redis"],
        ports: [`127.0.0.1:${input.httpPort}:8288`],
        networks: ["cell", "worker"],
        depends_on: {
          postgres: { condition: "service_healthy" },
          redis: { condition: "service_healthy" },
        },
      },
      postgres: {
        ...common,
        cap_add: ["CHOWN", "FOWNER", "SETUID", "SETGID", "DAC_OVERRIDE"],
        image: input.images.postgres,
        environment: {
          POSTGRES_USER: "workflow_bootstrap",
          POSTGRES_DB: "workflow",
          POSTGRES_PASSWORD_FILE: "/run/secrets/postgresBootstrap",
          PGDATA: "/var/lib/postgresql/godseye/data",
          POSTGRES_INITDB_ARGS: "--auth-host=scram-sha-256",
        },
        secrets: ["postgres", "postgresBootstrap"],
        configs: [
          { source: "workflow-init", target: "/docker-entrypoint-initdb.d/010-workflow.sh" },
        ],
        volumes: ["workflow:/var/lib/postgresql"],
        mem_limit: "512m",
        cpus: 1,
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U workflow_bootstrap -d workflow"],
          interval: "5s",
          timeout: "3s",
          retries: 10,
        },
      },
      redis: {
        ...common,
        image: input.images.redis,
        entrypoint: ["/bin/sh", "-ec"],
        command: [
          'exec redis-server --appendonly yes --appendfsync always --requirepass "$$(cat /run/secrets/redis)" --maxmemory 201326592 --maxmemory-policy noeviction',
        ],
        secrets: ["redis"],
        volumes: ["queue:/data"],
        mem_limit: "256m",
        cpus: 0.5,
        healthcheck: {
          test: [
            "CMD-SHELL",
            'REDISCLI_AUTH="$$(cat /run/secrets/redis)" redis-cli ping | grep -q PONG',
          ],
          interval: "5s",
          timeout: "3s",
          retries: 10,
        },
      },
    },
    networks: { cell: { internal: true }, worker: { external: true, name: workerNetwork } },
    volumes: { workflow: {}, queue: {} },
    configs: { "workflow-init": { content: initializeWorkflow } },
    secrets: Object.fromEntries(
      Object.entries(input.material).map(([key, file]) => [key, { file: resolve(file) }]),
    ),
  };
}

export function compileInngestCells(raw) {
  const inputs = z.array(profile).min(1).max(100).parse(raw);
  const manifests = inputs.map(compileInngestCell);
  const uniqueness = [
    inputs.map((cell) => `${cell.projectId}:${cell.environmentId}`),
    inputs.map((cell) => cell.httpPort),
    manifests.map((cell) => cell.networks.worker.name),
    inputs.flatMap((cell) =>
      Object.values(cell.material).map((path) =>
        process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path),
      ),
    ),
  ];
  if (uniqueness.some((values) => new Set(values).size !== values.length))
    throw new Error("Cells cannot reuse scope, listener, worker network or authority material");
  return manifests;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--help"))
    process.stdout.write(
      "Compile prepared per-cell Compose JSON: node scripts/inngest-compose.mjs input.json output-prefix\nInput is an array of scopes, private worker URLs/networks, loopback HTTP ports, immutable image digests and five distinct private material paths (including a separate PostgreSQL bootstrap authority). No material contents are read. JSON requires Docker Compose2.23.1+ configs.content. Deployment/qualification remains deferred.\n",
    );
  else {
    const [, , input, prefix] = process.argv;
    if (!input || !prefix || process.argv.length !== 4)
      throw new Error("Expected input.json and output-prefix; use --help");
    const manifests = compileInngestCells(JSON.parse(await readFile(input, "utf8")));
    for (const manifest of manifests)
      await writeFile(`${prefix}-${manifest.name}.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
        flag: "wx",
      });
    process.stdout.write(
      `Prepared ${manifests.length} independent cell manifests; no Docker service was started.\n`,
    );
  }
}
