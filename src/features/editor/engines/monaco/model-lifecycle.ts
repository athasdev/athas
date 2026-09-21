import { editor as monacoEditor } from "monaco-editor";
import type * as Monaco from "monaco-editor";

interface SharedMonacoModel {
  model: Monaco.editor.ITextModel;
  sessionId: string;
  contentRevision: number;
  referenceCount: number;
  releaseTimer: ReturnType<typeof globalThis.setTimeout> | null;
}

const sharedModels = new Map<string, SharedMonacoModel>();
const MODEL_RELEASE_GRACE_MS = 5_000;
let nextModelSessionId = 1;

export interface AcquiredMonacoModel {
  model: Monaco.editor.ITextModel;
  sessionId: string;
  contentRevision: number;
  release: () => void;
}

export function acquireMonacoModel(
  content: string,
  languageId: string,
  uri: Monaco.Uri,
  contentRevision = 0,
): AcquiredMonacoModel {
  const key = uri.toString();
  let entry = sharedModels.get(key);
  if (!entry || entry.model.isDisposed()) {
    const model = monacoEditor.getModel(uri) ?? monacoEditor.createModel(content, languageId, uri);
    entry = {
      model,
      sessionId: `monaco-model-${nextModelSessionId++}`,
      contentRevision,
      referenceCount: 0,
      releaseTimer: null,
    };
    sharedModels.set(key, entry);
  }

  const { model } = entry;
  if (entry.releaseTimer !== null) {
    globalThis.clearTimeout(entry.releaseTimer);
    entry.releaseTimer = null;
  }
  entry.referenceCount += 1;

  let released = false;
  return {
    model,
    sessionId: entry.sessionId,
    contentRevision: entry.contentRevision,
    release: () => {
      if (released) return;
      released = true;

      const current = sharedModels.get(key);
      if (!current || current.model !== model) return;

      current.referenceCount -= 1;
      if (current.referenceCount > 0) return;

      current.releaseTimer = globalThis.setTimeout(() => {
        const pending = sharedModels.get(key);
        if (!pending || pending.model !== model || pending.referenceCount > 0) return;

        sharedModels.delete(key);
        if (!model.isDisposed()) {
          model.dispose();
        }
      }, MODEL_RELEASE_GRACE_MS);
    },
  };
}

export function markMonacoModelContentRevision(
  model: Monaco.editor.ITextModel,
  contentRevision: number,
): void {
  for (const entry of sharedModels.values()) {
    if (entry.model === model) {
      entry.contentRevision = contentRevision;
      return;
    }
  }
}
