import { RepositoryConfiguration, type RepositoryConfigurationInput } from "@godseye/contracts";
import { z } from "zod";
import type {
  GithubSourceEvidence,
  GithubSourceProvider,
  GithubSourceQuery,
} from "./delivery-provider.js";
import { DomainError } from "./errors.js";

/** Server-only auth adapter: paths and installation scope are derived here, never from a browser URL. */
export interface GithubAppTransport {
  get(
    path: string,
    installationId: number,
    authentication: "app" | "installation",
  ): Promise<unknown>;
}
const Repo = z.object({ id: z.number().int().positive(), full_name: z.string() });
const Installation = z.object({
  id: z.number().int().positive(),
  suspended_at: z.string().nullable(),
});
const Head = z.object({
  ref: z.string(),
  object: z.object({ type: z.literal("commit"), sha: z.string().regex(/^[a-f0-9]{40}$/) }),
});
const Pull = z.object({
  number: z.number().int().positive(),
  state: z.enum(["open", "closed"]),
  head: z.object({
    ref: z.string(),
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    repo: Repo.nullable(),
  }),
  base: z.object({ ref: z.string(), repo: Repo }),
});
export class GithubAppSourceProvider implements GithubSourceProvider {
  constructor(
    private readonly transport: GithubAppTransport,
    private readonly now = () => new Date(),
  ) {}
  async resolve(
    bindingInput: RepositoryConfigurationInput,
    queryInput: GithubSourceQuery,
  ): Promise<GithubSourceEvidence> {
    const binding = RepositoryConfiguration.parse(structuredClone(bindingInput));
    const query = z
      .object({
        branch: z.string().min(1).max(200),
        pullRequestNumber: z.number().int().positive().nullable(),
      })
      .strict()
      .parse(structuredClone(queryInput));
    const root = `/repos/${binding.fullName.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const installation = Installation.parse(
        await this.transport.get(`${root}/installation`, binding.installationId, "app"),
      );
      const repository = Repo.parse(
        await this.transport.get(root, binding.installationId, "installation"),
      );
      if (
        installation.id !== binding.installationId ||
        installation.suspended_at !== null ||
        repository.id !== binding.repositoryId ||
        repository.full_name.toLowerCase() !== binding.fullName.toLowerCase()
      )
        throw new Error("Source binding differs");
      if (query.pullRequestNumber !== null) {
        const pull = Pull.parse(
          await this.transport.get(
            `${root}/pulls/${query.pullRequestNumber}`,
            binding.installationId,
            "installation",
          ),
        );
        if (
          pull.number !== query.pullRequestNumber ||
          pull.base.repo.id !== binding.repositoryId ||
          pull.base.repo.full_name.toLowerCase() !== binding.fullName.toLowerCase() ||
          pull.base.ref !== binding.branch ||
          pull.head.ref !== query.branch
        )
          throw new Error("Pull request binding differs");
        return {
          installationId: installation.id,
          repositoryId: repository.id,
          fullName: repository.full_name,
          branch: pull.head.ref,
          commitSha: pull.head.sha,
          pullRequestNumber: pull.number,
          pullRequestOpen: pull.state === "open",
          sameRepository:
            pull.head.repo?.id === binding.repositoryId &&
            pull.head.repo.full_name.toLowerCase() === binding.fullName.toLowerCase(),
          installationActive: true,
          observedAt: this.now().toISOString(),
        };
      }
      if (query.branch !== binding.branch) throw new Error("Branch differs");
      const head = Head.parse(
        await this.transport.get(
          `${root}/git/ref/heads/${query.branch.split("/").map(encodeURIComponent).join("/")}`,
          binding.installationId,
          "installation",
        ),
      );
      if (head.ref !== `refs/heads/${query.branch}`) throw new Error("Exact ref differs");
      return {
        installationId: installation.id,
        repositoryId: repository.id,
        fullName: repository.full_name,
        branch: query.branch,
        commitSha: head.object.sha,
        pullRequestNumber: null,
        pullRequestOpen: false,
        sameRepository: true,
        installationActive: true,
        observedAt: this.now().toISOString(),
      };
    } catch {
      throw new DomainError("SOURCE_UNAVAILABLE", "GitHub App source verification failed", 503);
    }
  }
}
/** No redirects or caller hosts; auth stays in the server-side callback and never enters DTOs. */
export class FetchGithubAppTransport implements GithubAppTransport {
  constructor(
    private readonly authorization: (
      installationId: number,
      mode: "app" | "installation",
    ) => Promise<string>,
    private readonly request = fetch,
  ) {}
  async get(path: string, installationId: number, mode: "app" | "installation") {
    if (
      !/^\/repos\/[A-Za-z0-9%_.-]+\/[A-Za-z0-9%_.-]+(?:\/(?:installation|pulls\/[1-9][0-9]*|git\/ref\/heads\/[A-Za-z0-9%_./-]+))?$/.test(
        path,
      )
    )
      throw new DomainError("FORBIDDEN", "GitHub API path is not allowlisted", 403);
    const response = await this.request(`https://api.github.com${path}`, {
      redirect: "error",
      headers: {
        authorization: `Bearer ${await this.authorization(installationId, mode)}`,
        accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new DomainError("SOURCE_UNAVAILABLE", "GitHub API verification unavailable", 503);
    const reader = response.body?.getReader();
    if (!reader)
      throw new DomainError("SOURCE_UNAVAILABLE", "GitHub API response body is missing", 503);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0,
      text = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1048576) {
          await reader.cancel();
          throw new DomainError("SOURCE_UNAVAILABLE", "GitHub API response exceeds limit", 503);
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text) as unknown;
    } finally {
      reader.releaseLock();
    }
  }
}
