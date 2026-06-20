import { editor as monacoEditor } from "monaco-editor";
import type * as Monaco from "monaco-editor";

export function syncContainedEditorFontOptions(
  container: HTMLElement,
  options: Pick<Monaco.editor.IEditorOptions, "fontFamily" | "fontSize" | "lineHeight">,
) {
  for (const editor of monacoEditor.getEditors()) {
    const editorElement = editor.getDomNode();
    if (!editorElement || !container.contains(editorElement)) continue;
    editor.updateOptions(options);
  }
}
