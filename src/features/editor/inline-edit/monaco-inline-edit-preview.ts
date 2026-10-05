import { editor as monacoEditor, Range } from "monaco-editor";
import type * as Monaco from "monaco-editor";
import "./inline-edit-preview.css";
import type { InlineEditPreview } from "./inline-edit-preview";

export type { InlineEditPreview };

/**
 * Shows a proposed inline edit as a diff: the affected lines are tinted as removed and the
 * resulting lines render in a view zone underneath. Returns a function that removes both.
 */
export function showMonacoInlineEditPreview(
  editor: Monaco.editor.ICodeEditor,
  preview: InlineEditPreview,
): () => void {
  const model = editor.getModel();
  if (!model || model.isDisposed()) return () => {};

  const start = model.getPositionAt(preview.startOffset);
  const end = model.getPositionAt(preview.endOffset);
  const firstLine = start.lineNumber;
  const lastLine = end.lineNumber;
  const resultText = `${model.getValueInRange(
    new Range(firstLine, 1, start.lineNumber, start.column),
  )}${preview.editedText}${model.getValueInRange(
    new Range(end.lineNumber, end.column, lastLine, model.getLineMaxColumn(lastLine)),
  )}`;
  const resultLines = resultText.split(/\r?\n/);

  const decorations = editor.createDecorationsCollection([
    {
      range: new Range(firstLine, 1, lastLine, model.getLineMaxColumn(lastLine)),
      options: {
        isWholeLine: true,
        className: "inline-edit-preview-removed",
        linesDecorationsClassName: "inline-edit-preview-removed-glyph",
        stickiness: monacoEditor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    },
  ]);

  const domNode = document.createElement("div");
  domNode.className = "inline-edit-preview-added";
  domNode.setAttribute("aria-label", "Proposed edit");
  editor.applyFontInfo(domNode);
  domNode.textContent = resultText;

  let disposed = false;
  void monacoEditor
    .colorize(resultText, model.getLanguageId(), {
      tabSize: model.getOptions().tabSize,
    })
    .then((html) => {
      if (disposed) return;
      domNode.innerHTML = html;
    })
    .catch(() => {});

  let zoneId: string | null = null;
  editor.changeViewZones((accessor) => {
    zoneId = accessor.addZone({
      afterLineNumber: lastLine,
      heightInLines: resultLines.length,
      domNode,
      suppressMouseDown: true,
    });
  });
  if (preview.reveal) {
    editor.revealLinesInCenterIfOutsideViewport(firstLine, lastLine + resultLines.length);
  }

  return () => {
    if (disposed) return;
    disposed = true;
    decorations.clear();
    editor.changeViewZones((accessor) => {
      if (zoneId) accessor.removeZone(zoneId);
    });
  };
}
