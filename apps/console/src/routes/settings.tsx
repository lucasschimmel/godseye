import { createFileRoute, Link } from "@tanstack/react-router";
import { Bell, KeyRound, ShieldCheck } from "lucide-react";
import { NotificationChannelsPanel } from "@/components/notification-channels-panel";
import { OwnerSecurity } from "@/components/settings/owner-access";
import { AccessManagement } from "@/components/settings/service-access";
import { PageHeading } from "@/components/shared";

const SECTIONS = {
  proprietaire: { label: "Accès propriétaire", icon: ShieldCheck },
  services: { label: "Secrets et services", icon: KeyRound },
  notifications: { label: "Notifications", icon: Bell },
} as const;
type Section = keyof typeof SECTIONS;

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { section?: Section } => ({
    section:
      typeof search.section === "string" && search.section in SECTIONS
        ? (search.section as Section)
        : undefined,
  }),
  component: Settings,
});

function Settings() {
  const { section = "proprietaire" } = Route.useSearch();
  return (
    <>
      <PageHeading
        eyebrow="Compte propriétaire"
        title="Réglages"
        description="Passkeys et sessions, secrets et identités de service, canaux d’alerte."
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Sections des réglages">
          {(Object.keys(SECTIONS) as Section[]).map((key) => {
            const Icon = SECTIONS[key].icon;
            return (
              <Link
                key={key}
                to="/settings"
                search={{ section: key }}
                aria-current={section === key ? "page" : undefined}
              >
                <Icon size={15} />
                {SECTIONS[key].label}
              </Link>
            );
          })}
        </nav>
        <div className="settings-body">
          {section === "proprietaire" && <OwnerSecurity />}
          {section === "services" && <AccessManagement />}
          {section === "notifications" && <NotificationChannelsPanel />}
        </div>
      </div>
    </>
  );
}
