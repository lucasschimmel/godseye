import { FileView, type InitiateFileInput } from "@godseye/app-backend/contracts";
import { z } from "zod";
import { type ApplicationTransport, jsonRequest } from "./transport.js";

export interface MutationOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
}
export function applicationFiles(transport: ApplicationTransport, chunkBytes = 1024 * 1024) {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 16 * 1024 * 1024)
    throw new Error("SDK chunk size is out of range");
  const key = (options?: MutationOptions) => options?.idempotencyKey ?? crypto.randomUUID();
  const metadata = (id: string, signal?: AbortSignal) =>
    transport.json(`/files/${encodeURIComponent(id)}`, { signal }, FileView);
  const initiate = (input: InitiateFileInput, options?: MutationOptions) =>
    transport.json("/files", jsonRequest(input, "POST", key(options), options?.signal), FileView);
  const append = (
    id: string,
    data: Uint8Array,
    offset: number,
    revision: number,
    signal?: AbortSignal,
  ) =>
    transport.json(
      `/files/${encodeURIComponent(id)}/content`,
      {
        method: "PUT",
        signal,
        headers: {
          "Content-Type": "application/octet-stream",
          "Upload-Offset": String(offset),
          "If-Match": String(revision),
        },
        body: new Uint8Array(data).buffer,
      },
      FileView,
    );
  const complete = (id: string, expectedRevision: number, options?: MutationOptions) =>
    transport.json(
      `/files/${encodeURIComponent(id)}/complete`,
      jsonRequest({ expectedRevision }, "POST", key(options), options?.signal),
      FileView,
    );
  return {
    metadata,
    initiate,
    append,
    complete,
    list: (signal?: AbortSignal, after?: string) =>
      transport.json(
        `/files${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        { signal },
        z.object({ files: z.array(FileView), nextCursor: z.string().nullable() }),
      ),
    delete: (id: string, expectedRevision: number, options?: MutationOptions) =>
      transport.json(
        `/files/${encodeURIComponent(id)}`,
        jsonRequest({ expectedRevision }, "DELETE", key(options), options?.signal),
        FileView,
      ),
    download: (id: string, options: { range?: string; signal?: AbortSignal } = {}) =>
      transport.send(`/files/${encodeURIComponent(id)}/download`, {
        signal: options.signal,
        headers: options.range ? { Range: options.range } : {},
      }),
    createGrant: (
      id: string,
      expectedRevision: number,
      expiresInMs?: number,
      options?: MutationOptions,
    ) =>
      transport.json(
        `/files/${encodeURIComponent(id)}/grants`,
        jsonRequest({ expectedRevision, expiresInMs }, "POST", key(options), options?.signal),
        z.object({ id: z.string(), url: z.url(), expiresAt: z.iso.datetime() }).strict(),
      ),
    revokeGrant: (id: string, grantId: string, options?: MutationOptions) =>
      transport.json(
        `/files/${encodeURIComponent(id)}/grants/${encodeURIComponent(grantId)}`,
        jsonRequest({}, "DELETE", key(options), options?.signal),
        z.object({ revoked: z.literal(true) }).strict(),
      ),
    downloadGrant: (grantId: string, signal?: AbortSignal) =>
      transport.send(`/downloads/${encodeURIComponent(grantId)}`, { signal }),
    async upload(
      input: { name: string; contentType: string; data: Uint8Array | Blob; sha256?: string },
      options?: MutationOptions,
    ) {
      const size = input.data instanceof Blob ? input.data.size : input.data.byteLength;
      if (size > 16 * 1024 * 1024)
        throw new Error(
          "Convenience upload is bounded to 16 MiB; use initiate/append/complete for larger streams",
        );
      const contents =
        input.data instanceof Blob
          ? await input.data.arrayBuffer()
          : new Uint8Array(input.data).buffer;
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", contents)),
        (value) => value.toString(16).padStart(2, "0"),
      ).join("");
      if (input.sha256 && input.sha256 !== sha256)
        throw new Error("Supplied upload digest differs from actual bytes");
      let file = await initiate(
        { name: input.name, contentType: input.contentType, size, sha256 },
        options,
      );
      if (file.status === "committed") return file;
      while (file.offset < file.size) {
        const end = Math.min(file.offset + chunkBytes, file.size);
        const bytes =
          input.data instanceof Blob
            ? new Uint8Array(await input.data.slice(file.offset, end).arrayBuffer())
            : input.data.slice(file.offset, end);
        file = await append(file.id, bytes, file.offset, file.revision, options?.signal);
      }
      return complete(file.id, file.revision, { signal: options?.signal });
    },
  };
}
