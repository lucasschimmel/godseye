import type { AccessOverviewView, ProjectDTO } from "@godseye/contracts";
import { environmentLabel, ordinaryEnvironment } from "./environment-labels";

export type ProviderState = AccessOverviewView["provider"]["state"];
export type BindingState =
  | "no-identity"
  | "revoked"
  | "no-slot"
  | "empty"
  | "staged"
  | "active"
  | "unknown";

export const bindingLabels: Record<BindingState, string> = {
  "no-identity": "Aucune identité de service",
  revoked: "Identité révoquée",
  "no-slot": "Identité sans emplacement",
  empty: "Emplacement vide : aucune valeur importée",
  staged: "Candidat préparé, pas encore actif",
  active: "Valeur active dans OpenBao",
  unknown: "État à réconcilier",
};

/** What each broker state means for the owner, and what to do about it. No state is shown as healthy without proof. */
export const providerExplanations: Record<ProviderState, string> = {
  unconfigured:
    "Aucun coffre OpenBao n’est branché sur le contrôleur : aucun import ni accès ne peut être émis. Configurez l’adresse et l’autorité du coffre côté serveur, puis redémarrez le contrôleur.",
  ready: "Le coffre répond et accepte de nouveaux accès.",
  sealed:
    "Le coffre est scellé : les nouveaux accès sont bloqués, les services gardent les valeurs déjà montées. Descellez-le depuis le serveur.",
  uninitialized: "Le coffre n’est pas initialisé : il faut l’initialiser depuis le serveur.",
  unauthorized:
    "Le coffre refuse l’autorité du contrôleur : vérifiez le jeton ou la politique côté serveur.",
  unavailable: "Le coffre ne répond pas : aucun état n’est présumé, réessayez après vérification.",
  invalid: "La réponse du coffre est invalide : aucun état n’est présumé.",
};

export interface SlotRow {
  id: string;
  name: string;
  state: AccessOverviewView["slots"][number]["state"];
  activeVersion: number | null;
  stagedVersion: number | null;
  /** Latest recorded import/transition for this slot, ISO timestamp; null when none was recorded. */
  lastOperationAt: string | null;
}
export interface IdentityRow {
  id: string;
  name: string;
  purpose: AccessOverviewView["identities"][number]["purpose"];
  status: "active" | "revoked";
  slots: SlotRow[];
}
export interface BindingRow {
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  state: BindingState;
  identities: IdentityRow[];
  lastOperationAt: string | null;
}

const later = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));
function stateOf(identities: IdentityRow[]): BindingState {
  if (identities.length === 0) return "no-identity";
  const live = identities.filter((item) => item.status === "active");
  if (live.length === 0) return "revoked";
  const slots = live.flatMap((item) => item.slots);
  if (slots.length === 0) return "no-slot";
  if (slots.some((slot) => slot.state === "unknown")) return "unknown";
  if (slots.some((slot) => slot.state === "staged")) return "staged";
  if (slots.some((slot) => slot.state === "active")) return "active";
  return "empty";
}

/** One row per ordinary project environment, from metadata only (names, versions, timestamps). */
export function bindingRows(projects: ProjectDTO[], access: AccessOverviewView): BindingRow[] {
  const rows: BindingRow[] = [];
  for (const project of projects) {
    for (const environment of project.environments.filter(ordinaryEnvironment)) {
      const identities: IdentityRow[] = access.identities
        .filter((i) => i.projectId === project.id && i.environmentId === environment.id)
        .map((identity) => ({
          id: identity.id,
          name: identity.name,
          purpose: identity.purpose,
          status: identity.status,
          slots: access.slots
            .filter((slot) => slot.identityId === identity.id)
            .map((slot) => ({
              id: slot.id,
              name: slot.name,
              state: slot.state,
              activeVersion: slot.activeVersion,
              stagedVersion: slot.stagedVersion,
              lastOperationAt: access.operations
                .filter((operation) => operation.slotId === slot.id)
                .reduce<string | null>((acc, op) => later(acc, op.createdAt), null),
            })),
        }));
      rows.push({
        projectId: project.id,
        projectName: project.name,
        environmentId: environment.id,
        environmentName: environmentLabel(environment),
        state: stateOf(identities),
        identities,
        lastOperationAt: identities
          .flatMap((i) => i.slots)
          .reduce<string | null>((acc, slot) => later(acc, slot.lastOperationAt), null),
      });
    }
  }
  return rows;
}

export const IMPORT_EXPLANATION = {
  where:
    "L’import d’une valeur se fait uniquement depuis le poste du propriétaire, par un tube privé (stdin) vers la commande d’accès du contrôleur, contrôleur arrêté.",
  why: "La console n’affiche ni ne reçoit jamais de valeur : un navigateur, un journal ou une requête HTTP ne doivent pas pouvoir la capter. La console ne montre que des noms, des versions et des dates.",
} as const;

export const rotationHeadings = {
  unconfigured: "Rotation des secrets non branchée",
  unavailable: "Rotation indisponible",
  qualified: "Rotation qualifiée",
} as const;
export const rotationExplanations = {
  unconfigured:
    "Aucun fournisseur de rotation n’est configuré sur le contrôleur : aucune rotation ne peut être lancée. L’historique reste lisible ; aucun état n’est présenté comme sain sans preuve.",
  unavailable:
    "Le fournisseur de rotation est configuré mais n’a pas été qualifié récemment : aucune rotation ne peut être lancée. L’historique reste lisible.",
  qualified:
    "Chaque rotation enregistre d’abord son intention, puis vérifie le résultat. Aucune valeur secrète n’est affichée.",
} as const;
