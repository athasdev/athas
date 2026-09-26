export function isEditorKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.closest("[data-monaco-editor-scroll]") !== null ||
    target.closest(".monaco-editor-shell") !== null ||
    target.closest(".monaco-editor") !== null ||
    target.closest("[data-notebook-editor]") !== null ||
    target.closest("[data-markdown-preview]") !== null
  );
}

export function getMarkdownPreviewKeyboardTarget(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) {
    const preview = target.closest<HTMLElement>("[data-markdown-preview]");
    if (preview) return preview;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && activeElement !== document.body) {
    return activeElement.closest<HTMLElement>("[data-markdown-preview]");
  }

  const anchor = window.getSelection()?.anchorNode;
  const element = anchor instanceof Element ? anchor : anchor?.parentElement;
  return element?.closest<HTMLElement>("[data-markdown-preview]") ?? null;
}
