import { useQueryClient } from "@tanstack/react-query";
import { Check, Fingerprint, LoaderCircle } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { ownerAuth } from "@/lib/owner";
import { onStepUpRequest, type StepUpRequest } from "@/lib/step-up";
import { Button } from "../ui/button";

const ToastContext = createContext<(message: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

/** Toasts, plus the single passkey step-up sheet used by every sensitive action. */
export function Overlays({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const sequence = useRef(0);
  const toast = useCallback((message: string) => {
    const id = ++sequence.current;
    setToasts((all) => [...all.slice(-2), { id, message }]);
    window.setTimeout(() => setToasts((all) => all.filter((item) => item.id !== id)), 3600);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <StepUpSheet toast={toast} />
      {/* A polite live region without a status role, so page-level status messages stay unique. */}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((item) => (
          <div className="toast" key={item.id}>
            <Check size={14} />
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function StepUpSheet({ toast }: { toast: (message: string) => void }) {
  const cache = useQueryClient();
  const [request, setRequest] = useState<StepUpRequest | null>(null);
  const [state, setState] = useState<"idle" | "waiting" | "failed">("idle");
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(
    () =>
      onStepUpRequest((next) => {
        setRequest((previous) => {
          previous?.settle?.(false);
          return next;
        });
        setState("idle");
      }),
    [],
  );
  useEffect(() => {
    if (request) confirmRef.current?.focus();
  }, [request]);
  const cancel = useCallback(() => {
    setRequest((current) => {
      current?.settle?.(false);
      return null;
    });
  }, []);
  useEffect(() => {
    if (!request) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state !== "waiting") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, state, cancel]);
  if (!request) return null;
  async function confirm() {
    if (!request) return;
    setState("waiting");
    const result = await ownerAuth.signIn.passkey();
    if (result.error) {
      setState("failed");
      return;
    }
    await cache.invalidateQueries({ queryKey: ["owner-security"] });
    setRequest(null);
    request.settle?.(true);
    if (request.retry) {
      try {
        await request.retry();
        toast("Identité confirmée. Action relancée.");
      } catch {
        toast("Identité confirmée. L’action relancée n’a pas abouti : voir le détail.");
      }
    } else if (!request.settle) toast("Identité confirmée.");
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a pointer shortcut; Escape and Annuler cancel for keyboard users.
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && state !== "waiting") cancel();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="step-up-title">
        <div className="sheet-head">
          <span className="tile signal">
            <Fingerprint size={18} />
          </span>
          <div>
            <span className="faint small">Confirmation par passkey</span>
            <h2 id="step-up-title">{request.title}</h2>
          </div>
        </div>
        <div className="sheet-body">
          {request.detail && <p>{request.detail}</p>}
          <p>
            Rien n’a encore été exécuté.{" "}
            {request.retry || request.settle
              ? "Après confirmation, l’action est relancée une seule fois."
              : "Votre confirmation reste valable quelques minutes."}
          </p>
          {state === "failed" && (
            <p className="callout danger" role="alert">
              La confirmation a échoué ou a été annulée. Aucune action n’a été relancée.
            </p>
          )}
        </div>
        <div className="sheet-actions">
          <Button variant="ghost" onClick={cancel} disabled={state === "waiting"}>
            Annuler
          </Button>
          <Button ref={confirmRef} onClick={() => void confirm()} disabled={state === "waiting"}>
            {state === "waiting" ? <LoaderCircle className="spin" /> : <Fingerprint />}
            {state === "waiting" ? "Touchez votre clé…" : "Confirmer avec la passkey"}
          </Button>
        </div>
      </div>
    </div>
  );
}
