import type { NotificationAttemptView } from "@godseye/contracts";
import { describe, expect, it } from "vitest";
import { attemptText, failureLabels } from "../apps/console/src/lib/notification-attempts";

const attempt = (partial: Partial<NotificationAttemptView>): NotificationAttemptView => ({
  state: "never",
  at: null,
  reason: null,
  httpStatus: null,
  attempts: 0,
  ...partial,
});
const AT = "2026-11-16T12:00:00.000Z";

describe("notification attempt wording", () => {
  it("says a channel was never tested instead of implying it works", () => {
    expect(attemptText(attempt({}), "test")).toBe("Jamais testé.");
  });

  it("calls a test confirmed only for a recorded 2xx and states what that proves", () => {
    const text = attemptText(
      attempt({ state: "confirmed", at: AT, httpStatus: 204, attempts: 1 }),
      "test",
    );
    expect(text).toMatch(/confirmé.*HTTP 204.*pas qu’une personne l’a lue/);
  });

  it("states nothing was confirmed after a failed test", () => {
    const text = attemptText(
      attempt({ state: "failed", at: AT, reason: "SERVER_ERROR", httpStatus: 500, attempts: 2 }),
      "test",
    );
    expect(text).toMatch(/échec.*Rien n’a été confirmé/);
  });

  it("never uses the word confirmed for an unknown result", () => {
    const text = attemptText(
      attempt({ state: "unknown", at: AT, reason: "TIMED_OUT", attempts: 2 }),
      "incident",
    );
    expect(text).toMatch(/inconnu.*rien n’est confirmé/);
    expect(text).not.toMatch(/en échec|confirmé le/);
  });

  it("labels every failure reason in French", () => {
    expect(Object.values(failureLabels).every((label) => label.length > 3)).toBe(true);
  });
});
