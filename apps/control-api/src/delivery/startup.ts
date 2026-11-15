import type { InfrastructureOptions } from "@godseye/core";
import { type DomainTarget, ManagedDeliveryProvider } from "@godseye/core";
import { z } from "zod";
import { readPrivateJson, readPrivateText } from "../private-json.js";
import { JenkinsBuildBackend } from "./build-backend.js";
import { FileRouteStore } from "./caddy-routes.js";
import { execCommandRunner } from "./command-runner.js";
import { createDnsResolver } from "./dns-resolver.js";
import { DockerRuntime } from "./docker-runtime.js";
import { DOMAIN_ROUTE_SUFFIX } from "./domain-routes.js";
import { createGithubSourceProvider } from "./github-app-auth.js";
import { JenkinsClient } from "./jenkins-client.js";
import { RegistryClient } from "./registry-client.js";
import { DockerJenkinsTransport } from "./transport.js";

const Path = z.string().min(1).max(512);
const Host = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/);
const Origin = z.string().url().max(256);
const Github = z.object({ issuer: z.string().min(1).max(64), privateKeyPath: Path }).strict();
const Delivery = z
  .object({
    provider: z
      .object({
        providerId: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/),
        targetId: z.string().uuid(),
        version: z.string().min(1).max(100),
        generation: z.number().int().positive(),
        appDomain: Host,
      })
      .strict(),
    jenkins: z
      .object({
        baseUrl: Origin,
        user: z.string().min(1).max(64),
        tokenPath: Path,
        jobName: z.string().min(1).max(100),
      })
      .strict(),
    registry: z
      .object({
        baseUrl: Origin,
        repositoryPrefix: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
        credentialsPath: Path.optional(),
      })
      .strict(),
    /** Where owners point custom names: a CNAME target and/or the public IPv4 of the edge. */
    domains: z
      .object({
        cnameTarget: Host,
        publicIpv4: z.array(z.ipv4()).min(1).max(4),
        resolvers: z
          .array(z.union([z.ipv4(), z.ipv6()]))
          .max(4)
          .optional(),
      })
      .strict()
      .optional(),
    runtime: z
      .object({
        caddyContainer: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
        routeDirectory: Path,
        containerPort: z.number().int().min(1024).max(65535).optional(),
      })
      .strict(),
  })
  .strict();
const RegistryCredentials = z.object({ user: z.string(), password: z.string() }).strict();

export interface ConfiguredDelivery {
  sourceProvider?: ReturnType<typeof createGithubSourceProvider>;
  deliveryProvider?: ManagedDeliveryProvider;
  /** Present only when the binding declares `domains`; otherwise custom domains stay unconfigured. */
  domains?: NonNullable<InfrastructureOptions["domains"]>;
}
/**
 * Optional private adapters. Without GODSEYE_GITHUB_APP_BINDING / GODSEYE_DELIVERY_BINDING (absolute
 * paths to private files, rendered by OpenBao) the engine stays honestly unconfigured. The provider
 * never self-qualifies: qualification is `null` until an independent attestation is supplied.
 */
export function configuredDelivery(env: NodeJS.ProcessEnv): ConfiguredDelivery {
  const result: ConfiguredDelivery = {};
  if (env.GODSEYE_GITHUB_APP_BINDING) {
    const binding = Github.parse(readPrivateJson(env.GODSEYE_GITHUB_APP_BINDING));
    result.sourceProvider = createGithubSourceProvider({
      issuer: binding.issuer,
      privateKeyPem: readPrivateText(binding.privateKeyPath),
    });
  }
  if (env.GODSEYE_DELIVERY_BINDING) {
    const binding = Delivery.parse(readPrivateJson(env.GODSEYE_DELIVERY_BINDING));
    const credentials = binding.registry.credentialsPath
      ? RegistryCredentials.parse(readPrivateJson(binding.registry.credentialsPath))
      : undefined;
    const registry = new RegistryClient({
      baseUrl: binding.registry.baseUrl,
      repositoryPrefix: binding.registry.repositoryPrefix,
      ...(credentials ? { basicAuth: credentials } : {}),
    });
    const jenkins = new JenkinsClient({
      baseUrl: binding.jenkins.baseUrl,
      user: binding.jenkins.user,
      apiToken: readPrivateText(binding.jenkins.tokenPath).trim(),
      jobName: binding.jenkins.jobName,
    });
    const runtime = new DockerRuntime({
      registry,
      routes: new FileRouteStore(binding.runtime.routeDirectory),
      domainRoutes: new FileRouteStore(binding.runtime.routeDirectory, DOMAIN_ROUTE_SUFFIX),
      run: execCommandRunner,
      caddyContainer: binding.runtime.caddyContainer,
      appDomain: binding.provider.appDomain,
      ...(binding.runtime.containerPort ? { containerPort: binding.runtime.containerPort } : {}),
    });
    if (binding.domains) {
      const target: DomainTarget = {
        cname: binding.domains.cnameTarget,
        ipv4: binding.domains.publicIpv4,
        platformDomain: binding.provider.appDomain,
      };
      result.domains = {
        resolver: createDnsResolver(binding.domains.resolvers),
        target,
        publisher: {
          publish: ({ environmentId, hostnames }) =>
            runtime.publishDomains(environmentId, hostnames),
        },
      };
    }
    const { appDomain, ...provider } = binding.provider;
    result.deliveryProvider = new ManagedDeliveryProvider(
      { ...provider, previewDomain: appDomain },
      new DockerJenkinsTransport(new JenkinsBuildBackend(jenkins, registry), runtime),
    );
  }
  return result;
}
