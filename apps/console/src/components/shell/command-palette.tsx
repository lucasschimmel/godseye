import type { ProjectView } from "@godseye/contracts";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Box, Contrast, type LucideIcon, MessageSquarePlus, Plus, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { resource } from "@/lib/api";
import { ALL_NAV_ITEMS } from "@/lib/navigation";

interface Command {
  id: string;
  group: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

/** Ctrl/Cmd+K palette: every page, every project and the frequent actions. */
export function CommandPalette({
  open,
  onClose,
  toggleTheme,
}: {
  open: boolean;
  onClose: () => void;
  toggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const projects = useQuery({ ...resource<ProjectView[]>("projects", "/projects"), enabled: open });
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const commands = useMemo<Command[]>(() => {
    const go = (to: string, search?: Record<string, string>) => () =>
      void navigate({ to, search: search as never });
    return [
      ...ALL_NAV_ITEMS.map((item) => ({
        id: `nav-${item.key}`,
        group: "Aller à",
        label: item.label,
        icon: item.icon,
        run: go(item.to),
      })),
      ...(projects.data ?? []).map((project) => ({
        id: `project-${project.id}`,
        group: "Projet",
        label: project.name,
        icon: Box,
        run: () => void navigate({ to: "/projects/$projectId", params: { projectId: project.id } }),
      })),
      {
        id: "new-project",
        group: "Action",
        label: "Nouveau projet",
        icon: Plus,
        run: go("/projects/new"),
      },
      {
        id: "new-thread",
        group: "Action",
        label: "Nouvelle conversation Hermes",
        icon: MessageSquarePlus,
        run: go("/hermes", { vue: "conversations" }),
      },
      {
        id: "theme",
        group: "Action",
        label: "Basculer le thème",
        icon: Contrast,
        run: toggleTheme,
      },
    ];
  }, [navigate, projects.data, toggleTheme]);
  const visible = commands.filter((command) =>
    command.label.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr")),
  );
  const selected = Math.min(index, Math.max(visible.length - 1, 0));
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    inputRef.current?.focus();
  }, [open]);
  if (!open) return null;
  function run(command: Command | undefined) {
    if (!command) return;
    onClose();
    command.run();
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click is a pointer shortcut; Escape closes for keyboard users.
    <div
      className="overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Palette de commandes">
        <label className="palette-input">
          <Search size={16} />
          <span className="sr-only">Rechercher une page, un projet ou une action</span>
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={
              visible[selected] ? `${listId}-${visible[selected].id}` : undefined
            }
            placeholder="Aller à, ou lancer une action…"
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((selected + 1) % Math.max(visible.length, 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((selected - 1 + visible.length) % Math.max(visible.length, 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(visible[selected]);
              } else if (event.key === "Escape") onClose();
            }}
          />
        </label>
        <div id={listId} role="listbox" aria-label="Résultats" className="palette-list">
          {visible.map((command, position) => {
            const Icon = command.icon;
            return (
              <button
                key={command.id}
                type="button"
                id={`${listId}-${command.id}`}
                role="option"
                aria-selected={position === selected}
                onMouseEnter={() => setIndex(position)}
                onClick={() => run(command)}
              >
                <span className="nav-tile">
                  <Icon size={15} />
                </span>
                <span>{command.label}</span>
                <span className="faint small">{command.group}</span>
              </button>
            );
          })}
          {!visible.length && <p className="palette-empty">Aucun résultat</p>}
        </div>
        <footer>
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> naviguer
          </span>
          <span>
            <kbd>Entrée</kbd> ouvrir
          </span>
          <span>
            <kbd>Échap</kbd> fermer
          </span>
          <span>
            raccourcis <kbd>G</kbd> puis la lettre de la page
          </span>
        </footer>
      </div>
    </div>
  );
}
