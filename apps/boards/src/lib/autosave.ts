import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardFileData, SceneData } from "./contracts";

export type SaveStatus = "saved" | "dirty" | "saving" | "conflict" | "error" | "readonly";

export interface SaveOutcome {
  ok: boolean;
  code?: string;
  revision?: number;
}
export interface AutosaveOptions {
  initialRevision: number;
  readOnly: boolean;
  /** Ids of images already stored on the server. */
  knownFileIds: readonly string[];
  save: (input: SaveRequest) => Promise<SaveOutcome>;
  debounceMs?: number;
}
export interface SaveRequest {
  expectedRevision: number;
  scene: SceneData;
  files: BoardFileData[];
}

const DEFAULT_DEBOUNCE_MS = 1500;
const MAX_FILES_PER_SAVE = 20;

/**
 * Debounced optimistic-concurrency autosave. The caller reports the latest scene with
 * `schedule`; at most one save is in flight, and a CONFLICT stops saving until the page reloads.
 */
export function useAutosave(options: AutosaveOptions) {
  const [status, setStatus] = useState<SaveStatus>(options.readOnly ? "readonly" : "saved");
  const revision = useRef(options.initialRevision);
  const latest = useRef<{ scene: SceneData; files: BoardFileData[] } | undefined>(undefined);
  const known = useRef(new Set(options.knownFileIds));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef(false);
  const stopped = useRef(false);
  const saveRef = useRef(options.save);
  saveRef.current = options.save;
  const debounce = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const flush = useCallback(async () => {
    if (inflight.current || stopped.current || !latest.current) return;
    const pending = latest.current;
    latest.current = undefined;
    const fresh = pending.files
      .filter((file) => !known.current.has(file.fileId))
      .slice(0, MAX_FILES_PER_SAVE);
    inflight.current = true;
    setStatus("saving");
    let outcome: SaveOutcome;
    try {
      outcome = await saveRef.current({
        expectedRevision: revision.current,
        scene: pending.scene,
        files: fresh,
      });
    } catch {
      outcome = { ok: false, code: "NETWORK" };
    }
    inflight.current = false;
    if (outcome.ok) {
      revision.current = outcome.revision ?? revision.current + 1;
      for (const file of fresh) known.current.add(file.fileId);
      // More images than one save may carry, or changes made while saving: continue.
      const remaining = pending.files.some((file) => !known.current.has(file.fileId));
      if (latest.current || remaining) {
        latest.current ??= pending;
        void flush();
      } else setStatus("saved");
      return;
    }
    latest.current ??= pending;
    if (outcome.code === "CONFLICT") {
      stopped.current = true;
      setStatus("conflict");
    } else {
      setStatus("error");
      timer.current = setTimeout(() => void flush(), debounce * 4);
    }
  }, [debounce]);

  const schedule = useCallback(
    (scene: SceneData, files: BoardFileData[]) => {
      if (options.readOnly || stopped.current) return;
      latest.current = { scene, files };
      setStatus((current) => (current === "saving" ? current : "dirty"));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), debounce);
    },
    [options.readOnly, debounce, flush],
  );

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current || inflight.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { status, schedule };
}
