import type * as Monaco from "monaco-editor";
import { toast } from "sonner";
import { navigateToLspLocation } from "../../lsp/location-navigation";
import { filePathFromUri } from "../../lsp/workspace-edit";
import { useBufferStore } from "../../stores/buffer.store";
import { filePathFromAthasModelUri } from "./model-uri";

export function filePathFromMonacoUri(uri: Monaco.Uri): string | null {
  if (uri.scheme === "file") return filePathFromUri(uri.toString());
  if (uri.scheme === "athas") return filePathFromAthasModelUri(uri.path, uri.query);
  if (uri.scheme === "jdt") return uri.toString();
  return null;
}

export const athasEditorOpener: Monaco.editor.ICodeEditorOpener = {
  async openCodeEditor(source, resource, selectionOrPosition) {
    const filePath = filePathFromMonacoUri(resource);
    const model = source.getModel();
    if (!filePath || !model) return false;
    const sourcePath = filePathFromMonacoUri(model.uri);
    const sourceBufferId = new URLSearchParams(model.uri.query).get("buffer");
    const sourceBuffer = useBufferStore
      .getState()
      .buffers.find((buffer) => buffer.id === sourceBufferId || buffer.path === sourcePath);
    if (!sourceBuffer) return false;

    const selection =
      selectionOrPosition && "startLineNumber" in selectionOrPosition
        ? selectionOrPosition
        : {
            startLineNumber: selectionOrPosition?.lineNumber ?? 1,
            startColumn: selectionOrPosition?.column ?? 1,
            endLineNumber: selectionOrPosition?.lineNumber ?? 1,
            endColumn: selectionOrPosition?.column ?? 1,
          };
    const cursor = source.getPosition() ?? { lineNumber: 1, column: 1 };

    try {
      await navigateToLspLocation(
        {
          uri: filePath,
          range: {
            start: { line: selection.startLineNumber - 1, character: selection.startColumn - 1 },
            end: { line: selection.endLineNumber - 1, character: selection.endColumn - 1 },
          },
        },
        {
          bufferId: sourceBuffer.id,
          filePath: sourceBuffer.path,
          line: cursor.lineNumber - 1,
          column: cursor.column - 1,
          offset: model.getOffsetAt(cursor),
          scrollTop: source.getScrollTop(),
          scrollLeft: source.getScrollLeft(),
        },
      );
    } catch (error) {
      toast.error("Could not open definition", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  },
};
