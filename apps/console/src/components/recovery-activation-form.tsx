import type {
  ActivationAssessmentView,
  EnvironmentView,
  ProjectDTO,
  RestoreActivationView,
} from "@godseye/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, resource } from "@/lib/api";
import {
  acknowledgementLabels,
  activationBlockerLabels,
  activationRequest,
  activationSubmittable,
} from "@/lib/recovery-activation";
import { Failure, Loading } from "./shared";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/** Owner-confirmed activation of a verified held restore; it states what is not restored and what stays held. */
export function RecoveryActivationForm({
  project,
  environment,
  fresh,
}: {
  project: ProjectDTO;
  environment: EnvironmentView;
  fresh: boolean;
}) {
  const cache = useQueryClient();
  const assessment = useQuery(
    resource<ActivationAssessmentView>(
      `recovery-activation-${environment.id}`,
      `/recovery/environments/${environment.id}/activation`,
    ),
  );
  const [typedName, setTypedName] = useState("");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api<RestoreActivationView>(`/recovery/environments/${environment.id}/activation`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () => cache.invalidateQueries(),
  });
  if (assessment.isPending) return <Loading />;
  if (assessment.isError)
    return <Failure error={assessment.error} retry={() => void assessment.refetch()} />;
  const view = assessment.data;
  const submittable = activationSubmittable({
    assessment: view,
    environmentName: environment.name,
    typedName,
    acknowledged,
    fresh,
  });
  const result = mutation.data;
  return (
    <form
      className="panel project-form"
      aria-label={`Activer l’environnement restauré ${environment.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!submittable) return;
        mutation.mutate(
          activationRequest(
            view,
            { project: project.revision, environment: environment.revision },
            environment.name,
          ),
        );
      }}
    >
      <h4>Activation par le propriétaire</h4>
      {view.pending && (
        <p>
          Une activation a déjà isolé la source mais n’a pas prouvé la promotion
          {view.pending === "unknown" ? " (résultat incertain)" : ""}. Les deux environnements
          restent bloqués ; relancer l’activation la reprend sans refaire l’isolement.
        </p>
      )}
      {view.reasons.length > 0 && (
        <ul aria-label="Conditions bloquantes">
          {view.reasons.map((reason) => (
            <li key={reason}>{activationBlockerLabels[reason]}</li>
          ))}
        </ul>
      )}
      <p>
        L’activation isole d’abord la source (aucune autorité ordinaire), promeut la base restaurée
        puis la désigne comme environnement actif. La source reste conservée comme preuve.
      </p>
      {view.retainedDefinitions.jobs +
        view.retainedDefinitions.backend +
        view.retainedDefinitions.domains >
        0 && (
        <p>
          Restent rattachés à la source isolée, non transférés : {view.retainedDefinitions.jobs}{" "}
          tâche(s), {view.retainedDefinitions.backend} configuration(s) backend,{" "}
          {view.retainedDefinitions.domains} domaine(s).
        </p>
      )}
      <fieldset>
        <legend>Je reconnais que :</legend>
        {view.requiredAcknowledgements.map((item) => (
          <label key={item} htmlFor={`ack-${environment.id}-${item}`}>
            <input
              id={`ack-${environment.id}-${item}`}
              type="checkbox"
              checked={acknowledged.includes(item)}
              onChange={(event) =>
                setAcknowledged((current) =>
                  event.target.checked ? [...current, item] : current.filter((x) => x !== item),
                )
              }
            />{" "}
            {acknowledgementLabels[item]}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`activation-name-${environment.id}`}>
        Saisissez « {environment.name} » pour confirmer
        <Input
          id={`activation-name-${environment.id}`}
          value={typedName}
          autoComplete="off"
          onChange={(event) => setTypedName(event.target.value)}
        />
      </label>
      {!fresh && <p className="muted">Une confirmation récente par clé d’accès est requise.</p>}
      {mutation.isError && <Failure error={mutation.error} />}
      {result && (
        <p role="status" className="success-message">
          {result.state === "activated"
            ? "Environnement restauré activé ; la source reste isolée."
            : "Activation incomplète : la promotion n’est pas prouvée. Les deux environnements restent bloqués ; relancez pour reprendre."}
        </p>
      )}
      <Button type="submit" disabled={!submittable || mutation.isPending}>
        {view.pending ? "Reprendre l’activation" : "Activer l’environnement restauré"}
      </Button>
    </form>
  );
}
