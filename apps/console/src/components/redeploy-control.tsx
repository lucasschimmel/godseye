import { RotateCw } from "lucide-react";
import { useState } from "react";
import { Button } from "./ui/button";
import { WithReason } from "./with-reason";

export interface RedeployControlProps {
  /** Human label of the environment, shown in the confirmation. */
  environment: string;
  project: string;
  /** Short commit of the current release; the digest is what actually gets re-released. */
  commit: string | null;
  digest: string | null;
  /** Why the action is unavailable; null when it can be requested. */
  reason: string | null;
  pending: boolean;
  onConfirm: () => void;
  /** Test seam: render the confirmation already open. */
  initialOpen?: boolean;
}

/** "Redéployer" with an explicit confirmation; the disabled state always states its reason. */
export function RedeployControl({
  environment,
  project,
  commit,
  digest,
  reason,
  pending,
  onConfirm,
  initialOpen = false,
}: RedeployControlProps) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <WithReason reason={reason}>
        <Button
          variant="outline"
          disabled={reason !== null || pending}
          onClick={() => setOpen(true)}
        >
          <RotateCw size={15} />
          Redéployer
        </Button>
      </WithReason>
      {open && reason === null && (
        <div
          role="alertdialog"
          aria-label="Confirmer le redéploiement"
          className="redeploy-confirm"
        >
          <p>
            Redéployer la version actuelle de <strong>{project}</strong> ({environment}) ?
          </p>
          <p className="muted">
            Aucune nouvelle construction : la même image{" "}
            <span className="mono">{digest ? digest.slice(0, 19) : (commit ?? "")}</span> sera
            préparée à nouveau, après revérification de la source, des contrôles et de la politique.
            Vous devrez ensuite l’admettre dans « Livraisons préparées ».
          </p>
          <div className="button-group">
            <Button
              disabled={pending}
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Confirmer le redéploiement
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
