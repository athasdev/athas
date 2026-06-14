import { editor as monacoEditor } from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

declare global {
  interface Window {
    MonacoEnvironment?: {
      getWorker: (_workerId: string, label: string) => Worker;
    };
    __athasMonacoContextMenuInitialized?: boolean;
  }
}

if (typeof window !== "undefined") {
  if (!window.__athasMonacoContextMenuInitialized) {
    window.__athasMonacoContextMenuInitialized = true;
    for (const editor of monacoEditor.getEditors()) {
      editor.updateOptions({ contextmenu: false });
    }
    monacoEditor.onDidCreateEditor((editor) => {
      editor.updateOptions({ contextmenu: false });
    });
  }

  window.MonacoEnvironment = {
    getWorker: (_workerId, label) => {
      if (label === "json") return new JsonWorker();
      if (label === "css" || label === "scss" || label === "less") return new CssWorker();
      if (label === "html" || label === "handlebars" || label === "razor") {
        return new HtmlWorker();
      }
      if (label === "typescript" || label === "javascript") return new TsWorker();
      return new EditorWorker();
    },
  };
}
