import { z } from "zod";
import { DomainError } from "./errors.js";

const Repository = z.object({ id: z.number().int().positive(), full_name: z.string() });
const Branch = z.string().regex(/^(?!.*\.\.)(?!.*\/\/)(?!.*\/$)[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/);
const Push = z.object({
  repository: Repository,
  installation: z.object({ id: z.number().int().positive() }),
  ref: z.string(),
  after: z.string().regex(/^[a-f0-9]{40}$/),
  deleted: z.boolean(),
});
const Pull = z.object({
  action: z.string(),
  number: z.number().int().positive(),
  repository: Repository,
  installation: z.object({ id: z.number().int().positive() }),
  pull_request: z.object({
    number: z.number().int().positive(),
    head: z.object({
      ref: Branch,
      sha: z.string().regex(/^[a-f0-9]{40}$/),
      repo: Repository.nullable(),
    }),
    base: z.object({ ref: Branch, repo: Repository }),
  }),
});
export interface GithubSourceEvent {
  repositoryId: number;
  installationId: number;
  fullName: string;
  branch: string;
  trackedBranch: string;
  commitSha: string;
  trigger: "push" | "pull_request";
  pullRequestNumber: number | null;
  action: string | null;
}
export function parseGithubEvent(event: string, rawBody: Uint8Array): GithubSourceEvent | null {
  if (event !== "push" && event !== "pull_request") return null;
  try {
    const json: unknown = JSON.parse(Buffer.from(rawBody).toString("utf8"));
    if (event === "push") {
      const push = Push.parse(json);
      if (push.deleted) return null;
      if (/^0{40}$/.test(push.after)) throw new Error("Missing push head");
      if (!push.ref.startsWith("refs/heads/")) return null;
      const branch = Branch.parse(push.ref.slice("refs/heads/".length));
      return {
        repositoryId: push.repository.id,
        installationId: push.installation.id,
        fullName: push.repository.full_name,
        branch,
        trackedBranch: branch,
        commitSha: push.after,
        trigger: "push",
        pullRequestNumber: null,
        action: null,
      };
    }
    const pull = Pull.parse(json),
      pr = pull.pull_request;
    if (/^0{40}$/.test(pr.head.sha)) throw new Error("Missing pull request head");
    if (!["opened", "synchronize", "reopened", "closed"].includes(pull.action)) return null;
    if (
      pull.number !== pr.number ||
      pr.base.repo.id !== pull.repository.id ||
      pr.base.repo.full_name.toLowerCase() !== pull.repository.full_name.toLowerCase() ||
      pr.head.repo?.id !== pull.repository.id ||
      pr.head.repo.full_name.toLowerCase() !== pull.repository.full_name.toLowerCase()
    )
      return null;
    return {
      repositoryId: pull.repository.id,
      installationId: pull.installation.id,
      fullName: pull.repository.full_name,
      branch: pr.head.ref,
      trackedBranch: pr.base.ref,
      commitSha: pr.head.sha,
      trigger: "pull_request",
      pullRequestNumber: pull.number,
      action: pull.action,
    };
  } catch {
    throw new DomainError(
      "INVALID_DELIVERY",
      "GitHub delivery does not match the expected schema",
      400,
    );
  }
}
