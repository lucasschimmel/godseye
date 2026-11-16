/** A build link is shown only when the recorded reference is a plain https URL without credentials. */
export function buildLink(reference: string | null): string | null {
  if (!reference) return null;
  try {
    const url = new URL(reference);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
