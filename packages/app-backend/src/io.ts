import type { FileHandle } from "node:fs/promises";
import { ApplicationError } from "./contracts.js";

export async function writeAll(handle: FileHandle, bytes: Uint8Array, position: number) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      position + offset,
    );
    if (bytesWritten <= 0)
      throw new ApplicationError(
        "WRITE_INCOMPLETE",
        "Application object write made no progress",
        409,
      );
    offset += bytesWritten;
  }
}
export async function readAll(handle: FileHandle, length: number, position: number) {
  const result = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(result, offset, length - offset, position + offset);
    if (bytesRead <= 0)
      throw new ApplicationError("FILE_INTEGRITY", "Application object ended unexpectedly", 409);
    offset += bytesRead;
  }
  return result;
}
