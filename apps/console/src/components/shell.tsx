import { CONTROL_API_VERSION } from "@godseye/contracts";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Contrast, Menu } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { shellCopy } from "@/lib/deployment";
import { ALL_NAV_ITEMS, activeNavItem, NAV_GROUPS } from "@/lib/navigation";
import { FALLBACK_PAGE_LABEL } from "@/lib/route-announcement";
import { useTheme } from "@/lib/theme";
import { useDeployment } from "@/lib/use-deployment";
import { useOwner } from "./owner-gate";
import { RouteAnnouncer } from "./route-announcer";
import { CommandPalette } from "./shell/command-palette";
import { Overlays } from "./shell/overlays";
import { Rail } from "./shell/rail";
import { Button } from "./ui/button";

/** Lets a page add its own last breadcrumb (a project name, a sub-view). */
const CrumbContext = createContext<(tail: string | null) => void>(() => undefined);
export function usePageCrumb(tail: string | null) {
  const set = useContext(CrumbContext);
  useEffect(() => {
    set(tail);
    return () => set(null);
  }, [set, tail]);
}

const WIDE_ROUTES = ["/hermes"];

export function Shell({ children }: { children: ReactNode }) {
  const { status } = useOwner();
  const deployment = useDeployment();
  const copy = shellCopy(deployment);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toggle } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [tail, setTail] = useState<string | null>(null);
  const active = activeNavItem(pathname);
  const group = NAV_GROUPS.find((g) => g.items.some((item) => item.key === active?.key));
  const pendingG = useRef(0);

  // Close the mobile navigation after each navigation.
  useEffect(() => {
    if (pathname) setRailOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing =
        target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? "");
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toUpperCase();
      if (pendingG.current && Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        const item = ALL_NAV_ITEMS.find((candidate) => candidate.shortcut === key);
        if (item) void navigate({ to: item.to });
        return;
      }
      pendingG.current = key === "G" ? Date.now() : 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const pageLabel = tail ?? active?.label ?? FALLBACK_PAGE_LABEL;
  return (
    <Overlays>
      <CrumbContext.Provider value={setTail}>
        <div className="app-shell">
          <RouteAnnouncer pathname={pathname} label={pageLabel} />
          <a className="skip-link" href="#main-content">
            Aller au contenu
          </a>
          <Rail owner={status} open={railOpen} onSearch={() => setPaletteOpen(true)} />
          {railOpen && (
            <button
              type="button"
              className="rail-backdrop"
              aria-label="Fermer la navigation"
              onClick={() => setRailOpen(false)}
            />
          )}
          <div className="main-column">
            <header className="topbar">
              <div className="crumbs">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rail-toggle"
                  aria-label="Ouvrir la navigation"
                  onClick={() => setRailOpen((open) => !open)}
                >
                  <Menu />
                </Button>
                {group && <span>{group.label}</span>}
                {group && <ChevronRight size={12} aria-hidden="true" />}
                {tail && active ? (
                  <>
                    <Link to={active.to}>{active.label}</Link>
                    <ChevronRight size={12} aria-hidden="true" />
                    <strong>{tail}</strong>
                  </>
                ) : (
                  <strong>{active?.label ?? FALLBACK_PAGE_LABEL}</strong>
                )}
              </div>
              <div className="topbar-right">
                {copy && (
                  <span className="mode-pill" title={copy.strip.detail}>
                    <span
                      className={`live-dot ${copy.strip.tone === "green" ? "" : "warn"}`}
                      aria-hidden="true"
                    />
                    {copy.pill}
                  </span>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link to="/hermes" search={{ vue: "conversations" } as never}>
                    <span className="agent-dot" aria-hidden="true" />
                    <span className="agent-label">Demander à </span>Hermes
                  </Link>
                </Button>
                <Button variant="ghost" size="icon" aria-label="Basculer le thème" onClick={toggle}>
                  <Contrast />
                </Button>
              </div>
            </header>
            <main
              id="main-content"
              tabIndex={-1}
              key={pathname}
              className={WIDE_ROUTES.some((route) => pathname.startsWith(route)) ? "wide" : ""}
            >
              {children}
            </main>
            <footer className="app-footer">
              <span>
                G.O.D.S.E.Y.E <span className="mono">API {CONTROL_API_VERSION}</span>
              </span>
              <span>{copy?.footer ?? "Votre infrastructure, sous votre contrôle."}</span>
            </footer>
          </div>
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            toggleTheme={toggle}
          />
        </div>
      </CrumbContext.Provider>
    </Overlays>
  );
}
