import { describe, expect, it } from "vitest";
import {
  infrastructureFilesystem,
  infrastructureReason,
} from "../apps/console/src/lib/infra-labels";

describe("infrastructure labels", () => {
  it("does not call the provisioning provider local", () => {
    const text = infrastructureReason(
      "No independently qualified local infrastructure provider is registered",
    );
    expect(text).not.toMatch(/local/i);
  });

  it("names the controller file system without a local qualifier", () => {
    expect(infrastructureFilesystem("Controller working-directory filesystem")).toBe(
      "Système de fichiers du contrôleur",
    );
  });

  it("falls back to a generic admission message for unknown reasons", () => {
    expect(infrastructureReason("something unexpected")).toContain("vérification");
  });
});
