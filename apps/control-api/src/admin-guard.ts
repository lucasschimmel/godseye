import { DomainError } from "@godseye/core";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { Configuration } from "./config.js";
import { clientAddress, isLoopbackAddress } from "./server-config.js";

const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip"] as const;

/**
 * Filesystem-proof administration is a same-host operation. It is refused for any request that
 * crossed a proxy or whose peer is not loopback. When the peer cannot be determined it is refused
 * in server mode and tolerated in local mode, where the only listener is bound to loopback.
 */
export function assertLoopbackAdministration(context: Context, config: Configuration) {
  const peer = context.env ? getConnInfo(context).remote.address : undefined;
  const proxied = PROXY_HEADERS.some((name) => context.req.header(name) !== undefined);
  const client = clientAddress(peer, context.req.header("x-forwarded-for"), config.trustedProxies);
  const refused =
    proxied || (client === undefined ? config.mode === "server" : !isLoopbackAddress(client));
  if (refused)
    throw new DomainError(
      "LOCAL_ADMIN_FORBIDDEN",
      "Owner administration is only available from the local host",
      403,
    );
}
