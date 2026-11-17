import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import { useEffect, useRef, useState } from "react";
import { type AutosaveOptions, type SaveStatus, useAutosave } from "../lib/autosave";
import type { BoardDetail, BoardFileData, SceneData } from "../lib/contracts";

const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|svg\+xml)$/;

/** Cheap change fingerprint: Excalidraw bumps an element's `version` on every edit. */
function fingerprint(elements: readonly ExcalidrawElement[], background: string | undefined) {
  let sum = 0;
  for (const element of elements) sum += element.version + (element.isDeleted ? 1 : 0);
  return `${elements.length}:${sum}:${background ?? ""}`;
}

function toScene(elements: readonly ExcalidrawElement[], appState: AppState): SceneData {
  return {
    // Deleted elements only matter for live collaboration; they are not worth storing.
    // Excalidraw leaves `undefined` properties on elements; the JSON round trip drops them,
    // which is also exactly what the server will store.
    elements: JSON.parse(
      JSON.stringify(elements.filter((element) => !element.isDeleted)),
    ) as SceneData["elements"],
    appState: {
      viewBackgroundColor: appState.viewBackgroundColor,
      gridSize: appState.gridSize ?? null,
    },
  };
}

function toFiles(elements: readonly ExcalidrawElement[], files: BinaryFiles): BoardFileData[] {
  const used = new Set<string>();
  for (const element of elements)
    if (!element.isDeleted && element.type === "image" && element.fileId) used.add(element.fileId);
  const result: BoardFileData[] = [];
  for (const id of used) {
    const file = files[id];
    if (file && IMAGE_MIME.test(file.mimeType))
      result.push({ fileId: id, mimeType: file.mimeType, dataUrl: file.dataURL });
  }
  return result;
}

export interface BoardEditorProps {
  board: BoardDetail;
  save: AutosaveOptions["save"];
  onStatus: (status: SaveStatus) => void;
}

export default function BoardEditor({ board, save, onStatus }: BoardEditorProps) {
  const readOnly = board.role === "viewer";
  // The loaded scene is only the starting point; later edits live inside Excalidraw.
  const [initialData] = useState(() => ({
    elements: board.scene.elements as unknown as ExcalidrawElement[],
    appState: {
      viewBackgroundColor: board.scene.appState.viewBackgroundColor ?? "#ffffff",
      gridSize: board.scene.appState.gridSize ?? undefined,
    },
    files: Object.fromEntries(
      board.files.map((file) => [
        file.fileId,
        { id: file.fileId, mimeType: file.mimeType, dataURL: file.dataUrl, created: Date.now() },
      ]),
    ) as unknown as BinaryFiles,
    scrollToContent: true,
  }));
  const { status, schedule } = useAutosave({
    initialRevision: board.revision,
    readOnly,
    knownFileIds: board.files.map((file) => file.fileId),
    save,
  });
  useEffect(() => onStatus(status), [status, onStatus]);
  const baseline = useRef(
    fingerprint(initialData.elements, initialData.appState.viewBackgroundColor),
  );

  return (
    <div className="editor-canvas">
      <Excalidraw
        initialData={initialData}
        viewModeEnabled={readOnly}
        theme="dark"
        langCode="fr-FR"
        onChange={(elements, appState, files) => {
          const next = fingerprint(elements, appState.viewBackgroundColor);
          if (next === baseline.current) return;
          baseline.current = next;
          schedule(toScene(elements, appState), toFiles(elements, files));
        }}
      />
    </div>
  );
}
