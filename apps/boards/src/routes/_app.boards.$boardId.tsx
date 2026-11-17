import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClientOnly, createFileRoute, Link, notFound } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { ShareDialog } from "../components/share-dialog";
import type { SaveRequest, SaveStatus } from "../lib/autosave";
import { OutcomeError } from "../lib/outcome";
import { getBoardFn, renameBoardFn, saveSceneFn } from "../server/api";

// Excalidraw touches `window` on import: it is loaded in the browser only.
const BoardEditor = lazy(() => import("../components/board-editor"));

export const Route = createFileRoute("/_app/boards/$boardId")({
  loader: async ({ params }) => {
    const result = await getBoardFn({ data: { boardId: params.boardId } });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") throw notFound();
      throw new OutcomeError(result.code, result.message);
    }
    return result.value;
  },
  // A board is a working copy: never serve a cached one when coming back to it.
  gcTime: 0,
  staleTime: 0,
  component: BoardPage,
});

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: "Enregistré",
  dirty: "Modifications en attente…",
  saving: "Enregistrement…",
  conflict: "Conflit de version",
  error: "Échec de l’enregistrement, nouvel essai…",
  readonly: "Lecture seule",
};

function BoardPage() {
  const board = Route.useLoaderData();
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>(board.role === "viewer" ? "readonly" : "saved");
  const [sharing, setSharing] = useState(false);
  const [name, setName] = useState(board.name);
  const rename = useMutation({
    mutationFn: async (next: string) => {
      const result = await renameBoardFn({ data: { boardId: board.id, name: next } });
      if (!result.ok) throw new OutcomeError(result.code, result.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["boards"] }),
  });

  async function save(input: SaveRequest) {
    const result = await saveSceneFn({ data: { boardId: board.id, ...input } });
    return result.ok
      ? { ok: true as const, revision: result.value.revision }
      : { ok: false as const, code: result.code };
  }

  return (
    <>
      {status === "conflict" && (
        <div className="banner" role="alert">
          <span>
            Ce board a été modifié ailleurs. Vos dernières modifications n’ont pas été enregistrées.
          </span>
          <button type="button" onClick={() => window.location.reload()}>
            Recharger la dernière version
          </button>
        </div>
      )}
      <div className="editor-shell">
        <div className="editor-bar">
          <div className="row">
            <Link to="/">← Mes boards</Link>
            {board.role === "owner" ? (
              <input
                aria-label="Nom du board"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  const next = name.trim();
                  if (next && next !== board.name) rename.mutate(next);
                  else setName(board.name);
                }}
              />
            ) : (
              <strong>{board.name}</strong>
            )}
          </div>
          <div className="row">
            <span>
              <span className={`dot ${status}`} aria-hidden="true" />
              {STATUS_LABEL[status]}
            </span>
            <button type="button" onClick={() => setSharing(true)}>
              Partager
            </button>
          </div>
        </div>
        <ClientOnly fallback={<p className="page muted">Chargement de l’éditeur…</p>}>
          <Suspense fallback={<p className="page muted">Chargement de l’éditeur…</p>}>
            <BoardEditor key={board.id} board={board} save={save} onStatus={setStatus} />
          </Suspense>
        </ClientOnly>
      </div>
      <ShareDialog
        boardId={board.id}
        isOwner={board.role === "owner"}
        currentUserId={user.id}
        open={sharing}
        onClose={() => setSharing(false)}
      />
    </>
  );
}
