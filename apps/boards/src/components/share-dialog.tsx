import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { OutcomeError, unwrap } from "../lib/outcome";
import { addMemberFn, listMembersFn, removeMemberFn, setMemberRoleFn } from "../server/api";

const ROLE_LABEL = { owner: "Propriétaire", editor: "Éditeur", viewer: "Lecteur" } as const;

export function ShareDialog({
  boardId,
  isOwner,
  currentUserId,
  open,
  onClose,
}: {
  boardId: string;
  isOwner: boolean;
  currentUserId: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const key = ["members", boardId] as const;
  const members = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await listMembersFn({ data: { boardId } })),
    enabled: open,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: async () => unwrap(await addMemberFn({ data: { boardId, email, role } })),
    onSuccess: async () => {
      setEmail("");
      await refresh();
    },
  });
  const change = useMutation({
    mutationFn: async (input: { userId: string; role: "editor" | "viewer" }) =>
      unwrap(await setMemberRoleFn({ data: { boardId, ...input } })),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (userId: string) =>
      unwrap(await removeMemberFn({ data: { boardId, userId } })),
    onSuccess: refresh,
  });

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }
  const failure = [members.error, add.error, change.error, remove.error].find(Boolean);

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="share-title">
      <h2 id="share-title">Partager ce board</h2>
      <ul className="members">
        {members.data?.map((member) => (
          <li key={member.userId}>
            <span>
              {member.name} <span className="muted">{member.email}</span>
            </span>
            <span className="row">
              {isOwner && member.role !== "owner" ? (
                <select
                  aria-label={`Rôle de ${member.name}`}
                  value={member.role}
                  onChange={(event) =>
                    change.mutate({
                      userId: member.userId,
                      role: event.target.value as "editor" | "viewer",
                    })
                  }
                >
                  <option value="editor">Éditeur</option>
                  <option value="viewer">Lecteur</option>
                </select>
              ) : (
                <span className="pill">{ROLE_LABEL[member.role]}</span>
              )}
              {member.role !== "owner" && (isOwner || member.userId === currentUserId) && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => remove.mutate(member.userId)}
                >
                  {member.userId === currentUserId ? "Quitter" : "Retirer"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {isOwner && (
        <form className="row" onSubmit={submit}>
          <input
            type="email"
            aria-label="Adresse e-mail du compte à inviter"
            placeholder="adresse@exemple.fr"
            value={email}
            required
            onChange={(event) => setEmail(event.target.value)}
          />
          <select
            aria-label="Rôle"
            value={role}
            onChange={(event) => setRole(event.target.value as "editor" | "viewer")}
          >
            <option value="editor">Éditeur</option>
            <option value="viewer">Lecteur</option>
          </select>
          <button className="primary" type="submit" disabled={add.isPending}>
            Ajouter
          </button>
        </form>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure instanceof OutcomeError ? failure.message : "Action impossible."}
        </p>
      )}
      <p className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      </p>
    </dialog>
  );
}
