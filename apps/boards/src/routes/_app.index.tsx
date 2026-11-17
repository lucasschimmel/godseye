import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { OutcomeError, unwrap } from "../lib/outcome";
import { createBoardFn, deleteBoardFn, listBoardsFn } from "../server/api";

export const Route = createFileRoute("/_app/")({ component: BoardList });

const ROLE_LABEL = { owner: "Propriétaire", editor: "Éditeur", viewer: "Lecteur" } as const;
const BOARDS_KEY = ["boards"] as const;

function BoardList() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const boards = useQuery({
    queryKey: BOARDS_KEY,
    queryFn: async () => unwrap(await listBoardsFn()),
  });
  const create = useMutation({
    mutationFn: async (boardName: string) =>
      unwrap(await createBoardFn({ data: { name: boardName } })),
    onSuccess: async () => {
      setName("");
      await queryClient.invalidateQueries({ queryKey: BOARDS_KEY });
    },
  });
  const remove = useMutation({
    mutationFn: async (boardId: string) => unwrap(await deleteBoardFn({ data: { boardId } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: BOARDS_KEY }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  }
  const failure = [boards.error, create.error, remove.error].find(Boolean);

  return (
    <main className="page">
      <div className="page-head">
        <h1>Mes boards</h1>
        <form className="row" onSubmit={submit}>
          <input
            aria-label="Nom du nouveau board"
            placeholder="Nom du board"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
          />
          <button className="primary" type="submit" disabled={create.isPending || !name.trim()}>
            Créer
          </button>
        </form>
      </div>
      {failure && (
        <p className="error" role="alert">
          {failure instanceof OutcomeError ? failure.message : "Action impossible."}
        </p>
      )}
      {boards.isPending && <p className="muted">Chargement…</p>}
      {boards.data?.length === 0 && (
        <p className="muted">Aucun board pour l’instant. Créez-en un pour commencer.</p>
      )}
      <div className="grid">
        {boards.data?.map((board) => (
          <div key={board.id} className="card">
            <Link to="/boards/$boardId" params={{ boardId: board.id }} className="card-link">
              <h2>{board.name}</h2>
            </Link>
            <div className="row">
              <span className="pill">{ROLE_LABEL[board.role]}</span>
              <span className="muted">{new Date(board.updatedAt).toLocaleString("fr-FR")}</span>
            </div>
            {board.role === "owner" && (
              <button
                className="danger"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Supprimer « ${board.name} » et ses images ? Irréversible.`))
                    remove.mutate(board.id);
                }}
              >
                Supprimer
              </button>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
