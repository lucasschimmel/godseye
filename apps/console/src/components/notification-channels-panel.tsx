import type {
  NotificationChannelOverviewView,
  NotificationChannelView,
  OwnerSecurityView,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint } from "lucide-react";
import { useState } from "react";
import { resource } from "@/lib/api";
import { attemptText } from "@/lib/notification-attempts";
import { ownerAuth } from "@/lib/owner";
import { EmptyState, Failure, Loading } from "./shared";
import { useTelemetryMutation } from "./telemetry-shared";
import { Button } from "./ui/button";

const BASE = "/notifications/channels";
const EMPTY_FORM = { label: "", url: "", signingSecret: "" };

/** Owner webhook channels: add, send a real arrival test, remove. The URL and secret are write-only. */
export function NotificationChannelsPanel() {
  const channels = useQuery(
    resource<NotificationChannelOverviewView>("notification-channels", BASE),
  );
  const security = useQuery(resource<OwnerSecurityView>("owner-security", "/owner/security"));
  const cache = useQueryClient();
  const mutation = useTelemetryMutation();
  const confirm = useMutation({
    mutationFn: async () => {
      const result = await ownerAuth.signIn.passkey();
      if (result.error) throw new Error("La confirmation a échoué.");
    },
    onSuccess: () => cache.invalidateQueries(),
  });
  const [form, setForm] = useState(EMPTY_FORM);
  const [tested, setTested] = useState<NotificationChannelView | null>(null);
  if (channels.isPending) return <Loading />;
  if (channels.isError)
    return <Failure error={channels.error} retry={() => void channels.refetch()} />;
  const overview = channels.data;
  const fresh = security.data?.fresh === true;
  const usable = overview.adapter === "available";
  const full = overview.channels.length >= overview.limit;
  const canWrite = fresh && usable && !mutation.isPending;
  async function add() {
    await mutation.post(BASE, {
      kind: "webhook",
      label: form.label,
      url: form.url,
      ...(form.signingSecret ? { signingSecret: form.signingSecret } : {}),
    });
    setForm(EMPTY_FORM);
  }
  async function test(channel: NotificationChannelView) {
    const result = await mutation.post(`${BASE}/${channel.id}/test`, {
      expectedRevision: channel.revision,
    });
    setTested(result as NotificationChannelView);
  }
  return (
    <section className="panel" aria-label="Canaux webhook">
      <h3>Canaux webhook du propriétaire</h3>
      {!usable && (
        <p role="status">
          Cet adaptateur ne peut pas stocker de canal : aucune matière de chiffrement n’est
          disponible sur ce contrôleur. Rien ne sera envoyé.
        </p>
      )}
      <p className="muted">
        Un canal envoie les incidents et les alertes de rotation vers une adresse https publique.
        L’adresse et le secret de signature ne sont jamais réaffichés ni journalisés. Un canal
        enregistré n’est pas un canal vérifié : lancez un test d’arrivée.
      </p>
      <div className="button-row">
        <Button variant="outline" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          <Fingerprint size={15} />
          Confirmer mon identité
        </Button>
      </div>
      {!fresh && (
        <p className="muted">
          Confirmez votre identité avec une clé d’accès récente pour ajouter, tester ou retirer un
          canal.
        </p>
      )}
      {(mutation.isError || confirm.isError) && (
        <Failure error={mutation.error ?? confirm.error ?? new Error("L’action a échoué.")} />
      )}
      {overview.channels.length === 0 ? (
        <EmptyState
          title="Aucun canal webhook"
          description="Les incidents restent enregistrés ici ; personne n’est prévenu automatiquement."
        />
      ) : (
        <ul className="channel-list">
          {overview.channels.map((channel) => (
            <li key={channel.id} aria-label={`Canal ${channel.label}`}>
              <strong>{channel.label}</strong> · <span className="mono">{channel.host}</span>
              {channel.signed ? " · signé (HMAC)" : " · non signé"}
              <p>{attemptText(channel.test, "test")}</p>
              <p className="muted">{attemptText(channel.delivery, "incident")}</p>
              <div className="button-row">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canWrite}
                  onClick={() => void test(channel).catch(() => undefined)}
                >
                  Envoyer un test d’arrivée
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canWrite}
                  onClick={() =>
                    mutation.mutate({
                      method: "POST",
                      path: `${BASE}/${channel.id}/remove`,
                      body: { expectedRevision: channel.revision },
                    })
                  }
                >
                  Retirer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {tested && (
        <p role="status">
          {tested.test.state === "confirmed"
            ? `Test confirmé : « ${tested.label} » a répondu HTTP ${tested.test.httpStatus ?? "2xx"}.`
            : tested.test.state === "unknown"
              ? `Résultat inconnu pour « ${tested.label} » : rien n’est confirmé.`
              : `Test en échec pour « ${tested.label} » : rien n’a été confirmé.`}
        </p>
      )}
      <form
        aria-label="Ajouter un canal webhook"
        onSubmit={(event) => {
          event.preventDefault();
          if (canWrite && !full) void add().catch(() => undefined);
        }}
      >
        <label>
          Nom du canal
          <input
            required
            maxLength={60}
            value={form.label}
            onChange={(event) => setForm({ ...form, label: event.target.value })}
          />
        </label>
        <label>
          Adresse https du webhook
          <input
            required
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://hooks.exemple.org/…"
            value={form.url}
            onChange={(event) => setForm({ ...form, url: event.target.value })}
          />
        </label>
        <label>
          Secret de signature (facultatif, 16 caractères minimum)
          <input
            type="password"
            autoComplete="new-password"
            minLength={16}
            maxLength={200}
            value={form.signingSecret}
            onChange={(event) => setForm({ ...form, signingSecret: event.target.value })}
          />
        </label>
        <p className="muted">
          Port 443 uniquement ; les adresses privées, locales ou internes sont refusées.
          {full ? ` Limite de ${overview.limit} canaux atteinte.` : ""}
        </p>
        <Button type="submit" disabled={!canWrite || full}>
          Ajouter le canal
        </Button>
      </form>
    </section>
  );
}
