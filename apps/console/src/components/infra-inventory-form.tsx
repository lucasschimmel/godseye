import type {
  DeclareInventoryInput,
  InfrastructureCapacityInput,
  InfrastructureOverviewView,
} from "@godseye/contracts";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const capacities = ["cpuMilliCores", "memoryMiB", "storageGiB", "pids"] as const;
const labels = {
  cpuMilliCores: "CPU (millicœurs)",
  memoryMiB: "Mémoire (MiB)",
  storageGiB: "Stockage (GiB)",
  pids: "Plafond PID",
};
const capacity = (
  cpuMilliCores: number,
  memoryMiB: number,
  storageGiB: number,
  pids: number,
): InfrastructureCapacityInput => ({ cpuMilliCores, memoryMiB, storageGiB, pids });
const plannedInventory: DeclareInventoryInput = {
  expectedRevision: 0,
  host: {
    name: "Hôte dédié prévu",
    capacity: capacity(8000, 65536, 960, 65536),
    headroom: capacity(1000, 4096, 32, 1024),
  },
  guests: [
    { role: "professional", capacity: capacity(4000, 40960, 512, 32768) },
    { role: "games", capacity: capacity(2000, 16384, 256, 8192) },
  ],
  pool: {
    capacity: capacity(3500, 32768, 400, 16384),
    headroom: capacity(500, 2048, 16, 256),
    ipv4Pool: "10.80.0.0/16",
    ipv6Pool: "fd80:4753:4500::/48",
  },
  publicIpv4Count: 1,
};
function CapacityFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: InfrastructureCapacityInput;
  onChange: (next: InfrastructureCapacityInput) => void;
}) {
  const prefix = useId();
  return (
    <fieldset className="infra-capacity">
      <legend>{label}</legend>
      <div className="infra-fields">
        {capacities.map((field) => (
          <label key={field} htmlFor={`${prefix}-${field}`}>
            {labels[field]}
            <Input
              id={`${prefix}-${field}`}
              aria-label={`${label} · ${labels[field]}`}
              type="number"
              min="1"
              required
              value={value[field]}
              onChange={(event) => onChange({ ...value, [field]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function InfrastructureInventoryForm({
  overview,
  disabled,
  save,
}: {
  overview: InfrastructureOverviewView;
  disabled: boolean;
  save: (input: DeclareInventoryInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DeclareInventoryInput>(() =>
    structuredClone(overview.desired ?? plannedInventory),
  );
  return (
    <form
      className="infra-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save({ ...draft, expectedRevision: overview.revision });
      }}
    >
      <p className="muted">
        Valeurs de planification à confirmer. Cette déclaration ne mesure aucun serveur et n’accorde
        aucune qualification.
      </p>
      <label htmlFor="infra-host-name">
        Nom de l’hôte
        <Input
          id="infra-host-name"
          required
          value={draft.host.name}
          onChange={(event) =>
            setDraft({ ...draft, host: { ...draft.host, name: event.target.value } })
          }
        />
      </label>
      <CapacityFields
        label="Hôte physique"
        value={draft.host.capacity}
        onChange={(next) => setDraft({ ...draft, host: { ...draft.host, capacity: next } })}
      />
      <CapacityFields
        label="Marge hôte"
        value={draft.host.headroom}
        onChange={(next) => setDraft({ ...draft, host: { ...draft.host, headroom: next } })}
      />
      {draft.guests.map((guest, index) => (
        <CapacityFields
          key={guest.role}
          label={
            guest.role === "professional"
              ? "VM professionnelle"
              : guest.role === "games"
                ? "VM jeux"
                : "VM tâche jetable"
          }
          value={guest.capacity}
          onChange={(next) =>
            setDraft({
              ...draft,
              guests: draft.guests.map((item, position) =>
                position === index ? { ...item, capacity: next } : item,
              ),
            })
          }
        />
      ))}
      <label className="infra-checkbox">
        <input
          type="checkbox"
          checked={draft.guests.some((guest) => guest.role === "task")}
          onChange={(event) =>
            setDraft({
              ...draft,
              guests: event.target.checked
                ? [...draft.guests, { role: "task", capacity: capacity(500, 1024, 16, 256) }]
                : draft.guests.filter((guest) => guest.role !== "task"),
            })
          }
        />
        Prévoir une VM tâche jetable
      </label>
      <CapacityFields
        label="Pool professionnel"
        value={draft.pool.capacity}
        onChange={(next) => setDraft({ ...draft, pool: { ...draft.pool, capacity: next } })}
      />
      <CapacityFields
        label="Marge du pool"
        value={draft.pool.headroom}
        onChange={(next) => setDraft({ ...draft, pool: { ...draft.pool, headroom: next } })}
      />
      <div className="infra-fields">
        <label htmlFor="infra-ipv4-pool">
          Pool IPv4 privé
          <Input
            id="infra-ipv4-pool"
            value={draft.pool.ipv4Pool}
            required
            onChange={(event) =>
              setDraft({ ...draft, pool: { ...draft.pool, ipv4Pool: event.target.value } })
            }
          />
        </label>
        <label htmlFor="infra-ipv6-pool">
          Pool IPv6 ULA
          <Input
            id="infra-ipv6-pool"
            value={draft.pool.ipv6Pool}
            required
            onChange={(event) =>
              setDraft({ ...draft, pool: { ...draft.pool, ipv6Pool: event.target.value } })
            }
          />
        </label>
      </div>
      <label>
        IPv4 publiques prévues
        <select
          value={draft.publicIpv4Count}
          onChange={(event) =>
            setDraft({ ...draft, publicIpv4Count: Number(event.target.value) as 1 | 2 })
          }
        >
          <option value="1">1 · référence</option>
          <option value="2">2 · exception justifiée</option>
        </select>
      </label>
      {draft.publicIpv4Count === 2 && (
        <label htmlFor="infra-second-ipv4">
          Justification de la seconde IPv4
          <Input
            id="infra-second-ipv4"
            required
            minLength={10}
            value={draft.secondIpv4Justification ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, secondIpv4Justification: event.target.value })
            }
          />
        </label>
      )}
      <Button disabled={disabled} type="submit">
        Enregistrer l’inventaire souhaité
      </Button>
    </form>
  );
}
