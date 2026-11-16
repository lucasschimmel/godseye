import { createHmac } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import type { NOTIFICATION_FAILURE_REASONS } from "@godseye/contracts";
import { isPublicAddress } from "./notification-address.js";

export type NotificationFailureReason = (typeof NOTIFICATION_FAILURE_REASONS)[number];
export type TransportOutcome =
  | { kind: "response"; status: number }
  /** `sent` is true once the TLS session was established, so the receiver may have processed the body. */
  | { kind: "error"; reason: NotificationFailureReason; sent: boolean };
export interface WebhookRequest {
  url: URL;
  body: string;
  headers: Record<string, string>;
}
/** One bounded HTTPS POST. Implementations never follow redirects and never expose response content. */
export interface WebhookTransport {
  post(request: WebhookRequest): Promise<TransportOutcome>;
}
export interface SendResult {
  state: "confirmed" | "failed" | "unknown";
  reason: NotificationFailureReason | null;
  httpStatus: number | null;
  attempts: number;
}
export interface SendPolicy {
  /** Total attempts per send, first included. */
  maxAttempts: number;
  backoffMs: number;
  sleep: (ms: number) => Promise<void>;
}
/** Two 3 s attempts plus backoff stay inside the incident outbox's 10 s acknowledgement window. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 3000;
export const DEFAULT_SEND_POLICY: SendPolicy = {
  maxAttempts: 2,
  backoffMs: 300,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
const MAX_BODY_BYTES = 8192;
const RETRYABLE: ReadonlySet<NotificationFailureReason> = new Set([
  "CONNECTION_FAILED",
  "TIMED_OUT",
  "DNS_FAILED",
]);

class BlockedTargetError extends Error {
  readonly code = "GODSEYE_TARGET_BLOCKED";
}
function errorCode(error: unknown): string {
  const inner = error instanceof AggregateError ? (error.errors[0] ?? error) : error;
  const code = (inner as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}
/** Maps a Node network error to a fixed reason; the original message (which may name hosts) is dropped. */
export function classifyNetworkError(error: unknown): NotificationFailureReason {
  const code = errorCode(error);
  if (code === "GODSEYE_TARGET_BLOCKED") return "TARGET_BLOCKED";
  if (["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA", "EAI_FAIL"].includes(code)) return "DNS_FAILED";
  if (/^(ERR_TLS_|ERR_SSL_|CERT_|DEPTH_ZERO_|SELF_SIGNED_|UNABLE_TO_|HOSTNAME_MISMATCH)/.test(code))
    return "TLS_FAILED";
  return "CONNECTION_FAILED";
}

type Resolver = typeof dnsLookup;
/**
 * Resolves at connect time and refuses the connection when ANY answer is not a public address.
 * Because the socket connects to the very addresses validated here, DNS rebinding between a
 * separate "check" and "use" step is impossible.
 */
export function guardedLookup(resolve: Resolver = dnsLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      const list = Array.isArray(addresses) ? addresses : [];
      if (!list.length || list.some((entry) => !isPublicAddress(entry.address)))
        return callback(new BlockedTargetError("Target resolves to a non-public address"), "", 0);
      if (options.all) return callback(null, list);
      const [first] = list;
      return callback(null, first?.address ?? "", first?.family ?? 4);
    });
  };
}

export interface HttpsTransportOptions {
  /** Whole-request deadline, covering connect, TLS and the response head. */
  timeoutMs?: number;
  resolve?: Resolver;
  request?: typeof httpsRequest;
}
/** TLS 1.2+ with certificate and hostname verification, standard port, no redirects, no proxy. */
export function httpsTransport(options: HttpsTransportOptions = {}): WebhookTransport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const send = options.request ?? httpsRequest;
  const lookup = guardedLookup(options.resolve);
  return {
    post: ({ url, body, headers }) =>
      new Promise<TransportOutcome>((resolve) => {
        let sent = false;
        let settled = false;
        const finish = (outcome: TransportOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          resolve(outcome);
          request.destroy();
        };
        const request = send(
          {
            protocol: "https:",
            hostname: url.hostname,
            port: 443,
            path: `${url.pathname}${url.search}`,
            method: "POST",
            headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
            lookup,
            agent: false,
            servername: url.hostname,
            minVersion: "TLSv1.2",
            rejectUnauthorized: true,
          },
          (response) => finish({ kind: "response", status: response.statusCode ?? 0 }),
        );
        const deadline = setTimeout(
          () => finish({ kind: "error", reason: "TIMED_OUT", sent }),
          timeoutMs,
        );
        request.on("socket", (socket) => socket.once("secureConnect", () => (sent = true)));
        request.on("error", (error) =>
          finish({ kind: "error", reason: classifyNetworkError(error), sent }),
        );
        request.end(body);
      }),
  };
}

function statusFailure(status: number): NotificationFailureReason {
  if (status >= 300 && status < 400) return "REDIRECT_REFUSED";
  if (status >= 500) return "SERVER_ERROR";
  if (status >= 400) return "REJECTED";
  return "NO_CONFIRMATION";
}
/** HMAC-SHA-256 over `<unix seconds>.<body>`, so a receiver can verify origin and reject replays. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export interface WebhookTarget {
  url: string;
  secret: string | null;
}
/**
 * Delivers one JSON event with bounded retries. `confirmed` means only that the receiver answered
 * 2xx; any attempt that may have reached the receiver without a usable answer makes a final
 * failure `unknown` rather than `failed`. The idempotency key lets receivers drop retries.
 */
export async function sendWebhook(
  transport: WebhookTransport,
  policy: SendPolicy,
  target: WebhookTarget,
  event: Record<string, unknown>,
  idempotencyKey: string,
  now: () => Date,
): Promise<SendResult> {
  const body = JSON.stringify({ source: "godseye", ...event });
  if (Buffer.byteLength(body) > MAX_BODY_BYTES)
    return { state: "failed", reason: "REJECTED", httpStatus: null, attempts: 0 };
  const url = new URL(target.url);
  let ambiguous = false;
  let last: SendResult = {
    state: "failed",
    reason: "NO_CONFIRMATION",
    httpStatus: null,
    attempts: 0,
  };
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const timestamp = String(Math.floor(now().getTime() / 1000));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "godseye-controller",
      "idempotency-key": idempotencyKey,
      "x-godseye-timestamp": timestamp,
      ...(target.secret
        ? { "x-godseye-signature": signWebhook(target.secret, timestamp, body) }
        : {}),
    };
    const outcome = await transport.post({ url, body, headers });
    if (outcome.kind === "response") {
      if (outcome.status >= 200 && outcome.status < 300)
        return { state: "confirmed", reason: null, httpStatus: outcome.status, attempts: attempt };
      last = {
        state: "failed",
        reason: statusFailure(outcome.status),
        httpStatus: outcome.status,
        attempts: attempt,
      };
      if (!(outcome.status === 408 || outcome.status === 429 || outcome.status >= 500)) break;
    } else {
      ambiguous ||= outcome.sent;
      last = { state: "failed", reason: outcome.reason, httpStatus: null, attempts: attempt };
      if (!RETRYABLE.has(outcome.reason)) break;
    }
    if (attempt < policy.maxAttempts) await policy.sleep(policy.backoffMs);
  }
  return ambiguous ? { ...last, state: "unknown" } : last;
}
