import { describe, expect, it } from "vitest";
import {
  activationRequest,
  activationSubmittable,
} from "../apps/console/src/lib/recovery-activation";

const acknowledgements = ["FILES_SNAPSHOT_MISSING", "AUTH_SNAPSHOT_MISSING"] as const;
const ready = {
  assessment: { activation: "ready" as const, requiredAcknowledgements: [...acknowledgements] },
  environmentName: "restauration-controle",
  typedName: "restauration-controle",
  acknowledged: [...acknowledgements],
  fresh: true,
};

describe("restore activation form readiness", () => {
  it("submits when the platform says ready, the owner is fresh and everything is confirmed", () => {
    expect(activationSubmittable(ready)).toBe(true);
  });

  it.each([
    [
      "the platform reports it blocked",
      { assessment: { ...ready.assessment, activation: "blocked" as const } },
    ],
    ["the passkey confirmation is stale", { fresh: false }],
    ["the typed name differs", { typedName: "autre" }],
    ["an acknowledgement is missing", { acknowledged: ["FILES_SNAPSHOT_MISSING"] }],
  ])("stays disabled when %s", (_label, change) => {
    expect(activationSubmittable({ ...ready, ...change })).toBe(false);
  });

  it("sends the exact revisions, the typed name and every required acknowledgement", () => {
    expect(
      activationRequest(ready.assessment, { project: 4, environment: 0 }, "restauration-controle"),
    ).toEqual({
      expectedProjectRevision: 4,
      expectedEnvironmentRevision: 0,
      confirmName: "restauration-controle",
      acknowledged: [...acknowledgements],
    });
  });
});
