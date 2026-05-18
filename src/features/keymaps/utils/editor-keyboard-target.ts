export function isEditorKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.classList.contains("editor-textarea") ||
    target.closest("[data-monaco-editor-scroll]") !== null ||
    target.closest(".monaco-editor-shell") !== null ||
    target.closest(".monaco-editor") !== null ||
    target.closest("[data-large-editor-scroll]") !== null
  );
}
