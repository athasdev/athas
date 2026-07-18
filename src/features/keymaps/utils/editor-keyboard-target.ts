export function isEditorKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.closest("[data-monaco-editor-scroll]") !== null ||
    target.closest(".monaco-editor-shell") !== null ||
    target.closest(".monaco-editor") !== null ||
    target.closest("[data-notebook-editor]") !== null
  );
}
