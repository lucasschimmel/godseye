import { describe, expect, it } from "vitest";
import { ApplicationError } from "../packages/app-backend/src/contracts.js";
import { openApplicationStore } from "../packages/app-backend/src/store.js";
import { applicationPoolConfig } from "../packages/app-backend/src/store-connection.js";

const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
const URL_OK = "postgresql://api_role:s3cret%2Fpw@10.20.0.5:5433/app";

describe("application store connection policy", () => {
  it("requires verified TLS for any non-loopback endpoint", () => {
    expect(() => applicationPoolConfig(URL_OK, undefined, 5)).toThrow(ApplicationError);
    expect(applicationPoolConfig("postgresql://u:p@127.0.0.1:5432/app", undefined, 5)).toEqual({
      connectionString: "postgresql://u:p@127.0.0.1:5432/app",
      max: 5,
    });
  });
  it("builds a verify-full style configuration from a plain URL", () => {
    const config = applicationPoolConfig(URL_OK, { ca: CA, servername: "cell.internal" }, 3);
    expect(config).toMatchObject({
      host: "10.20.0.5",
      port: 5433,
      user: "api_role",
      password: "s3cret/pw",
      database: "app",
      max: 3,
      ssl: { ca: CA, rejectUnauthorized: true, servername: "cell.internal", minVersion: "TLSv1.2" },
    });
  });
  it("defaults the verified server name to the URL host", () => {
    const config = applicationPoolConfig(URL_OK, { ca: CA }, 1);
    expect((config.ssl as { servername: string }).servername).toBe("10.20.0.5");
  });
  it.each([
    ["sslmode override", `${URL_OK}?sslmode=disable`],
    ["fragment", `${URL_OK}#x`],
    ["missing password", "postgresql://api_role@10.20.0.5:5433/app"],
    ["unsafe database name", "postgresql://u:p@10.20.0.5:5433/a%20b"],
    ["wrong protocol", "mysql://u:p@10.20.0.5:5433/app"],
  ])("rejects %s with verified TLS", (_name, url) => {
    expect(() => applicationPoolConfig(url, { ca: CA }, 1)).toThrow(ApplicationError);
  });
  it("rejects a non-PEM CA", () => {
    expect(() => applicationPoolConfig(URL_OK, { ca: "not a certificate" }, 1)).toThrow(
      ApplicationError,
    );
  });
  it("rejects option combinations that cannot be honored", async () => {
    const scope = { projectId: crypto.randomUUID(), environmentId: crypto.randomUUID() };
    await expect(
      openApplicationStore({ scope, migrationDatabaseUrl: URL_OK, dataDir: "memory://" }),
    ).rejects.toThrow("need a database URL");
    await expect(
      openApplicationStore({
        scope,
        databaseUrl: URL_OK,
        migrationDatabaseUrl: URL_OK,
        tls: { ca: CA },
      }),
    ).rejects.toThrow("must differ");
  });
});
