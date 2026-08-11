import { editor as monacoEditor } from "monaco-editor";
import type * as Monaco from "monaco-editor";

interface SharedMonacoModel {
  model: Monaco.editor.ITextModel;
  referenceCount: number;
}

const sharedModels = new Map<string, SharedMonacoModel>();

export interface AcquiredMonacoModel {
  model: Monaco.editor.ITextModel;
  release: () => void;
}

export function acquireMonacoModel(
  content: string,
  languageId: string,
  uri: Monaco.Uri,
): AcquiredMonacoModel {
  const key = uri.toString();
  let entry = sharedModels.get(key);
  if (!entry || entry.model.isDisposed()) {
    const model = monacoEditor.getModel(uri) ?? monacoEditor.createModel(content, languageId, uri);
    entry = { model, referenceCount: 0 };
    sharedModels.set(key, entry);
  }

  const { model } = entry;
  entry.referenceCount += 1;

  let released = false;
  return {
    model,
    release: () => {
      if (released) return;
      released = true;

      const current = sharedModels.get(key);
      if (!current || current.model !== model) return;

      current.referenceCount -= 1;
      if (current.referenceCount > 0) return;

      sharedModels.delete(key);
      if (!model.isDisposed()) {
        model.dispose();
      }
    },
  };
}
