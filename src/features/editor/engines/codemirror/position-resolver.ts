import type { EditorView } from "@codemirror/view";
import type { EditorModelPositionResolver } from "../../view-model/view-layout";
import type { LineSeparator } from "./document-change";
import { fromEditorPosition, toEditorPosition } from "./position";

/**
 * Where a model position sits inside the editor's content, for overlays (inline edit, rename box)
 * drawn on top of the editor.
 */
export function createCodeMirrorPositionResolver(
  getView: () => EditorView | null,
  getSeparator: () => LineSeparator,
): EditorModelPositionResolver {
  return (line, column) => {
    const view = getView();
    if (!view) return null;
    const { doc } = view.state;
    const position = fromEditorPosition(doc, { line, column, offset: 0 });
    const docLine = doc.lineAt(position);
    const block = view.lineBlockAt(position);
    const coords = view.coordsAtPos(position);
    const contentLeft = view.contentDOM.getBoundingClientRect().left;
    const left = coords
      ? coords.left - contentLeft
      : (position - docLine.from) * view.defaultCharacterWidth;
    const modelLine = docLine.number - 1;
    const height = view.defaultLineHeight;

    return {
      ...toEditorPosition(doc, position, getSeparator()),
      viewLine: modelLine,
      modelLine,
      top: block.top,
      left,
      height,
      segment: {
        viewLine: modelLine,
        modelLine,
        startColumn: 0,
        endColumn: docLine.length,
        top: block.top,
        height,
      },
    };
  };
}
