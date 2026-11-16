import {
  AGENT_TOOL_NAMES,
  AGENT_TOOL_RESOURCES,
  type AgentProfileView,
  AgentTaskToolSelection,
  type AgentToolName,
  AgentToolPolicy,
} from "@godseye/contracts";
import { useId, useState } from "react";
import { Input } from "./ui/input";

export const toolLabels: Record<AgentToolName, string> = {
  godseye_workspace_list: "Lister les fichiers",
  godseye_workspace_read: "Lire un fichier",
  godseye_workspace_write: "Écrire un fichier",
  godseye_workspace_search: "Chercher du texte",
  godseye_json_validate: "Vérifier du JSON",
};
export const defaultToolPolicy: AgentToolPolicy = {
  version: 1,
  tools: [...AGENT_TOOL_NAMES],
  maxCalls: 3,
  timeoutSeconds: 30,
  maxReadBytes: 65536,
  maxWriteBytes: 65536,
  maxWorkspaceBytes: 1048576,
  maxOutputBytes: 32768,
  resources: AGENT_TOOL_RESOURCES,
};
export function toolPolicyFromForm(data: FormData): AgentToolPolicy | null {
  if (data.get("tools-enabled") !== "on") return null;
  return AgentToolPolicy.parse({
    version: 1,
    tools: data.getAll("tools-name"),
    resources: AGENT_TOOL_RESOURCES,
    ...Object.fromEntries(
      [
        "maxCalls",
        "timeoutSeconds",
        "maxReadBytes",
        "maxWriteBytes",
        "maxWorkspaceBytes",
        "maxOutputBytes",
      ].map((key) => [key, Number(data.get(`tools-${key}`))]),
    ),
  });
}
export function toolGrantFromForm(data: FormData) {
  const policy = toolPolicyFromForm(data);
  if (!policy) return undefined;
  const content = String(data.get("tools-seed-content") ?? "");
  return AgentTaskToolSelection.parse({
    policy,
    maxModelRequests: Number(data.get("tools-model-requests")),
    workspace: {
      kind: "scratch",
      files: content ? [{ path: String(data.get("tools-seed-path")), content }] : [],
    },
  });
}

/** One explicit opt-in, with detailed ceilings folded away until needed. */
export function AgentsToolsFields({
  profile,
  policy,
  mode,
  disabled,
  available = true,
}: {
  profile?: AgentProfileView;
  policy?: AgentToolPolicy;
  mode: "profile" | "task" | "message";
  disabled: boolean;
  available?: boolean;
}) {
  const id = useId(),
    [enabled, setEnabled] = useState(mode === "profile" && !!policy);
  const ceiling = policy ?? profile?.toolPolicy ?? defaultToolPolicy;
  const limits = mode === "profile" ? defaultToolPolicy : ceiling;
  const defaults = mode === "profile" ? (policy ?? defaultToolPolicy) : ceiling;
  const fields = [
    ["maxCalls", "Appels d’outils maximum"],
    ["timeoutSeconds", "Durée des outils (secondes)"],
    ["maxReadBytes", "Lecture totale (octets)"],
    ["maxWriteBytes", "Écriture totale (octets)"],
    ["maxWorkspaceBytes", "Espace de fichiers (octets)"],
    ["maxOutputBytes", "Résultats et exports (octets)"],
  ] as const;
  return (
    <fieldset className="agents-tools-fields agents-wide" disabled={disabled}>
      <label className="agents-tool-toggle" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          name="tools-enabled"
          type="checkbox"
          checked={enabled}
          disabled={disabled || (mode !== "profile" && (!profile?.toolPolicy || !available))}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        {mode === "profile"
          ? "Autoriser les outils de fichiers"
          : mode === "task"
            ? "Outils pour cette tâche"
            : "Outils pour ce message"}
      </label>
      <p className="muted">
        Fichiers copiés dans un espace privé jetable. Les commandes système et les builds restent
        indisponibles.
      </p>
      {mode !== "profile" && (!profile?.toolPolicy || !available) && (
        <p className="agents-notice">
          {!profile?.toolPolicy
            ? "Activez d’abord une politique d’outils dans le profil."
            : "Le runtime d’outils isolé est indisponible."}
        </p>
      )}
      <fieldset disabled={!enabled || disabled} hidden={!enabled} className="agents-tools-options">
        <div className="agents-tool-catalog">
          {(mode === "profile" ? AGENT_TOOL_NAMES : ceiling.tools).map((name) => (
            <label key={name}>
              <input
                name="tools-name"
                type="checkbox"
                value={name}
                defaultChecked={defaults.tools.includes(name)}
              />
              {toolLabels[name]}
            </label>
          ))}
        </div>
        <label htmlFor={`${id}-model`}>
          Requêtes modèle maximum
          <Input
            id={`${id}-model`}
            name="tools-model-requests"
            type="number"
            min={2}
            max={mode === "profile" ? 4 : (profile?.limits.maxRequests ?? 4)}
            defaultValue={
              profile?.limits.maxRequests && profile.limits.maxRequests > 1
                ? profile.limits.maxRequests
                : 4
            }
          />
        </label>
        <details>
          <summary>Plafonds avancés des outils</summary>
          <div className="agents-fields">
            {fields.map(([key, label]) => (
              <label key={key} htmlFor={`${id}-${key}`}>
                {label}
                <Input
                  id={`${id}-${key}`}
                  name={`tools-${key}`}
                  type="number"
                  min={1}
                  max={limits[key]}
                  defaultValue={defaults[key]}
                />
              </label>
            ))}
          </div>
        </details>
        {mode !== "profile" && (
          <details>
            <summary>Copier un fichier texte pour cette tâche</summary>
            <label htmlFor={`${id}-seed-path`}>
              Chemin du fichier copié
              <Input
                id={`${id}-seed-path`}
                name="tools-seed-path"
                defaultValue="scratch/input.txt"
                maxLength={160}
              />
            </label>
            <label htmlFor={`${id}-seed`}>
              Contenu du fichier copié
              <textarea id={`${id}-seed`} name="tools-seed-content" rows={4} maxLength={16384} />
            </label>
          </details>
        )}
        <p className="muted">
          512 Mio de mémoire · aucun swap · 0,5 CPU · 128 processus. La réservation USD couvre toute
          la tâche et toutes ses requêtes.
        </p>
        {mode === "profile" && (
          <p className="agents-notice">
            L’activation ou l’extension exige une validation récente par passkey. Chaque tâche
            choisira ensuite ses propres droits.
          </p>
        )}
      </fieldset>
    </fieldset>
  );
}
