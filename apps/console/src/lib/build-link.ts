/**
 * A build link is shown only when the recorded reference is a plain http(s) URL without
 * credentials. The control API fills it solely from builds on the configured Jenkins origin, which
 * is a private-network controller and may be plain http.
 */
export function buildLink(reference: string | null): string | null {
  if (!reference) return null;
  try {
    const url = new URL(reference);
    const web = url.protocol === "https:" || url.protocol === "http:";
    return web && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
