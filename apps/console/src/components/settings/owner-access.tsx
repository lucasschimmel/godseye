import type { OwnerSecurityView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Fingerprint, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useOwner } from "@/components/owner-gate";
import { Failure, Loading, SectionTitle, SubHeading } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { WithReason } from "@/components/with-reason";
import { api, resource, timestamp } from "@/lib/api";
import {
  OWNER_RECOVER_COMMAND,
  OWNER_RECOVER_OFFLINE_COMMAND,
  recoveryCopy,
} from "@/lib/deployment";
import { ownerAuth } from "@/lib/owner";
import { useDeployment } from "@/lib/use-deployment";

export function OwnerSecurity() {
  const owner = useOwner();
  const deployment = useDeployment();
  const recovery = recoveryCopy(deployment);
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const [message, setMessage] = useState("");
  const [keyName, setKeyName] = useState("");
  const freshReason = security.data?.fresh
    ? null
    : "Confirmez d’abord votre identité par passkey (moins de cinq minutes) pour effectuer cette action.";
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setFailure(null);
    setMessage("");
    try {
      await work();
      await security.refetch();
      await owner.refresh();
    } catch {
      setFailure(new Error("L’action n’a pas abouti. Confirmez votre identité et réessayez."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SubHeading
        eyebrow="IDENTITÉ & AUTORISATIONS"
        title="Accès propriétaire"
        description="Gérez vos clés d’accès et les sessions autorisées à piloter votre infrastructure."
        action={
          <Button variant="outline" onClick={() => void action(owner.logout)} disabled={busy}>
            <LogOut size={15} /> Se déconnecter
          </Button>
        }
      />
      {failure && <Failure error={failure} />}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
      <section className="panel owner-assurance">
        <ShieldCheck size={25} />
        <div>
          <h2>
            {security.data?.fresh
              ? "Identité confirmée récemment"
              : "Confirmez votre identité avant une action sensible"}
          </h2>
          <p>
            Une vérification par passkey de moins de cinq minutes protège les nouvelles clés, les
            révocations et les approbations.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              const result = await ownerAuth.signIn.passkey();
              if (result.error) throw new Error("Passkey confirmation failed");
              setMessage("Votre identité a été confirmée.");
            })
          }
        >
          <Fingerprint size={15} /> Confirmer mon identité
        </Button>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <SectionTitle>Clés d’accès</SectionTitle>
          <div className="passkey-add">
            <label className="sr-only" htmlFor="passkey-name">
              Nom de la nouvelle clé
            </label>
            <input
              id="passkey-name"
              maxLength={60}
              placeholder="Nom de la nouvelle clé (facultatif)"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
            />
            <WithReason reason={freshReason}>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !security.data?.fresh}
                onClick={() =>
                  void action(async () => {
                    const result = await ownerAuth.passkey.addPasskey({
                      createSession: true,
                      name: keyName.trim() || "Clé propriétaire supplémentaire",
                    });
                    if (result.error) throw new Error("Passkey enrollment failed");
                    setKeyName("");
                    setMessage("Votre nouvelle clé d’accès est enregistrée.");
                  })
                }
              >
                <KeyRound size={14} /> Ajouter une clé d’accès
              </Button>
            </WithReason>
          </div>
        </div>
        {security.isError ? (
          <Failure error={security.error} />
        ) : !security.data ? (
          <Loading />
        ) : (
          <div className="owner-security-list">
            {security.data.passkeys.map((key) => (
              <div key={key.id}>
                <KeyRound size={18} />
                <div>
                  <strong>{key.name}</strong>
                  <small>
                    {key.createdAt
                      ? `Ajoutée le ${timestamp(key.createdAt)}`
                      : "Date non disponible"}
                  </small>
                </div>
                <WithReason
                  reason={
                    security.data.passkeys.length <= 1
                      ? "Dernière clé d’accès : ajoutez-en une autre avant de la révoquer. La procédure de récupération reste le seul moyen de la remplacer."
                      : freshReason
                  }
                >
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !security.data.fresh || security.data.passkeys.length <= 1}
                    onClick={() =>
                      void action(async () => {
                        await api(`/owner/passkeys/${key.id}/revoke`, {
                          method: "POST",
                          body: "{}",
                          headers: { "idempotency-key": crypto.randomUUID() },
                        });
                        setMessage("Clé d’accès révoquée.");
                      })
                    }
                  >
                    Révoquer
                  </Button>
                </WithReason>
              </div>
            ))}
          </div>
        )}
        <div className="panel-note">
          Conservez une deuxième clé sur un autre appareil. La dernière clé ne peut être remplacée
          que par la procédure de récupération {deployment.isLocal ? "locale" : "sur le serveur"}.
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <SectionTitle>Sessions actives</SectionTitle>
          <span className="muted">Expiration absolue après huit heures</span>
        </div>
        {security.data && (
          <div className="owner-security-list">
            {security.data.sessions.map((session) => (
              <div key={session.id}>
                <ShieldCheck size={18} />
                <div>
                  <strong>
                    {session.current ? "Cette session" : "Autre session propriétaire"}
                  </strong>
                  <small>
                    Ouverte le {timestamp(session.createdAt)} · expire le{" "}
                    {timestamp(session.expiresAt)}
                  </small>
                </div>
                <WithReason reason={freshReason}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || !security.data.fresh}
                    onClick={() =>
                      void action(async () => {
                        if (session.current) await owner.logout();
                        else
                          await api(`/owner/sessions/${session.id}/revoke`, {
                            method: "POST",
                            body: "{}",
                            headers: { "idempotency-key": crypto.randomUUID() },
                          });
                      })
                    }
                  >
                    {session.current ? "Déconnecter" : "Révoquer"}
                  </Button>
                </WithReason>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel owner-recovery">
        <h2>{recovery.title}</h2>
        <p>{recovery.intro}</p>
        <code>{OWNER_RECOVER_COMMAND}</code>
        <p>{recovery.offline}</p>
        <code>{OWNER_RECOVER_OFFLINE_COMMAND}</code>
        {recovery.procedure && (
          <p className="muted">Procédures documentées : {recovery.procedure}</p>
        )}
      </section>
    </>
  );
}
