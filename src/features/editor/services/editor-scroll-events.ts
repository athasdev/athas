type EditorScrollListener = () => void;

const listeners = new Set<EditorScrollListener>();

/** Tells listeners the active editor's scroll offset moved; read it with `getScroll`. */
export function publishEditorScroll(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error("Editor scroll listener failed:", error);
    }
  }
}

export function subscribeToEditorScroll(listener: EditorScrollListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
