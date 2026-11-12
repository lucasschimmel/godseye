import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { ApplicationLimitsInput, ApplicationScopeInput } from "./contracts.js";
import { ApplicationError, ApplicationLimits, ApplicationScope } from "./contracts.js";
import type { ApplicationRouteRegistry } from "./custom.js";
import type { ApplicationStore } from "./store.js";

export interface ApplicationLifecycle {
  available: boolean;
  epoch: number;
}
const OAuthProvider = z
  .object({
    providerId: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
    name: z.string().max(100).optional(),
    clientId: z.string().min(1).max(1000),
    clientSecret: z.string().min(1).max(4096),
    authorizationUrl: z.url(),
    tokenUrl: z.url(),
    userInfoUrl: z.url(),
    scopes: z.array(z.string().max(100)).max(30).optional(),
    tokenEndpointAuth: z
      .object({ method: z.enum(["client_secret_basic", "client_secret_post"]) })
      .strict()
      .optional(),
  })
  .strict();
export type ApplicationOAuthProvider = z.infer<typeof OAuthProvider>;
export interface ApplicationBackendOptions {
  store: ApplicationStore;
  scope: ApplicationScopeInput;
  baseUrl: string;
  trustedOrigins: string[];
  authMaterial: string;
  filesRoot: string;
  registrationEnabled?: boolean;
  lifecycle: () => Promise<ApplicationLifecycle>;
  limits?: ApplicationLimitsInput;
  now?: () => Date;
  oauthProviders?: ApplicationOAuthProvider[];
  routes?: (registry: ApplicationRouteRegistry) => void;
}
export function applicationState(input: ApplicationBackendOptions) {
  const scope = Object.freeze(ApplicationScope.parse(input.scope));
  const base = new URL(input.baseUrl);
  const validOrigin = (value: string) => {
    const url = new URL(value);
    if (
      url.origin !== value ||
      url.username ||
      url.password ||
      url.hostname.includes("*") ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new ApplicationError("INVALID_CONFIGURATION", "Exact HTTP origins are required", 422);
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new ApplicationError(
        "INVALID_CONFIGURATION",
        "Plain HTTP is restricted to loopback",
        422,
      );
    return value;
  };
  validOrigin(input.baseUrl);
  const origins = Object.freeze([
    ...new Set([input.baseUrl, ...input.trustedOrigins.map(validOrigin)]),
  ]);
  if (
    input.authMaterial.length < 32 ||
    input.store.scope.projectId !== scope.projectId ||
    input.store.scope.environmentId !== scope.environmentId
  )
    throw new ApplicationError(
      "INVALID_CONFIGURATION",
      "Independent cell store and private auth material are required",
      422,
    );
  const oauthProviders = z
    .array(OAuthProvider)
    .max(10)
    .parse(input.oauthProviders ?? [])
    .map((provider) => ({
      ...provider,
      pkce: true,
      disableSignUp: input.registrationEnabled === false,
    }));
  if (new Set(oauthProviders.map((provider) => provider.providerId)).size !== oauthProviders.length)
    throw new ApplicationError(
      "INVALID_CONFIGURATION",
      "OAuth provider identifiers must be unique",
      422,
    );
  for (const provider of oauthProviders) {
    if (
      !/^[a-z][a-z0-9-]{0,40}$/.test(provider.providerId) ||
      !provider.clientId ||
      !provider.clientSecret
    )
      throw new ApplicationError(
        "INVALID_CONFIGURATION",
        "OAuth provider authority is incomplete",
        422,
      );
    for (const endpoint of [provider.authorizationUrl, provider.tokenUrl, provider.userInfoUrl]) {
      if (!endpoint)
        throw new ApplicationError(
          "INVALID_CONFIGURATION",
          "Explicit OAuth endpoints are required",
          422,
        );
      const url = new URL(endpoint);
      if (
        url.username ||
        url.password ||
        (url.protocol !== "https:" &&
          !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      )
        throw new ApplicationError(
          "INVALID_CONFIGURATION",
          "OAuth endpoints require HTTPS or local fixtures",
          422,
        );
    }
    provider.pkce = true;
    provider.disableSignUp = input.registrationEnabled === false;
  }
  return {
    store: input.store,
    scope,
    baseUrl: base.origin,
    origins,
    authMaterial: input.authMaterial,
    filesRoot: input.filesRoot,
    registrationEnabled: input.registrationEnabled !== false,
    lifecycle: input.lifecycle,
    limits: ApplicationLimits.parse(input.limits ?? {}),
    now: input.now ?? (() => new Date()),
    oauthProviders,
    closed: false,
    streams: new Set<AbortController>(),
    downloads: new Set<AbortController>(),
    downloadClosers: new Map<AbortController, () => Promise<void>>(),
    requestEpoch: new AsyncLocalStorage<number>(),
  };
}
export type ApplicationState = ReturnType<typeof applicationState>;
export async function guardApplication(state: ApplicationState, expectedEpoch?: number) {
  expectedEpoch ??= state.requestEpoch.getStore();
  const current = await state.lifecycle();
  if (
    state.closed ||
    !state.store.healthy ||
    state.store.recoveryHeld ||
    !current.available ||
    !Number.isSafeInteger(current.epoch) ||
    current.epoch < 0 ||
    (expectedEpoch !== undefined && expectedEpoch !== current.epoch)
  )
    throw new ApplicationError(
      "APPLICATION_UNAVAILABLE",
      "Application is held, suspended, expired or fenced",
      423,
    );
  return current.epoch;
}
