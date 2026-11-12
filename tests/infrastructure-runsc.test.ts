import { beforeAll, describe, expect, it } from "vitest";
import { type RunscLabResult, runscLaboratory } from "./runsc-fixture.js";

describe("explicit real gVisor systrap OCI laboratory", () => {
  let observed: RunscLabResult;
  beforeAll(async () => {
    observed = await runscLaboratory();
  });

  it("T04 executes the pinned systrap runtime as a non-root guest rather than a host-root shell", () => {
    expect(observed.runtime).toBe("release-20261102.0");
    expect(observed.platform).toBe("systrap");
    expect(observed.checksumValidated).toBe(true);
    expect(observed.gvisorMarker).toBe(true);
    expect(observed.nonRootUid).toBe(true);
    expect(observed.guestKernel).not.toBe(observed.hostKernel);
  });

  it("T03 T04 exposes only its own fixture root and enforces a read-only root", () => {
    expect(observed.ownFixtureVisible).toBe(true);
    expect(observed.crossRootDenied).toBe(true);
    expect(observed.readOnlyDenied).toBe(true);
  });

  it("T02 refuses the fixture host's IPv4 and IPv6 loopback listeners with networking disabled", () => {
    expect(observed.networkProbesExecuted).toBe(true);
    expect(observed.hostIpv4ControlReachable).toBe(true);
    expect(observed.hostIpv6ControlReachable).toBe(true);
    expect(observed.hostIpv4Denied).toBe(true);
    expect(observed.hostIpv6Denied).toBe(true);
  });

  it("T05 enforces bounded temporary storage without claiming persistent data or cgroup quotas", () => {
    expect(observed.tmpfsBound).toBe(true);
    expect(observed.cgroupLimitsQualified).toBe(false);
    expect(observed.persistentDataQuotaQualified).toBe(false);
    expect(observed.dockerNetworkQualified).toBe(false);
    expect(observed.signatureVerified).toBe(false);
  });
});
