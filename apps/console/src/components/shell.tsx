import { Link, useLocation } from "@tanstack/react-router";
import {
  Activity,
  ArrowUpRight,
  Bot,
  Box,
  ChevronRight,
  CircleHelp,
  Database,
  Eye,
  GitBranch,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Radio,
  Server,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useOwner } from "./owner-gate";

const navigation = [
  { to: "/", label: "Vue d’ensemble", icon: LayoutDashboard },
  { to: "/projects", label: "Projets", icon: Box },
  { to: "/databases", label: "Bases de données", icon: Database },
  { to: "/pipelines", label: "CI / CD", icon: GitBranch },
  { to: "/jobs", label: "Jobs", icon: ListChecks },
  { to: "/usage", label: "Consommation et budgets", icon: Activity },
  { to: "/observability", label: "Observabilité et incidents", icon: Radio },
  { to: "/operations", label: "Opérations", icon: Activity },
  { to: "/infrastructure", label: "Infrastructure", icon: Server },
  { to: "/agents", label: "Hermes CORE", icon: Bot },
  { to: "/security", label: "Accès propriétaire", icon: ShieldCheck },
  { to: "/access", label: "Secrets & services", icon: KeyRound },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const { status } = useOwner();
  const { pathname } = useLocation();
  const active = navigation.find((item) =>
    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to),
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Aller au contenu
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="G.O.D.S.E.Y.E, accueil">
          <span className="brand-mark">
            <Eye size={25} />
          </span>
          <span>
            G.O.D.S.E.Y.E<small>PRIVATE CONTROL PLANE</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="status-dot" /> Espace propriétaire <ShieldCheck size={14} />
        </div>
        <p className="nav-label">PILOTAGE</p>
        <nav aria-label="Navigation principale">
          {navigation.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="nav-link"
              activeProps={{ className: "nav-link active", "aria-current": "page" }}
              activeOptions={{ exact: to === "/" }}
            >
              <Icon size={18} strokeWidth={1.7} />
              <span>{label}</span>
              {active?.to === to && <ChevronRight size={14} />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={18} />
            <div>
              Accès privé<small>Session de développement locale</small>
            </div>
          </div>
          <a
            className="source-link"
            href="https://github.com/NousResearch/hermes-agent"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={15} /> Documentation Hermes <ArrowUpRight size={13} />
          </a>
          <div className="owner">
            <span>{status.owner?.name.slice(0, 2).toLocaleUpperCase("fr") ?? "PR"}</span>
            <div>
              {status.owner?.name ?? "Propriétaire"}
              <small>Session propriétaire · local</small>
            </div>
            <span className="owner-indicator" />
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">
            Espace personnel <ChevronRight size={13} />
            <strong>{active?.label ?? "Projet"}</strong>
          </div>
          <div className="local-pill">
            <Radio size={13} /> Développement local
          </div>
        </header>
        <div className="connection-strip">
          <span className="status-dot amber" />
          <strong>Serveur non connecté</strong>
          <span>Vos configurations sont enregistrées sur cet ordinateur.</span>
          <Link to="/infrastructure">
            Voir la préparation <ArrowUpRight size={13} />
          </Link>
        </div>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>
            G.O.D.S.E.Y.E <span className="mono">/ 0.1.0</span>
          </span>
          <span>Local d’abord. Votre infrastructure ensuite.</span>
        </footer>
      </div>
    </div>
  );
}
