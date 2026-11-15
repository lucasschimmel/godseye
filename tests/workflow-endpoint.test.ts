import { describe, expect, it } from "vitest";
import { workflowEndpoint } from "../apps/control-api/src/workflow-endpoint.js";
import { validateExternalStorage } from "../apps/jobs-runtime/src/config.js";

const secret = "x".repeat(24);
const pg = (host: string, query = "sslmode=verify-full") =>
  `postgresql://workflow:${secret}@${host}:5432/workflow?${query}`;
const redis = (host: string, scheme = "rediss") => `${scheme}://:${secret}@${host}:6380/0`;

describe("workflowEndpoint", () => {
  it("accepts a private bridge IPv4 address with verified TLS for both stores", () => {
    expect(workflowEndpoint(pg("10.77.1.2"), "postgresql").scope).toBe("private");
    expect(workflowEndpoint(redis("10.77.1.2"), "redis").scope).toBe("private");
  });
  it("accepts a ULA IPv6 literal", () => {
    expect(workflowEndpoint(pg("[fd00:77::2]"), "postgresql").hostKey).toBe("[fd00:77::2]");
  });
  it("accepts an absolute sslrootcert next to verify-full", () => {
    expect(() =>
      workflowEndpoint(
        pg("10.77.1.2", "sslmode=verify-full&sslrootcert=/etc/godseye/ca.crt"),
        "postgresql",
      ),
    ).not.toThrow();
  });
  it.each([
    ["public address", pg("198.51.100.5"), "postgresql"],
    ["DNS name", pg("cache.cells.internal"), "postgresql"],
    [
      "private PostgreSQL without TLS verification",
      pg("10.77.1.2", "sslmode=require"),
      "postgresql",
    ],
    ["private PostgreSQL with sslmode disable", pg("10.77.1.2", "sslmode=disable"), "postgresql"],
    [
      "private PostgreSQL with extra options",
      pg("10.77.1.2", "sslmode=verify-full&options=-c%20x"),
      "postgresql",
    ],
    [
      "relative sslrootcert",
      pg("10.77.1.2", "sslmode=verify-full&sslrootcert=ca.crt"),
      "postgresql",
    ],
    ["private plaintext Redis", redis("10.77.1.2", "redis"), "redis"],
    ["loopback TLS Redis", redis("127.0.0.1"), "redis"],
  ] as const)("rejects %s", (_name, uri, store) => {
    expect(() => workflowEndpoint(uri, store)).toThrow();
  });
  it("keeps loopback plaintext PostgreSQL working", () => {
    expect(workflowEndpoint(pg("127.0.0.1", "sslmode=disable"), "postgresql").scope).toBe(
      "loopback",
    );
  });
});

describe("validateExternalStorage with private bridge cells", () => {
  const entry = (index: number, host: string) => ({
    projectId: crypto.randomUUID(),
    environmentId: crypto.randomUUID(),
    postgresUri: pg(host).replace("/workflow", `/workflow${index}`),
    redisUri: redis(host),
  });
  it("rejects two cells sharing one private Redis instance", () => {
    expect(() => validateExternalStorage([entry(1, "10.77.1.2"), entry(2, "10.77.1.2")])).toThrow();
  });
  it("accepts cells on different private addresses", () => {
    expect(validateExternalStorage([entry(1, "10.77.1.2"), entry(2, "10.77.1.3")])).toHaveLength(2);
  });
});
