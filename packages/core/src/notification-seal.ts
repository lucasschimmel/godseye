import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/** Authenticated encryption for notification targets; `context` binds a ciphertext to its row. */
export interface SecretSealer {
  seal(plaintext: string, context: string): string;
  /** Throws on a wrong key, a different context or any modification. */
  open(sealed: string, context: string): string;
}

const VERSION = "v1";
const KEY_INFO = "godseye:notification-channels:v1";

/**
 * AES-256-GCM under a key derived (HKDF-SHA-256) from controller-private material that never
 * enters the database. Ciphertext format: `v1.<iv>.<tag>.<data>` in base64url.
 */
export class AesGcmSealer implements SecretSealer {
  private readonly key: Buffer;
  constructor(keyMaterial: string) {
    if (keyMaterial.length < 32) throw new Error("Sealing key material is too short");
    this.key = Buffer.from(hkdfSync("sha256", keyMaterial, "godseye", KEY_INFO, 32));
  }
  seal(plaintext: string, context: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [
      VERSION,
      ...[iv, cipher.getAuthTag(), data].map((part) => part.toString("base64url")),
    ].join(".");
  }
  open(sealed: string, context: string): string {
    const [version, iv, tag, data, extra] = sealed.split(".");
    if (version !== VERSION || !iv || !tag || data === undefined || extra !== undefined)
      throw new Error("Sealed value is malformed");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
