import type { EditorDocumentChangeEvent } from "../types/editor.types";

type EditorDocumentChangeListener = (event: EditorDocumentChangeEvent) => void;

const listeners = new Set<EditorDocumentChangeListener>();

export function publishEditorDocumentChange(event: EditorDocumentChangeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("Editor document change listener failed:", error);
    }
  }
}

export function subscribeToEditorDocumentChanges(
  listener: EditorDocumentChangeListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
