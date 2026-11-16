import { z } from "zod";
import { isPublicHostname } from "./domains.js";

const Id = z.string().uuid();
const Moment = z.string().datetime();
const Revision = z.number().int().positive();

/** Owner notification channels a controller can deliver to. Email is intentionally absent: no SMTP contract exists. */
export const NOTIFICATION_CHANNEL_KINDS = ["webhook"] as const;
/** Live (not removed) channels the owner may hold; bounds fan-out and the delivery time budget. */
export const MAX_NOTIFICATION_CHANNELS = 5;
export const MAX_WEBHOOK_URL_LENGTH = 2048;
export const WEBHOOK_SECRET_MIN_LENGTH = 16;
export const WEBHOOK_SECRET_MAX_LENGTH = 200;
/** Only the standard TLS port is reachable; this narrows what a webhook URL can probe. */
export const WEBHOOK_PORT = "443";

/**
 * Why a send did not confirm. These are fixed codes: no remote response text, URL or address is
 * ever stored or returned.
 */
export const NOTIFICATION_FAILURE_REASONS = [
  "TARGET_BLOCKED",
  "DNS_FAILED",
  "CONNECTION_FAILED",
  "TLS_FAILED",
  "TIMED_OUT",
  "REJECTED",
  "REDIRECT_REFUSED",
  "SERVER_ERROR",
  "NO_CONFIRMATION",
] as const;
/** `never` = not attempted; `confirmed` = the receiver answered 2xx; `unknown` = sent without a usable answer. */
export const NOTIFICATION_RESULT_STATES = ["never", "confirmed", "failed", "unknown"] as const;

export type WebhookUrlProblem = "scheme" | "credentials" | "port" | "host" | "fragment" | "syntax";
/** Pure structural check shared by the contract and the service; DNS-level checks happen at send time. */
export function webhookUrlProblem(value: string): WebhookUrlProblem | null {
  if (value.length > MAX_WEBHOOK_URL_LENGTH || hasControlCharacter(value)) return "syntax";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "syntax";
  }
  if (url.protocol !== "https:") return "scheme";
  if (url.username || url.password) return "credentials";
  if (url.port && url.port !== WEBHOOK_PORT) return "port";
  if (url.hash) return "fragment";
  return isPublicHostname(url.hostname) ? null : "host";
}
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}
export const WebhookUrl = z
  .string()
  .trim()
  .superRefine((value, context) => {
    const problem = webhookUrlProblem(value);
    if (problem)
      context.addIssue({
        code: "custom",
        message: `A public https webhook URL on port 443 is required (${problem})`,
      });
  });

export const CreateNotificationChannel = z
  .object({
    kind: z.enum(NOTIFICATION_CHANNEL_KINDS),
    label: z.string().trim().min(1).max(60),
    url: WebhookUrl,
    /** Optional HMAC key the receiver can verify; it is sealed at rest and never returned. */
    signingSecret: z
      .string()
      .min(WEBHOOK_SECRET_MIN_LENGTH)
      .max(WEBHOOK_SECRET_MAX_LENGTH)
      .regex(/^[!-~]+$/)
      .optional(),
  })
  .strict();
export const TestNotificationChannel = z.object({ expectedRevision: Revision }).strict();
export const RemoveNotificationChannel = TestNotificationChannel;
export type CreateNotificationChannelInput = z.input<typeof CreateNotificationChannel>;
export type TestNotificationChannelInput = z.infer<typeof TestNotificationChannel>;
export type RemoveNotificationChannelInput = z.infer<typeof RemoveNotificationChannel>;

export const NotificationAttempt = z
  .object({
    state: z.enum(NOTIFICATION_RESULT_STATES),
    at: Moment.nullable(),
    reason: z.enum(NOTIFICATION_FAILURE_REASONS).nullable(),
    /** HTTP status of the final response when one was received. */
    httpStatus: z.number().int().min(100).max(599).nullable(),
    attempts: z.number().int().min(0).max(5),
  })
  .strict();
export type NotificationAttemptView = z.infer<typeof NotificationAttempt>;

export const NotificationChannel = z
  .object({
    id: Id,
    kind: z.enum(NOTIFICATION_CHANNEL_KINDS),
    label: z.string().max(60),
    /** Display host only. The full URL, its path and any token never leave the controller. */
    host: z.string().max(253),
    signed: z.boolean(),
    revision: Revision,
    /** Latest arrival test requested from the console. */
    test: NotificationAttempt,
    /** Latest incident delivery that used this channel. */
    delivery: NotificationAttempt,
    createdAt: Moment,
  })
  .strict();
export type NotificationChannelView = z.infer<typeof NotificationChannel>;

export const NotificationChannelOverview = z
  .object({
    /** `unavailable` = this controller has no sealing material, so channels cannot be stored. */
    adapter: z.enum(["available", "unavailable"]),
    kinds: z.array(z.enum(NOTIFICATION_CHANNEL_KINDS)).max(4),
    limit: z.number().int().positive(),
    channels: z.array(NotificationChannel).max(MAX_NOTIFICATION_CHANNELS),
  })
  .strict();
export type NotificationChannelOverviewView = z.infer<typeof NotificationChannelOverview>;
