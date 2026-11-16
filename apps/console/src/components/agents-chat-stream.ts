import {
  AgentChatEvent,
  type AgentConversationDetailView,
  CONTROL_API_VERSION,
  LOCAL_DEFAULTS,
} from "@godseye/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function useAgentChatStream(id: string, loaded: boolean) {
  const cache = useQueryClient();
  const [generation, reconnect] = useState(0);
  const [status, setStatus] = useState("Connexion…");
  useEffect(() => {
    if (!id || !loaded) return;
    setStatus(generation > 0 ? "Reconnexion…" : "Connexion…");
    const key = ["agent-chat", id];
    const snapshot = cache.getQueryData<AgentConversationDetailView>(key);
    const source = new EventSource(
      `${LOCAL_DEFAULTS.apiBase}/agents/conversations/${id}/events?after=${snapshot?.conversation.cursor ?? 0}`,
    );
    let stopped = false,
      failures = 0;
    const refresh = () => cache.invalidateQueries({ queryKey: key });
    source.addEventListener("ready", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (
          !value ||
          typeof value !== "object" ||
          !("version" in value) ||
          value.version !== CONTROL_API_VERSION
        )
          throw new Error("Unsupported chat stream");
        failures = 0;
        setStatus("En direct");
      } catch {
        source.close();
        setStatus("Flux incompatible. Actualisez la page.");
      }
    });
    source.addEventListener("chat", (event) => {
      try {
        const value = AgentChatEvent.parse(JSON.parse((event as MessageEvent<string>).data));
        if (value.conversationId !== id) throw new Error("Foreign chat stream");
        cache.setQueryData<AgentConversationDetailView>(key, (old) => {
          if (!old || value.cursor <= old.conversation.cursor) return old;
          if (value.cursor !== old.conversation.cursor + 1) {
            void refresh();
            return old;
          }
          return {
            ...old,
            conversation: { ...old.conversation, cursor: value.cursor },
            turns:
              value.type === "text.delta"
                ? old.turns.map((turn) =>
                    turn.id === value.turnId
                      ? { ...turn, partialText: turn.partialText + (value.text ?? "") }
                      : turn,
                  )
                : old.turns,
          };
        });
        if (value.type !== "text.delta") void refresh();
      } catch {
        source.close();
        setStatus("Flux interrompu. Rechargez la conversation.");
        void refresh();
      }
    });
    source.addEventListener("reset", () => {
      source.close();
      setStatus("Actualisation de l’historique…");
      void refresh().then(() => {
        if (!stopped) reconnect((n) => n + 1);
      });
    });
    source.onerror = () => {
      if (stopped) return;
      failures++;
      setStatus("Reconnexion…");
      void refresh();
      if (source.readyState === EventSource.CLOSED || failures >= 5) {
        source.close();
        setStatus("Flux hors connexion. Votre tâche reste suivie.");
      }
    };
    return () => {
      stopped = true;
      source.close();
    };
  }, [id, loaded, cache, generation]);
  return { status, reconnect: () => reconnect((n) => n + 1) };
}
