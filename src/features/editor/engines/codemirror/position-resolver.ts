import type { EditorView } from "@codemirror/view";
import type { EditorModelPositionResolver } from "../../types/code-editor-view.types";
import { fromEditorPosition } from "./position";

/**
 * Where a model position sits inside the editor's content, for overlays (inline edit, rename box)
 * drawn on top of the editor.
 */
export function createCodeMirrorPositionResolver(
  getView: () => EditorView | null,
): EditorModelPositionResolver {
  return (line, column) => {
    const view = getView();
    if (!view) return null;
    const { doc } = view.state;
    const position = fromEditorPosition(doc, { line, column, offset: 0 });
    const coords = view.coordsAtPos(position);
    const contentLeft = view.contentDOM.getBoundingClientRect().left;
    const left = coords
      ? coords.left - contentLeft
      : (position - doc.lineAt(position).from) * view.defaultCharacterWidth;

    return { top: view.lineBlockAt(position).top, left };
  };
}
