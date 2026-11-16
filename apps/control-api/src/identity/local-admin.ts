import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DomainError, write } from "@godseye/core";
import { type Store, schema } from "@godseye/store";
import { eq } from "drizzle-orm";
import { OWNER_DEFAULTS } from "./shared.js";

export const LOCAL_COMMAND_PATH = "/api/v1/owner/local-command";
export function localProof(signingKey: string, body: string, timestamp: string, nonce: string) {
  const key = createHmac("sha256", signingKey).update("godseye-local-admin-v1").digest();
  return createHmac("sha256", key)
    .update(
      `POST\n${LOCAL_COMMAND_PATH}\n${timestamp}\n${nonce}\n${createHash("sha256").update(body).digest("hex")}`,
    )
    .digest("hex");
}

/** Proof is filesystem authority, not a browser enrollment ticket. */
export async function consumeLocalProof(
  store: Store,
  signingKey: string,
  body: string,
  headers: Headers,
  now: Date,
) {
  const timestamp = headers.get("x-godseye-time") ?? "";
  const nonce = headers.get("x-godseye-nonce") ?? "";
  const proof = headers.get("x-godseye-proof") ?? "";
  if (
    !/^\d{13}$/.test(timestamp) ||
    !/^[a-f0-9]{32}$/.test(nonce) ||
    !/^[a-f0-9]{64}$/.test(proof) ||
    Math.abs(now.getTime() - Number(timestamp)) > OWNER_DEFAULTS.proofMs
  )
    throw new DomainError(
      "INVALID_LOCAL_PROOF",
      "Local administration proof is invalid or expired",
      401,
    );
  if (
    !timingSafeEqual(
      Buffer.from(proof, "hex"),
      Buffer.from(localProof(signingKey, body, timestamp, nonce), "hex"),
    )
  )
    throw new DomainError(
      "INVALID_LOCAL_PROOF",
      "Local administration proof is invalid or expired",
      401,
    );
  await write(store, async (tx) => {
    const id = `local-proof:${nonce}`;
    const [receipt] = await tx
      .select()
      .from(schema.ownerReceipts)
      .where(eq(schema.ownerReceipts.id, id));
    if (receipt)
      throw new DomainError(
        "LOCAL_PROOF_REPLAY",
        "Local administration proof has already been consumed",
        409,
      );
    await tx
      .insert(schema.ownerReceipts)
      .values({ id, fingerprint: createHash("sha256").update(body).digest("hex"), createdAt: now });
  });
}
