import {
  AgentConversationDetail,
  type AgentConversationDetailView,
  type AgentConversationView,
  type AgentProfileView,
  type AgentTaskToolSelection,
  type ProjectDTO,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "@/lib/api";
import { AgentsChatOutputs } from "./agents-chat-outputs";
import { useAgentChatStream } from "./agents-chat-stream";
import { AgentsChatTranscript } from "./agents-chat-transcript";
import { type AgentPost, agentProfileScope, agentRoleLabels } from "./agents-labels";
import { AgentsToolsFields, toolGrantFromForm } from "./agents-tools-fields";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function AgentsChat({
  profiles,
  projects,
  post,
  disabled,
  fresh,
  toolsAvailable = false,
}: {
  profiles: AgentProfileView[];
  projects: ProjectDTO[];
  post: AgentPost;
  disabled: boolean;
  fresh: boolean;
  toolsAvailable?: boolean;
}) {
  const [selected, select] = useState("");
  const formId = useId();
  const [profileId, setProfile] = useState("");
  const [title, setTitle] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [sendIntentions, setSendIntentions] = useState<
    Record<
      string,
      {
        id: string;
        body: { input: string; expectedRevision: number; toolGrant?: AgentTaskToolSelection };
      }
    >
  >({});
  const list = useQuery({
    queryKey: ["agent-conversations"],
    queryFn: () => api<{ conversations: AgentConversationView[] }>("/agents/conversations"),
    refetchInterval: 5000,
    enabled: typeof window !== "undefined",
  });
  const id = selected || list.data?.conversations[0]?.id || "";
  const input = drafts[id] ?? "";
  const setInput = (value: string) => setDrafts((old) => ({ ...old, [id]: value }));
  const sendIntention = sendIntentions[id];
  const setSendIntention = (value: typeof sendIntention | null) =>
    setSendIntentions((old) => {
      if (value) return { ...old, [id]: value };
      const next = { ...old };
      delete next[id];
      return next;
    });
  const detail = useQuery({
    queryKey: ["agent-chat", id],
    queryFn: () => api<AgentConversationDetailView>(`/agents/conversations/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const stream = useAgentChatStream(id, !!detail.data);
  const profile = profiles.find((p) => p.id === (detail.data?.conversation.profileId ?? ""));
  const scope = profile ? agentProfileScope(profile, projects) : undefined;
  const readOnly =
    !profile ||
    profile.paused ||
    profile.hash !== detail.data?.conversation.profileHash ||
    profile.revision !== detail.data?.conversation.profileRevision ||
    profile.projectRevision !== scope?.project?.revision ||
    profile.environmentRevision !== scope?.environment?.revision;
  const choice = profiles.find((p) => p.id === profileId) ?? profiles[0];
  const busy =
    profile?.busy ||
    detail.data?.turns.some(
      (turn) => !["succeeded", "failed", "cancelled"].includes(turn.task.state),
    );
  const stale = list.isError || detail.isError;
  const retryingSend = sendIntention?.id === id && sendIntention.body.input === input;
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!choice) return;
    setFailure("");
    try {
      const value = AgentConversationDetail.parse(
        await post("/agents/conversations", {
          profileId: choice.id,
          expectedRevision: choice.revision,
          title,
        }),
      );
      select(value.conversation.id);
      setTitle("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "La conversation n’a pas été créée.");
    }
  }
  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail.data) return;
    setFailure("");
    let toolGrant: AgentTaskToolSelection | undefined;
    try {
      if (!retryingSend) toolGrant = toolGrantFromForm(new FormData(event.currentTarget));
    } catch {
      setFailure("Vérifiez les droits, plafonds et fichier copié de ce message.");
      return;
    }
    // A lost response may already have advanced the conversation revision.
    // Reuse its exact body so the shared idempotency key still identifies that same turn.
    const intention =
      retryingSend && sendIntention
        ? sendIntention
        : {
            id,
            body: {
              input,
              expectedRevision: detail.data.conversation.revision,
              ...(toolGrant ? { toolGrant } : {}),
            },
          };
    const frozen = structuredClone(intention);
    setSendIntention(frozen);
    try {
      await post(`/agents/conversations/${frozen.id}/turns`, frozen.body);
      setInput("");
      setSendIntention(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Le message n’a pas été confirmé.");
    }
  }
  return (
    <section className="panel chat-center" aria-label="Chat Hermès avancé">
      <header className="panel-header">
        <div>
          <p className="eyebrow">AGENT CENTER</p>
          <h2>Conversations Hermès</h2>
        </div>
        <span className="agents-badge">{list.data?.conversations.length ?? 0} conversation(s)</span>
      </header>
      <div className="chat-layout">
        <aside className="chat-sidebar">
          <nav aria-label="Conversations">
            {list.data?.conversations.map((conversation) => (
              <button
                type="button"
                aria-pressed={conversation.id === id}
                key={conversation.id}
                onClick={() => select(conversation.id)}
              >
                {conversation.title}
                <small>
                  {
                    agentRoleLabels[
                      profiles.find((p) => p.id === conversation.profileId)?.role ?? "operations"
                    ]
                  }
                </small>
              </button>
            ))}
          </nav>
          <form
            className="chat-create"
            onSubmit={(event) => void create(event)}
            aria-label="Créer une conversation"
          >
            <h3>Nouvelle conversation</h3>
            <label>
              Profil de conversation
              <select
                value={choice?.id ?? ""}
                onChange={(event) => setProfile(event.target.value)}
                disabled={disabled || !fresh}
              >
                {!profiles.length && <option value="">Créez d’abord un profil</option>}
                {profiles.map((p) => (
                  <option value={p.id} key={p.id}>
                    {agentRoleLabels[p.role]} · {agentProfileScope(p, projects).label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${formId}-title`}>
              Titre de la conversation
              <Input
                id={`${formId}-title`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={120}
                placeholder="Préparer la prochaine version"
                disabled={disabled || !fresh}
              />
            </label>
            <Button disabled={disabled || !fresh || stale || !choice || !title.trim()}>
              Créer une conversation
            </Button>
          </form>
        </aside>
        <div className="chat-main">
          {detail.data ? (
            <>
              <div className="chat-heading">
                <div>
                  <h3>{detail.data.conversation.title}</h3>
                  <p className="muted">
                    {profile ? agentProfileScope(profile, projects).label : "Profil indisponible"}
                  </p>
                </div>
                <div>
                  <p className="chat-connection" role="status" aria-label="État du flux">
                    {stream.status}
                  </p>
                  <button className="chat-reconnect" type="button" onClick={stream.reconnect}>
                    Reconnecter le flux
                  </button>
                </div>
              </div>
              <AgentsChatTranscript detail={detail.data} disabled={disabled} post={post} />
              <form
                className="chat-compose"
                aria-label="Envoyer un message"
                onSubmit={(event) => void send(event)}
              >
                <label htmlFor={`${formId}-message`}>
                  Message à Hermès
                  <Textarea
                    id={`${formId}-message`}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    required
                    maxLength={8192}
                    disabled={
                      disabled || !fresh || busy || readOnly || profile?.runtime !== "available"
                    }
                    placeholder="Analyse, brouillon, question…"
                  />
                </label>
                <AgentsToolsFields
                  key={`${id}:${detail.data.conversation.revision}`}
                  profile={profile}
                  mode="message"
                  available={toolsAvailable}
                  disabled={disabled || !fresh || busy || readOnly || retryingSend}
                />
                <div className="chat-compose-footer">
                  <p className="muted">
                    Un message = une réservation bornée. Les réponses en cours restent provisoires.
                  </p>
                  <Button
                    disabled={
                      disabled ||
                      !fresh ||
                      stale ||
                      (busy && !retryingSend) ||
                      (readOnly && !retryingSend) ||
                      (profile?.runtime !== "available" && !retryingSend) ||
                      !input.trim()
                    }
                  >
                    {retryingSend ? "Vérifier l’envoi" : "Envoyer le message"}
                  </Button>
                </div>
                {profile?.runtime !== "available" && (
                  <p className="agents-notice">
                    Connectez le runtime privé de ce profil pour envoyer un message.
                  </p>
                )}
                {readOnly && (
                  <p className="agents-notice">
                    Ce profil a changé ou est en pause. L’historique reste disponible ; créez une
                    conversation avec un profil à jour.
                  </p>
                )}
              </form>
            </>
          ) : (
            <div className="chat-empty">
              <h3>Ouvrez une conversation</h3>
              <p>
                Choisissez un profil lié à votre projet et à votre environnement pour commencer.
              </p>
            </div>
          )}
          {(failure || stale) && (
            <p className="agents-notice" role="alert">
              {failure ||
                "L’actualisation de la conversation a échoué. Réessayez avant une nouvelle action."}
            </p>
          )}
        </div>
        {detail.data && (
          <AgentsChatOutputs
            detail={detail.data}
            post={post}
            disabled={disabled}
            fresh={fresh && !stale && !readOnly}
          />
        )}
      </div>
    </section>
  );
}
