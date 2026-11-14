import { z } from "zod";
import { LOCAL_DEFAULTS } from "./config.js";
import {
  CONTROL_API_HEADER,
  CONTROL_API_VERSION,
  CONTROL_HTTP_ENDPOINTS,
  type ControlEndpoint,
  endpointParameters,
} from "./http-endpoints.js";
import { ControlErrorResponse, HttpSchemas, IdempotencyKey } from "./http-schemas.js";

type JsonSchema = z.core.JSONSchema.JSONSchema;
interface Parameter {
  name: string;
  in: "header" | "path" | "query";
  required: boolean;
  schema: JsonSchema;
  description?: string;
}
interface InlineResponse {
  description: string;
  headers: {
    [CONTROL_API_HEADER]: { schema: { type: "string"; const: typeof CONTROL_API_VERSION } };
  };
  content: Record<string, { schema: JsonSchema }>;
}
type ApiResponse = InlineResponse | { $ref: string };
interface Operation {
  operationId: string;
  description: string;
  parameters: Parameter[];
  security: Record<string, never[]>[];
  responses: Record<string, ApiResponse>;
  requestBody?: { required: true; content: { "application/json": { schema: JsonSchema } } };
  externalDocs?: { url: string; description: string };
  "x-godseye-event-schema"?: JsonSchema;
}
function jsonSchema(schema: z.ZodType, io: "input" | "output" = "output") {
  const { $schema: _schema, ...result } = z.toJSONSchema(schema, { io });
  return result;
}
function response(description: string, schema: JsonSchema): InlineResponse {
  return {
    description,
    headers: { [CONTROL_API_HEADER]: { schema: { type: "string", const: CONTROL_API_VERSION } } },
    content: { "application/json": { schema } },
  };
}
function operation(endpoint: ControlEndpoint): Operation {
  const parameters: Parameter[] = endpointParameters(endpoint).map(({ name, schema }) => ({
    name,
    in: "path",
    required: true,
    schema: jsonSchema(schema, "input"),
  }));
  if (endpoint.query) {
    const query = jsonSchema(endpoint.query, "input");
    const required = new Set(query.required ?? []);
    for (const [name, schema] of Object.entries(query.properties ?? {}))
      parameters.push({
        name,
        in: "query",
        required: required.has(name),
        schema: typeof schema === "boolean" ? {} : schema,
      });
  }
  parameters.push({
    name: CONTROL_API_HEADER,
    in: "header",
    required: false,
    schema: { type: "string", const: CONTROL_API_VERSION },
    description: "When supplied, must match the supported control API version.",
  });
  if (endpoint.idempotent)
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: jsonSchema(IdempotencyKey, "input"),
    });
  if (endpoint.operationId === "exportAudit")
    parameters.push(
      {
        name: "cursor",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 },
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 1000, default: 100 },
      },
    );
  const names = {
    public: null,
    owner: "ownerSession",
    "local-proof": "localProof",
    "github-signature": "githubSignature",
  } as const;
  const security = names[endpoint.access];
  const result: Operation = {
    operationId: endpoint.operationId,
    description:
      endpoint.access === "owner"
        ? "Private owner control operation. Requires the server-verified owner session; this is not an application project SDK endpoint."
        : "Explicit public status or externally authenticated integration boundary.",
    parameters,
    security: security ? [{ [security]: [] }] : [],
    responses: {
      [endpoint.success]: response(
        "Successful owner control response",
        jsonSchema(endpoint.response),
      ),
    },
  };
  for (const status of [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503])
    result.responses[String(status)] = { $ref: "#/components/responses/ControlError" };
  if (endpoint.request)
    result.requestBody = {
      required: true,
      content: { "application/json": { schema: jsonSchema(endpoint.request, "input") } },
    };
  if (endpoint.transport) {
    const media = endpoint.transport === "sse" ? "text/event-stream" : "text/plain";
    result.responses[endpoint.success] = {
      ...response("Private bounded streaming or attachment response", { type: "string" }),
      content: { [media]: { schema: { type: "string" } } },
    };
    if (endpoint.transport === "sse") {
      result["x-godseye-event-schema"] = jsonSchema(endpoint.response);
      parameters.push({
        name: "after",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      });
      parameters.push({
        name: "Last-Event-ID",
        in: "header",
        required: false,
        schema: { type: "string", pattern: "^(0|[1-9][0-9]{0,15})$" },
      });
    }
  }
  if (endpoint.access === "local-proof") {
    parameters.push(
      {
        name: "x-godseye-time",
        in: "header",
        required: true,
        schema: { type: "string", pattern: "^[0-9]{13}$" },
      },
      {
        name: "x-godseye-nonce",
        in: "header",
        required: true,
        schema: { type: "string", pattern: "^[a-f0-9]{32}$" },
      },
    );
    result.description =
      "Local CLI administration only. HMAC covers method, path, timestamp, nonce and exact body digest. A valid proof is consumed once; a browser session is insufficient.";
  }
  if (endpoint.access === "github-signature") {
    parameters.push(
      {
        name: "X-GitHub-Event",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 1, maxLength: 100 },
      },
      {
        name: "X-GitHub-Delivery",
        in: "header",
        required: true,
        schema: { type: "string", pattern: "^[A-Za-z0-9-]{8,128}$" },
      },
    );
    result.description =
      "GitHub native webhook payload, authenticated over exact raw bytes. Only matching branch push events queue intentions; no deployment is implied. Payload shape belongs to GitHub and is not a permissive first-party DTO.";
    result.externalDocs = {
      url: "https://docs.github.com/en/webhooks/webhook-events-and-payloads",
      description: "GitHub native webhook payload contract",
    };
  }
  return result;
}

/** Deterministic generated contract: no environment values, secrets, timestamps or provider observations. */
export function createControlOpenApi() {
  const paths: Record<string, Record<string, Operation>> = {};
  for (const endpoint of CONTROL_HTTP_ENDPOINTS) {
    const path = (
      endpoint.path === "/hooks/github"
        ? endpoint.path
        : `${LOCAL_DEFAULTS.apiBase}${endpoint.path}`
    ).replace(/:([A-Za-z]+)/g, "{$1}");
    const methods = paths[path] ?? {};
    methods[endpoint.method.toLowerCase()] = operation(endpoint);
    paths[path] = methods;
  }
  paths[`${LOCAL_DEFAULTS.apiBase}/openapi.json`] = {
    get: {
      operationId: "controlOpenApi",
      description:
        "Deterministic OpenAPI document for the private owner control surface. Native WebAuthn endpoints under /api/auth are a separately pinned Better Auth protocol.",
      parameters: [],
      security: [{ ownerSession: [] }],
      responses: {
        "200": response("OpenAPI 3.1 document", {
          $ref: "https://spec.openapis.org/oas/3.1/schema/2022-10-07",
        }),
        "401": response("Owner authentication required", jsonSchema(ControlErrorResponse)),
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "G.O.D.S.E.Y.E private owner control API",
      version: CONTROL_API_VERSION,
      description:
        "Local owner administration contract. Infrastructure execution remains gated by qualified adapters. This client is not the application-project SDK (F19).",
    },
    paths,
    components: {
      responses: {
        ControlError: response(
          "Safe control error; no provider details or authentication material",
          { $ref: "#/components/schemas/ControlErrorResponse" },
        ),
      },
      schemas: Object.fromEntries(
        Object.entries(HttpSchemas).map(([name, schema]) => [name, jsonSchema(schema)]),
      ),
      securitySchemes: {
        ownerSession: {
          type: "apiKey",
          in: "cookie",
          name: "godseye-owner.session_token",
          description:
            "HttpOnly owner passkey session cookie; opaque bearer values are never returned as DTOs.",
        },
        localProof: {
          type: "apiKey",
          in: "header",
          name: "x-godseye-proof",
          description: "Local CLI HMAC proof; requires exact timestamp and nonce headers.",
        },
        githubSignature: {
          type: "apiKey",
          in: "header",
          name: "X-Hub-Signature-256",
          description: "GitHub raw-body HMAC-SHA256 signature.",
        },
      },
    },
    "x-godseye-vendor-auth": {
      path: "/api/auth",
      provider: "Better Auth passkey",
      version: "1.7.20",
      docs: "https://better-auth.com/docs/plugins/passkey",
      description:
        "Vendor WebAuthn wire protocol; not described as generic first-party request JSON.",
    },
  };
}
export type ControlOpenApiDocument = ReturnType<typeof createControlOpenApi>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
/** Metadata documents are validated against their deterministic generated snapshot, including all fields. */
export function isControlOpenApiDocument(value: unknown): value is ControlOpenApiDocument {
  return canonical(value) === canonical(createControlOpenApi());
}
