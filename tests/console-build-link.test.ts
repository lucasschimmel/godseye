import { describe, expect, it } from "vitest";
import { buildLink } from "../apps/console/src/lib/build-link";

describe("build link", () => {
  it("returns a plain https build URL unchanged", () => {
    expect(buildLink("https://jenkins.example.org/job/platform/42/")).toBe(
      "https://jenkins.example.org/job/platform/42/",
    );
  });

  it.each([
    ["no reference", null],
    ["a javascript URL", "javascript:alert(1)"],
    ["plain http", "http://jenkins.example.org/job/1"],
    ["embedded credentials", "https://user:secret@jenkins.example.org/job/1"],
    ["a non-URL string", "build-42"],
  ])("returns null for %s", (_label, reference) => {
    expect(buildLink(reference)).toBeNull();
  });
});
