import type { PlatformBuildsView, PlatformBuildView } from "@godseye/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlatformBuildsBody } from "../apps/console/src/components/platform-builds-panel";
import {
  buildBadge,
  formatDuration,
  hasRunningBuild,
  safeBuildUrl,
} from "../apps/console/src/lib/platform-builds";

const START = "2026-11-16T11:55:00.000Z";
const NOW_MS = new Date("2026-11-16T12:00:05.000Z").getTime();

const build = (number: number, patch: Partial<PlatformBuildView> = {}): PlatformBuildView => ({
  number,
  result: "SUCCESS",
  building: false,
  startedAt: START,
  durationMs: 61_000,
  branch: null,
  commitSha: null,
  url: `http://10.20.1.10:8080/job/godseye-platform/${number}/`,
  ...patch,
});
const connected = (builds: PlatformBuildView[]): PlatformBuildsView => ({
  state: "connected",
  observedAt: "2026-11-16T12:00:00.000Z",
  jobs: [
    { name: "godseye-platform", state: "observed", builds },
    { name: "godseye-platform-candidate", state: "unavailable", reason: "TIMEOUT" },
  ],
});
const render = (data: PlatformBuildsView) =>
  renderToStaticMarkup(createElement(PlatformBuildsBody, { data, nowMs: NOW_MS }));

describe("platform builds panel", () => {
  it("shows a running build as in progress with elapsed time, never as a success", () => {
    const html = render(
      connected([build(7, { result: null, building: true, durationMs: null, branch: "feat/x" })]),
    );
    expect(html).toContain("En cours");
    expect(html).toContain("en cours depuis 5 min 05 s");
    expect(html).toContain("feat/x");
    expect(html).not.toContain("Réussi");
  });

  it("shows finished builds with their result and recorded duration", () => {
    const html = render(connected([build(3), build(2, { result: "FAILURE", durationMs: 4_000 })]));
    expect(html).toContain("Réussi");
    expect(html).toContain("Échec");
    expect(html).toContain("1 min 01 s");
  });

  it("names an unavailable job with its reason instead of an empty history", () => {
    expect(render(connected([build(1)]))).toContain("Jenkins n’a pas répondu à temps");
  });

  it("states an empty history explicitly", () => {
    expect(render(connected([]))).toContain("Aucun build enregistré");
  });

  it("states that local mode is not connected and lists no build", () => {
    const html = render({ state: "not_connected", reason: "LOCAL_MODE" });
    expect(html).toContain("Non raccordé");
    expect(html).not.toContain("<table");
  });
});

describe("platform builds helpers", () => {
  it("polls only while a build is running", () => {
    expect(hasRunningBuild(connected([build(1, { result: null, building: true })]))).toBe(true);
    expect(hasRunningBuild(connected([build(1)]))).toBe(false);
    expect(hasRunningBuild({ state: "not_connected", reason: "LOCAL_MODE" })).toBe(false);
    expect(hasRunningBuild(undefined)).toBe(false);
  });

  it("treats a missing result as running", () => {
    expect(buildBadge({ building: false, result: null }).label).toBe("En cours");
  });

  it("formats durations compactly", () => {
    expect(formatDuration(42_000)).toBe("42 s");
    expect(formatDuration(3_725_000)).toBe("1 h 02 min");
  });

  it("refuses links with credentials or non-web schemes", () => {
    expect(safeBuildUrl("http://user:pw@host/")).toBeNull();
    expect(safeBuildUrl("javascript:alert(1)")).toBeNull();
    expect(safeBuildUrl("http://10.20.1.10:8080/job/a/1/")).toBe("http://10.20.1.10:8080/job/a/1/");
  });
});
