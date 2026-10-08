import { useEffect, useState } from "react";
import { subscribeToEditorDocumentChanges } from "../services/editor-document-events";
import { getBufferText } from "../services/open-buffer-text";
import { getPythonScriptCells, type PythonScriptCell } from "./python-script-cells";
import { getRMarkdownChunks, type RMarkdownChunk } from "./rmarkdown-chunks";

export type ScriptCellKind = "python" | "rmarkdown";

export interface ScriptCells {
  pythonScriptCells: PythonScriptCell[];
  rMarkdownChunks: RMarkdownChunk[];
}

interface ScriptCellsState extends ScriptCells {
  bufferId: string | null;
  kind: ScriptCellKind | null;
  content: string;
}

/** How long edits must pause before the run-cell markers are parsed again. */
export const SCRIPT_CELL_REFRESH_DELAY_MS = 200;

function readScriptText(bufferId: string | null): string {
  return bufferId ? (getBufferText(bufferId) ?? "") : "";
}

function parseScriptCells(
  bufferId: string | null,
  kind: ScriptCellKind | null,
  content = kind ? readScriptText(bufferId) : "",
): ScriptCellsState {
  return {
    bufferId,
    kind,
    content,
    pythonScriptCells: kind === "python" ? getPythonScriptCells(content) : [],
    rMarkdownChunks: kind === "rmarkdown" ? getRMarkdownChunks(content) : [],
  };
}

/**
 * Python cells or R Markdown chunks of a buffer, parsed when it opens and again once edits pause,
 * so typing neither re-renders the caller nor re-parses the file on every keystroke.
 */
export function useScriptCells(bufferId: string | null, kind: ScriptCellKind | null): ScriptCells {
  const [cells, setCells] = useState(() => parseScriptCells(bufferId, kind));
  let current = cells;
  if (cells.bufferId !== bufferId || cells.kind !== kind) {
    current = parseScriptCells(bufferId, kind);
    setCells(current);
  }

  useEffect(() => {
    if (!bufferId || !kind) return;
    const refresh = () =>
      setCells((previous) => {
        const content = readScriptText(bufferId);
        return previous.bufferId === bufferId &&
          previous.kind === kind &&
          previous.content === content
          ? previous
          : parseScriptCells(bufferId, kind, content);
      });

    // Catches an edit that landed between the first parse and this subscription.
    refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToEditorDocumentChanges((event) => {
      if (event.bufferId !== bufferId) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh();
      }, SCRIPT_CELL_REFRESH_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [bufferId, kind]);

  return current;
}
