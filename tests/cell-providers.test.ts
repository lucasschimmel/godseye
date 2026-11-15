import { describe, expect, it } from "vitest";
import {
  HelperSocketExecutor,
  type HelperTransport,
} from "../apps/control-api/src/cell-host-process.js";
import { configuredCellProviders } from "../apps/control-api/src/cell-providers.js";
import { HELPER_NOT_FOUND, HelperError, readCellFile } from "../packages/core/src/cell-host.js";

function transport(reply: string) {
  const requests: string[] = [];
  const fake: HelperTransport = {
    exchange: async (request) => {
      requests.push(request);
      return reply;
    },
  };
  return { requests, fake };
}

describe("configuredCellProviders", () => {
  it("stays unconfigured without a private cell binding", () => {
    expect(configuredCellProviders({})).toBeUndefined();
  });
});

describe("HelperSocketExecutor", () => {
  it("sends one fixed verb with its arguments and payload as a JSON line", async () => {
    const { requests, fake } = transport('{"code":0,"stdout":"ok"}');

    const output = await new HelperSocketExecutor(fake).call("unit", ["a", "start"], {
      stdin: "payload",
    });

    expect(output).toBe("ok");
    expect(JSON.parse(requests[0] ?? "")).toEqual({
      verb: "unit",
      args: ["a", "start"],
      stdin: "payload",
    });
  });
  it("rejects a verb outside the fixed set before touching the socket", async () => {
    const { requests, fake } = transport('{"code":0,"stdout":""}');

    await expect(new HelperSocketExecutor(fake).call("sh" as never, ["-c", "id"])).rejects.toThrow(
      "Invalid private host command",
    );
    expect(requests).toHaveLength(0);
  });
  it("maps a non-zero helper code to a typed error", async () => {
    const { fake } = transport('{"code":44,"stdout":""}');

    const outcome = await new HelperSocketExecutor(fake)
      .call("file-read", ["a", "cell-env"])
      .catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(HelperError);
    expect((outcome as HelperError).code).toBe(HELPER_NOT_FOUND);
  });
  it("reports a missing cell file as null", async () => {
    const { fake } = transport('{"code":44,"stdout":""}');

    await expect(readCellFile(new HelperSocketExecutor(fake), "a", "cell-env")).resolves.toBeNull();
  });
  it("refuses a malformed helper response", async () => {
    const { fake } = transport("not json");

    await expect(new HelperSocketExecutor(fake).call("cells-list", [])).rejects.toThrow(
      "invalid response",
    );
  });
});
