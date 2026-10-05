import { isNativeTextInputTarget } from "@/utils/keyboard/text-input-target";

export function isEditorKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  if (target.closest('[data-editor-engine="codemirror"]') !== null) {
    // Panels (find, vim's command line) keep their fields' native keys, and so do the text
    // fields of overlays hosted around the editor.
    if (target.closest(".cm-panels") !== null) return false;
    return target.closest(".cm-editor") !== null || !isNativeTextInputTarget(target, null);
  }

  return (
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
