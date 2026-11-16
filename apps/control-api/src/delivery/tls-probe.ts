import { isIPv4 } from "node:net";
import { connect } from "node:tls";
import { type CertificateProbe, DomainError } from "@godseye/core";

/** Bound on one handshake so an unresponsive edge cannot stall the owner overview. */
const HANDSHAKE_TIMEOUT_MS = 3000;
const HTTPS_PORT = 443;

export interface TlsProbeOptions {
  port?: number;
  timeoutMs?: number;
}

/**
 * Handshake-only certificate read: connects to the platform edge address with the registered host as
 * SNI and reads the leaf certificate's not-after date. Chain validation is intentionally off because
 * the goal is to report an expired certificate, not to refuse it; no request is sent and no data is
 * exchanged after the handshake. The address must be an IPv4 literal from the platform binding, so a
 * hostname can never steer the connection elsewhere.
 */
export function createTlsProbe(options: TlsProbeOptions = {}): CertificateProbe {
  const port = options.port ?? HTTPS_PORT;
  const timeoutMs = options.timeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  return {
    inspect: ({ hostname, edgeAddress }) =>
      new Promise((resolve, reject) => {
        if (!isIPv4(edgeAddress)) {
          reject(new DomainError("INVALID_EDGE", "Edge address must be an IPv4 literal", 500));
          return;
        }
        const socket = connect({
          host: edgeAddress,
          port,
          servername: hostname,
          // The certificate is only read, never trusted; an expired one must still be observable.
          rejectUnauthorized: false,
          timeout: timeoutMs,
        });
        socket.once("secureConnect", () => {
          const certificate = socket.getPeerCertificate();
          socket.end();
          const notAfter = certificate?.valid_to ? new Date(certificate.valid_to) : null;
          resolve({ notAfter });
        });
        socket.once("timeout", () => {
          socket.destroy();
          reject(new Error("TLS handshake timed out"));
        });
        socket.once("error", reject);
      }),
  };
}
