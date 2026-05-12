import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import type { EditorContent } from "@/features/panes/types/pane-content";
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
  return {
    content: editor.content,
    path: editor.path || null,
    language: editor.languageOverride ?? editor.language ?? "plaintext",
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

export function codesnapFromSelection(): void {
  const buf = readActiveEditorBuffer();
  if (!buf) return;
  const sel = readActiveSelection();
  const snap = buildSnapshotFromSelection(sel, buf) ?? buildSnapshotFromBuffer(buf);
  if (!snap) return;
  useBufferStore.getState().actions.openContent({ type: "codeSnap", snapshot: snap });
}

export function codesnapFromActiveBuffer(): void {
  const buf = readActiveEditorBuffer();
  if (!buf) return;
  const snap = buildSnapshotFromBuffer(buf);
  if (!snap) return;
  useBufferStore.getState().actions.openContent({ type: "codeSnap", snapshot: snap });
}
