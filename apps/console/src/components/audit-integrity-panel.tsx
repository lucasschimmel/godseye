import type { AuditAnchor, AuditExportPage } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Failure, Loading, SectionTitle } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { api, resource } from "@/lib/api";

const PAGE_SIZE = 500;
/** Upper bound on pages so a faulty cursor can never loop forever. */
const MAX_PAGES = 2_000;

async function collectJournal(): Promise<AuditExportPage[]> {
  const pages: AuditExportPage[] = [];
  let cursor = 0;
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await api<AuditExportPage>(
      "/audit/export?cursor=" + cursor + "&limit=" + PAGE_SIZE,
    );
    pages.push(page);
    if (page.to === cursor || page.to >= page.anchor.sequence) return pages;
    cursor = page.to;
  }
  throw new Error("Le journal est trop volumineux pour un export en une fois.");
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/** Tamper-evidence of the audit journal: current anchor and a verifiable export. */
export function AuditIntegrityPanel() {
  const anchor = useQuery(resource<AuditAnchor>("audit-anchor", "/audit/anchor"));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [message, setMessage] = useState("");

  async function exportJournal() {
    setBusy(true);
    setFailure(null);
    setMessage("");
    try {
      const pages = await collectJournal();
      const last = pages.at(-1)?.anchor ?? { sequence: 0, hash: "genesis" };
      const entries = pages.reduce((total, page) => total + page.entries.length, 0);
      download(
        `journal-audit-${last.sequence}.json`,
        JSON.stringify({ format: "godseye-audit-export-v1", anchor: last, pages }, null, 2),
      );
      setMessage(`Export téléchargé : ${entries} entrée(s) jusqu’à la séquence ${last.sequence}.`);
      await anchor.refetch();
    } catch (error) {
      setFailure(error instanceof Error ? error : new Error("L’export n’a pas abouti."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="audit-integrity-title">
      <div className="panel-heading">
        <SectionTitle>
          <span id="audit-integrity-title">Intégrité du journal</span>
        </SectionTitle>
        <ShieldCheck size={18} />
      </div>
      <p className="panel-note">
        Le journal est chaîné par empreintes. Conservez l’ancre ci-dessous hors de ce serveur : un
        export ne peut pas prouver seul que sa fin n’a pas été tronquée.
      </p>
      {anchor.isPending ? (
        <Loading />
      ) : anchor.isError ? (
        <Failure error={anchor.error} retry={() => void anchor.refetch()} />
      ) : (
        <dl className="infra-metrics">
          <div>
            <dt>Dernière séquence</dt>
            <dd data-testid="audit-anchor-sequence">{anchor.data.sequence}</dd>
          </div>
          <div>
            <dt>Empreinte d’ancrage</dt>
            <dd className="mono" data-testid="audit-anchor-hash">
              {anchor.data.hash}
            </dd>
          </div>
        </dl>
      )}
      {failure && <Failure error={failure} />}
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      <Button
        variant="outline"
        disabled={busy || anchor.isPending}
        onClick={() => void exportJournal()}
      >
        <Download size={15} />
        {busy ? "Export en cours…" : "Exporter le journal"}
      </Button>
    </section>
  );
}
