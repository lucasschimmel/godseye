#!/usr/bin/env node
// p13-b2-prefix-tool.mjs - small S3 (SigV4) helper for the Backblaze B2 backup bucket.
//
// Reads the key from the environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, never from argv and
// never printed). Commands:
//   usage                         total objects and bytes per top-level prefix (all versions)
//   prefixes <prefix>             immediate sub-prefixes below <prefix>
//   list <prefix>                 object count, version count and bytes under <prefix>
//   delete <prefix> [--apply]     delete EVERY version under <prefix>; dry-run unless --apply
//   lifecycle                     print the bucket lifecycle configuration if the key may read it
// Guards: delete refuses an empty prefix and any prefix that is not exactly "cells/<uuid>/".
import { createHash, createHmac } from "node:crypto";

const bucket = process.env.GODSEYE_B2_BUCKET ?? "godseye-backups-dab6e7328bfc";
const host = process.env.GODSEYE_B2_ENDPOINT ?? "s3.eu-central-003.backblazeb2.com";
const region = process.env.GODSEYE_B2_REGION ?? "eu-central-003";
const accessKey = process.env.AWS_ACCESS_KEY_ID ?? process.env.PGBACKREST_REPO1_S3_KEY ?? "";
const secretKey =
  process.env.AWS_SECRET_ACCESS_KEY ?? process.env.PGBACKREST_REPO1_S3_KEY_SECRET ?? "";
if (!accessKey || !secretKey) {
  console.error("missing B2 credentials in the environment");
  process.exit(2);
}
const CELL_PREFIX = /^cells\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/$/;

const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const hmac = (k, v) => createHmac("sha256", k).update(v).digest();
const enc = (s) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

async function s3(method, query = {}, body = "", key = "") {
  const now = new Date();
  const amz = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = amz.slice(0, 8);
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${enc(k)}=${enc(String(query[k]))}`)
    .join("&");
  const path = `/${bucket}${key ? `/${key.split("/").map(enc).join("/")}` : ""}`;
  const payloadHash = sha256(body);
  const headers = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": amz };
  const signed = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join("");
  const canonical = [method, path, canonicalQuery, canonicalHeaders, signed, payloadHash].join(
    "\n",
  );
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, sha256(canonical)].join("\n");
  const kSign = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), "s3"), "aws4_request");
  const signature = createHmac("sha256", kSign).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
  const url = `https://${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  const res = await fetch(url, { method, headers, body: body === "" ? undefined : body });
  const text = await res.text();
  if (!res.ok) {
    const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1] ?? "";
    throw new Error(`${method} ${res.status} ${code}`);
  }
  return text;
}

const tags = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
const unxml = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

/** Lists every version and delete marker under a prefix (follows pagination). */
async function listVersions(prefix, delimiter) {
  const out = { versions: [], prefixes: [] };
  let keyMarker = "";
  let versionMarker = "";
  for (;;) {
    const q = { versions: "", prefix, "max-keys": 1000 };
    if (delimiter) q.delimiter = delimiter;
    if (keyMarker) q["key-marker"] = keyMarker;
    if (versionMarker) q["version-id-marker"] = versionMarker;
    const xml = await s3("GET", q);
    for (const tag of ["Version", "DeleteMarker"]) {
      for (const block of tags(xml, tag)) {
        out.versions.push({
          key: unxml(tags(block, "Key")[0] ?? ""),
          id: tags(block, "VersionId")[0] ?? "",
          size: Number(tags(block, "Size")[0] ?? 0),
          marker: tag === "DeleteMarker",
        });
      }
    }
    for (const block of tags(xml, "CommonPrefixes"))
      out.prefixes.push(unxml(tags(block, "Prefix")[0] ?? ""));
    if (tags(xml, "IsTruncated")[0] !== "true") return out;
    keyMarker = unxml(tags(xml, "NextKeyMarker")[0] ?? "");
    versionMarker = tags(xml, "NextVersionIdMarker")[0] ?? "";
  }
}

const summarize = (versions) => ({
  keys: new Set(versions.map((v) => v.key)).size,
  versions: versions.length,
  bytes: versions.reduce((a, v) => a + v.size, 0),
});

const [cmd, arg, flag] = process.argv.slice(2);
try {
  if (cmd === "prefixes") {
    const r = await listVersions(arg ?? "", "/");
    for (const p of [...new Set(r.prefixes)].sort()) console.log(p);
  } else if (cmd === "usage") {
    const top = await listVersions("", "/");
    for (const p of [...new Set(top.prefixes)].sort()) {
      const all = await listVersions(p);
      console.log(`${p} ${JSON.stringify(summarize(all.versions))}`);
    }
    console.log(`(root-level objects) ${JSON.stringify(summarize(top.versions))}`);
  } else if (cmd === "list") {
    const r = await listVersions(arg ?? "");
    console.log(JSON.stringify(summarize(r.versions)));
  } else if (cmd === "delete") {
    if (!arg || !CELL_PREFIX.test(arg)) throw new Error("refusing: prefix must be cells/<uuid>/");
    const r = await listVersions(arg);
    console.log(`found ${JSON.stringify(summarize(r.versions))}`);
    if (flag !== "--apply") {
      console.log("dry run (no --apply)");
    } else {
      let done = 0;
      for (const v of r.versions) {
        await s3("DELETE", v.id ? { versionId: v.id } : {}, "", v.key).catch(() => {
          throw new Error(`delete failed after ${done} objects`);
        });
        done += 1;
      }
      console.log(`deleted ${done} versions`);
    }
  } else if (cmd === "lifecycle") {
    console.log(await s3("GET", { lifecycle: "" }));
  } else {
    console.error(
      "usage: usage | prefixes <p> | list <p> | delete <cells/uuid/> [--apply] | lifecycle",
    );
    process.exit(64);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
