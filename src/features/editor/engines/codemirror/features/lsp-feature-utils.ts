import type { EditorView } from "@codemirror/view";
import { useLspStore } from "../../../lsp/stores/lsp.store";
import type { JumpListEntry } from "../../../stores/jump-list.store";
import type { CodeMirrorHost } from "../host";
import { toEditorPosition } from "../position";

/** Changes whenever the language servers or any open document's server-side state change. */
export function useLspRevision(): string {
  return useLspStore((state) => {
    const { status, activeWorkspaces, documentRevision } = state.lspStatus;
    return `${status}:${activeWorkspaces.join("|")}:${documentRevision}`;
  });
}

/** Where a jump from `position` in the host's editor starts, for Go Back. */
export function jumpOrigin(
  host: CodeMirrorHost,
  view: EditorView,
  position: number,
): Omit<JumpListEntry, "timestamp"> {
  return {
    bufferId: host.bufferId,
    filePath: host.filePath,
    ...toEditorPosition(view.state.doc, position, host.getSeparator()),
    scrollTop: view.scrollDOM.scrollTop,
    scrollLeft: view.scrollDOM.scrollLeft,
  };
}
