import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { getLanguageIdFromPath } from "@/features/editor/utils/language-id";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import type { EditorContent } from "@/features/panes/types/pane-content";
import type { SourceSnapshot } from "../types";
import { buildSnapshotFromBuffer, buildSnapshotFromSelection } from "./snapshot-from-selection";

function readActiveEditorBuffer(): {
  content: string;
  path: string | null;
  language: string;
} | null {
  const state = useBufferStore.getState();
  const buf = state.buffers.find((b) => b.id === state.activeBufferId);
  if (!buf || buf.type !== "editor") return null;
  const editor = buf as EditorContent;
  if (typeof editor.content !== "string") return null;
  // Derive the language from the path (matches the editor's tokenizer wiring);
  // the buffer's `language` field can be set to "text" for many code files.
  const pathLang = editor.path ? getLanguageIdFromPath(editor.path) : null;
  return {
    content: editor.content,
    path: editor.path || null,
    language: editor.languageOverride ?? pathLang ?? editor.language ?? "plaintext",
  };
}

function readActiveSelection(): {
  start: { line: number; column: number };
  end: { line: number; column: number };
} | null {
  // useEditorStateStore holds the live selection for the currently active editor instance.
  const sel = useEditorStateStore.getState().selection;
  if (!sel) return null;
  return {
    start: { line: sel.start.line, column: sel.start.column },
    end: { line: sel.end.line, column: sel.end.column },
  };
}

/**
 * Open a CodeSnap tab in a horizontal split to the right of the active pane,
 * so the source and the styled preview are visible side-by-side. Falls back to
 * opening in the active pane if the split fails (e.g. layout constraints).
 */
function openCodesnapSplitRight(snapshot: SourceSnapshot): void {
  const paneActions = usePaneStore.getState().actions;
  const originalPaneId = usePaneStore.getState().activePaneId;

  // Create the split first, then make it active so openContent lands the buffer there.
  const newPaneId = paneActions.splitPane(originalPaneId, "horizontal", undefined, "after");
  if (newPaneId) {
    paneActions.setActivePane(newPaneId);
  }
  useBufferStore.getState().actions.openContent({ type: "codeSnap", snapshot });
}

export function codesnapFromSelection(): void {
  const buf = readActiveEditorBuffer();
  if (!buf) return;
  const sel = readActiveSelection();
  const snap = buildSnapshotFromSelection(sel, buf) ?? buildSnapshotFromBuffer(buf);
  if (!snap) return;
  openCodesnapSplitRight(snap);
}

export function codesnapFromActiveBuffer(): void {
  const buf = readActiveEditorBuffer();
  if (!buf) return;
  const snap = buildSnapshotFromBuffer(buf);
  if (!snap) return;
  openCodesnapSplitRight(snap);
}
