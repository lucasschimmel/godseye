import type {
  AgentOverviewView,
  OperationalOverviewView,
  OwnerAuthenticatedView,
  ServerObservationView,
} from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fingerprint, Search } from "lucide-react";
import { resource } from "@/lib/api";
import { NAV_GROUPS, type NavItem, type NavKey, SETTINGS_ITEM } from "@/lib/navigation";
import {
  cpuLoadPercent,
  memoryUsedPercent,
  oldestBackupAgeHours,
  relativeTime,
  uptimeLabel,
} from "@/lib/server-metrics";
import { BrandMark, HermesMark, Ring, StepsBar } from "../ds/viz";

const ACTIVE_TASK_STATES = new Set(["queued", "running", "cancel_requested"]);

type Badge = { value: string; tone: "signal" | "danger" | "live" } | null;

function HostCard({ server }: { server: ServerObservationView | undefined }) {
  const cpu = cpuLoadPercent(server);
  const memory = memoryUsedPercent(server);
  const uptime = uptimeLabel(server);
  // The dot pulses only when something was actually measured.
  const known = cpu !== null || memory !== null || uptime !== null;
  return (
    <Link to="/platform/server" className="host-card">
      <span className="hc-top">
        <span className={`live-dot ${known ? "" : "off"}`} aria-hidden="true" />
        <b>Serveur</b>
        <span className="mono">{uptime ? `en ligne ${uptime}` : "non mesuré"}</span>
      </span>
      {[
        ["CPU", cpu],
        ["RAM", memory],
      ].map(([label, value]) => (
        <span className="hc-row" key={label}>
          <span>{label}</span>
          <i className={value === null ? "unknown" : ""}>
            {value !== null && (
              <b
                className={Number(value) >= 80 ? "hot" : ""}
                style={{ width: `${Math.min(Number(value), 100)}%` }}
              />
            )}
          </i>
          <span className="mono">{value ?? "?"}</span>
        </span>
      ))}
    </Link>
  );
}

function NavLink({ item, badge }: { item: NavItem; badge: Badge }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      className="nav-item"
      activeOptions={{ exact: item.to === "/" }}
      activeProps={{ "aria-current": "page" }}
    >
      <span className="nav-tile">
        <Icon size={16} strokeWidth={1.8} />
      </span>
      <span className="nav-label">{item.label}</span>
      {badge && <span className={`nav-badge ${badge.tone}`}>{badge.value}</span>}
      <span className="nav-kbd" aria-hidden="true">
        G {item.shortcut}
      </span>
    </Link>
  );
}

export function Rail({
  owner,
  open,
  onSearch,
}: {
  owner: OwnerAuthenticatedView;
  open: boolean;
  onSearch: () => void;
}) {
  const server = useQuery({
    ...resource<ServerObservationView>("server-observation", "/infrastructure/server"),
    refetchInterval: 60_000,
  });
  const operational = useQuery({
    ...resource<OperationalOverviewView>("operational-overview", "/overview/operational"),
    refetchInterval: 30_000,
  });
  const agents = useQuery({
    ...resource<AgentOverviewView>("agents", "/agents"),
    refetchInterval: 15_000,
  });
  const running = (agents.data?.tasks ?? []).filter((task) => ACTIVE_TASK_STATES.has(task.state));
  const backupAge = oldestBackupAgeHours(server.data);
  const badges: Partial<Record<NavKey, Badge>> = {
    today: operational.data?.pendingDecisions
      ? { value: String(operational.data.pendingDecisions), tone: "signal" }
      : null,
    hermes: running.length ? { value: String(running.length), tone: "live" } : null,
    data: backupAge !== null && backupAge > 24 ? { value: "!", tone: "danger" } : null,
    journal: operational.data?.activeIncidents
      ? { value: String(operational.data.activeIncidents), tone: "danger" }
      : null,
    jobs: operational.data?.jobs.unknown
      ? { value: String(operational.data.jobs.unknown), tone: "signal" }
      : null,
  };
  const sessionLeftMs = new Date(owner.session.expiresAt).getTime() - Date.now();
  const sessionTotalMs =
    new Date(owner.session.expiresAt).getTime() - new Date(owner.session.createdAt).getTime();
  const sessionPct = sessionTotalMs > 0 ? (sessionLeftMs / sessionTotalMs) * 100 : 0;
  const hoursLeft = Math.max(0, Math.floor(sessionLeftMs / 3_600_000));
  const minutesLeft = Math.max(0, Math.floor((sessionLeftMs % 3_600_000) / 60_000));
  return (
    <aside className="rail" aria-label="Barre latérale" data-open={open}>
      <Link to="/" className="brand">
        <span className="brand-mark">
          <BrandMark />
        </span>
        <span className="brand-text">
          G.O.D.S.E.Y.E<small>plan de contrôle privé</small>
        </span>
      </Link>
      <HostCard server={server.data} />
      <button type="button" className="rail-search" onClick={onSearch}>
        <Search size={14} />
        <span>Rechercher, agir…</span>
        <kbd>Ctrl K</kbd>
      </button>
      <nav className="rail-nav" aria-label="Navigation principale">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="nav-group">{group.label}</p>
            {group.items.map((item) => (
              <NavLink key={item.key} item={item} badge={badges[item.key] ?? null} />
            ))}
          </div>
        ))}
      </nav>
      {running.length > 0 && (
        <Link to="/hermes" className="rail-hermes">
          <span className="rh-top">
            <HermesMark size={22} />
            <b>Hermes</b>
            <span className="dim">
              {running.length} tâche{running.length > 1 ? "s" : ""} active
              {running.length > 1 ? "s" : ""}
            </span>
          </span>
          {running.slice(0, 3).map((task) => (
            <span className="rh-row" key={task.id}>
              <span>{task.input}</span>
              <StepsBar total={3} done={task.state === "queued" ? 0 : 1} running />
            </span>
          ))}
        </Link>
      )}
      <div className="rail-foot">
        <NavLink item={SETTINGS_ITEM} badge={null} />
        <div className="owner-card">
          <Ring pct={sessionPct} size={34} hot={sessionPct < 15} label="Session restante">
            {owner.owner.name.slice(0, 2).toLocaleUpperCase("fr")}
          </Ring>
          <div>
            <b>{owner.owner.name}</b>
            <small>
              <Fingerprint size={11} />
              session ouverte {relativeTime(owner.session.createdAt)}
            </small>
          </div>
          <span className="session mono" title="Temps de session restant">
            {hoursLeft} h {String(minutesLeft).padStart(2, "0")}
          </span>
        </div>
      </div>
    </aside>
  );
}
