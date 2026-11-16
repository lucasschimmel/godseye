import type { Overview } from "@godseye/contracts";

export type DeploymentMode = Overview["mode"];

/** What the console knows about where the control plane runs. `known` is false until /overview answered. */
export interface Deployment {
  known: boolean;
  mode: DeploymentMode | undefined;
  isServer: boolean;
  isLocal: boolean;
  serverConnected: boolean;
}

export const UNKNOWN_DEPLOYMENT: Deployment = {
  known: false,
  mode: undefined,
  isServer: false,
  isLocal: false,
  serverConnected: false,
};

export function describeDeployment(
  overview: Pick<Overview, "mode" | "qualification"> | undefined,
): Deployment {
  if (!overview) return UNKNOWN_DEPLOYMENT;
  return {
    known: true,
    mode: overview.mode,
    isServer: overview.mode === "server",
    isLocal: overview.mode === "local",
    serverConnected: overview.qualification.serverConnected,
  };
}

/** Wording of the shell chrome, per deployment mode. */
export interface ShellCopy {
  pill: string;
  strip: { tone: "amber" | "green"; title: string; detail: string };
  sidebarSession: string;
  ownerSession: string;
  footer: string;
}

export function shellCopy(deployment: Deployment): ShellCopy | undefined {
  if (!deployment.known) return undefined;
  if (deployment.isServer)
    return {
      pill: "Serveur dédié",
      strip: deployment.serverConnected
        ? {
            tone: "green",
            title: "Serveur dédié connecté",
            detail: "Console servie par le serveur, accessible par le réseau privé WireGuard.",
          }
        : {
            tone: "amber",
            title: "Serveur dédié non confirmé",
            detail: "Le mode serveur est actif mais la connexion n’est pas confirmée.",
          },
      sidebarSession: "Session sécurisée par passkey",
      ownerSession: "Session propriétaire · serveur",
      footer: "Votre infrastructure, sous votre contrôle.",
    };
  return {
    pill: "Développement local",
    strip: {
      tone: "amber",
      title: "Serveur non connecté",
      detail: "Vos configurations sont enregistrées sur cet ordinateur.",
    },
    sidebarSession: "Session de développement locale",
    ownerSession: "Session propriétaire · local",
    footer: "Local d’abord. Votre infrastructure ensuite.",
  };
}

/** Owner-entry/recovery wording. The unauthenticated entry cannot read /overview, so it keys on the host. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Hermes runtime state label; local mode keeps its wording, server mode drops "local"/"à connecter". */
export function runtimeHeading(available: boolean, isLocal: boolean): string {
  if (isLocal) return available ? "Runtime local configuré" : "Runtime local à connecter";
  return available ? "Runtime configuré" : "Runtime à qualifier";
}

export const OWNER_SETUP_COMMAND = "bun run owner:setup";
export const OWNER_RECOVER_COMMAND = "bun run owner:recover";
export const OWNER_RECOVER_OFFLINE_COMMAND = "bun run owner:recover --offline";

export interface OwnerEntryCopy {
  unavailable: string;
  firstAccess: string;
  setupHint: string;
  footer: string;
}

const REMOTE_ENTRY: OwnerEntryCopy = {
  unavailable:
    "L’API n’est pas joignable. Vérifiez votre connexion WireGuard ; si elle persiste, suivez la procédure d’accès d’urgence.",
  firstAccess:
    "Le premier accès se prépare sur le serveur, jamais depuis ce navigateur : connectez-vous au serveur par WireGuard et SSH, puis lancez la commande avec l’environnement du service. Une seule identité propriétaire est autorisée.",
  setupHint:
    "Ouvrez ensuite le lien à usage unique affiché, depuis un appareil relié au réseau privé.",
  footer: "Accès privé · réseau WireGuard",
};

const LOCAL_ENTRY: OwnerEntryCopy = {
  unavailable: "L’API locale n’est pas disponible. Vérifiez que le service est lancé.",
  firstAccess:
    "Préparez votre premier accès depuis le terminal local. Une seule identité propriétaire est autorisée.",
  setupHint: "Ouvrez ensuite le lien à usage unique affiché dans votre terminal.",
  footer: "Exécution locale · localhost",
};

/** `hostname` is null before the browser mounted: stay neutral rather than promise a local terminal. */
export function ownerEntryCopy(hostname: string | null): OwnerEntryCopy {
  if (hostname !== null && isLoopbackHost(hostname)) return LOCAL_ENTRY;
  return REMOTE_ENTRY;
}

export interface RecoveryCopy {
  title: string;
  intro: string;
  offline: string;
  /** Path of the repository document that describes the procedure, shown as plain text. */
  procedure?: string;
}

export function recoveryCopy(deployment: Deployment): RecoveryCopy {
  if (!deployment.isLocal)
    return {
      title: "Récupération indépendante du navigateur",
      intro:
        "Sur le serveur dédié, la récupération ne passe jamais par ce navigateur ni par un terminal de cet appareil. Connectez-vous au serveur par WireGuard puis SSH, en tant qu’utilisateur du service avec son environnement, pour préparer une nouvelle clé et révoquer les anciens accès :",
      offline:
        "Si l’API est arrêtée, arrêtez le service puis utilisez la variante hors ligne ci-dessous. Si WireGuard est indisponible, suivez la procédure d’accès d’urgence (Rescue Hetzner) avant toute récupération.",
      procedure: "docs/operations/break-glass.md · docs/development/owner-access.md",
    };
  return {
    title: "Récupération indépendante du navigateur",
    intro:
      "Depuis le terminal de cette machine, préparez une nouvelle clé et révoquez les anciens accès :",
    offline:
      "Si l’API est arrêtée, utilisez la variante hors ligne ci-dessous, puis redémarrez le panneau. Cette commande exige l’accès au répertoire local privé.",
  };
}
