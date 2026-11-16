import {
  OWNER_AUTH_REQUIRED_EVENT,
  OWNER_POLL_MS,
  OWNER_SESSION_QUERY,
  type OwnerAuthenticatedView,
  OwnerStatusResponse,
  type OwnerStatusView,
} from "@godseye/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Fingerprint, KeyRound, LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { api, resource } from "@/lib/api";
import { OWNER_SETUP_COMMAND, ownerEntryCopy } from "@/lib/deployment";
import { forgetOwnerData, ownerAuth } from "@/lib/owner";
import { Button } from "./ui/button";

const OwnerContext = createContext<{
  status: OwnerAuthenticatedView;
  logout: () => Promise<void>;
  refresh: () => Promise<unknown>;
} | null>(null);
export function useOwner() {
  const context = useContext(OwnerContext);
  if (!context) throw new Error("Owner context is unavailable");
  return context;
}

export function OwnerGate({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const query = useQuery({
    ...resource<OwnerStatusView>(OWNER_SESSION_QUERY, "/owner/session"),
    queryFn: async () => OwnerStatusResponse.parse(await api("/owner/session")),
    refetchInterval: OWNER_POLL_MS,
    retry: false,
  });
  const [ticket, setTicket] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [hostname, setHostname] = useState<string | null>(null);
  useEffect(() => setHostname(window.location.hostname), []);
  const copy = ownerEntryCopy(hostname);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("enroll");
    if (value) {
      setTicket(value);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);
  useEffect(() => {
    const status = query.data;
    if (!status) return;
    if (window.location.origin !== status.origin) {
      window.location.replace(
        new URL(
          window.location.pathname +
            window.location.search +
            (ticket ? `#enroll=${ticket}` : window.location.hash),
          status.origin,
        ),
      );
      return;
    }
    const clear = () => forgetOwnerData(cache, status);
    const channel = new BroadcastChannel("godseye-owner-session");
    channel.onmessage = clear;
    window.addEventListener(OWNER_AUTH_REQUIRED_EVENT, clear);
    return () => {
      window.removeEventListener(OWNER_AUTH_REQUIRED_EVENT, clear);
      channel.close();
    };
  }, [cache, query.data, ticket]);

  async function authenticate() {
    setBusy(true);
    setFailure("");
    try {
      const result = ticket
        ? await ownerAuth.passkey.addPasskey({
            name: "Clé propriétaire",
            context: ticket,
            createSession: true,
          })
        : await ownerAuth.signIn.passkey();
      if (result.error)
        throw new Error(
          "La clé d’accès n’a pas été validée. Réessayez ou préparez un nouveau lien d’enrôlement.",
        );
      setTicket("");
      await query.refetch();
    } catch {
      setFailure("L’authentification n’a pas abouti. Vérifiez votre clé d’accès et réessayez.");
    } finally {
      setBusy(false);
    }
  }
  if (query.data?.authenticated)
    return (
      <OwnerContext.Provider
        value={{
          status: query.data,
          refresh: () => query.refetch(),
          logout: async () => {
            const result = await ownerAuth.signOut();
            if (result.error) throw new Error("La déconnexion n’a pas abouti.");
            forgetOwnerData(cache, query.data);
            const channel = new BroadcastChannel("godseye-owner-session");
            channel.postMessage("signed-out");
            channel.close();
          },
        }}
      >
        {children}
      </OwnerContext.Provider>
    );
  return (
    <div className="owner-entry">
      <div className="owner-entry-brand">
        <Eye size={25} />
        <span>
          G.O.D.S.E.Y.E<small>PLAN DE CONTRÔLE PRIVÉ</small>
        </span>
      </div>
      <section className="owner-entry-card">
        <span className="owner-entry-icon">
          <Fingerprint size={34} strokeWidth={1.3} />
        </span>
        <p className="eyebrow">VOTRE ESPACE PRIVÉ</p>
        <h1>Accès propriétaire</h1>
        {!query.data ? (
          <p role="status">{query.isError ? copy.unavailable : "Vérification de votre session…"}</p>
        ) : (
          <>
            <p>
              {ticket
                ? "Enregistrez une clé d’accès pour terminer l’enrôlement. Votre navigateur vous demandera de confirmer votre identité."
                : query.data.configured
                  ? "Connectez-vous avec la clé d’accès de votre appareil ou votre clé de sécurité."
                  : copy.firstAccess}
            </p>
            {ticket || query.data.configured ? (
              <Button
                className="owner-entry-action"
                disabled={busy}
                onClick={() => void authenticate()}
              >
                {ticket ? <KeyRound size={17} /> : <LogIn size={17} />}
                {busy
                  ? "Validation de la clé…"
                  : ticket
                    ? "Enregistrer ma clé d’accès"
                    : "Se connecter avec une clé d’accès"}
              </Button>
            ) : (
              <div className="owner-command">
                <code>{OWNER_SETUP_COMMAND}</code>
                <small>{copy.setupHint}</small>
              </div>
            )}
          </>
        )}
        {failure && (
          <p className="error-message" role="alert">
            {failure}
          </p>
        )}
        <div className="owner-entry-note">
          <ShieldCheck size={15} />
          <span>Authentification par passkey · aucune inscription publique</span>
        </div>
      </section>
      <div className="owner-entry-footer">
        <LockKeyhole size={13} /> {copy.footer}
      </div>
    </div>
  );
}
