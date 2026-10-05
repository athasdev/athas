/**
 * The navigation commands the focused CodeMirror editor answers itself instead of the
 * engine-neutral fallbacks: LSP selection ranges for Expand/Shrink Selection and the inline
 * references peek. Kept free of editor imports so the keymap layer can read it up front.
 */
export interface ActiveCodeMirrorNavigation {
  ownerId: string;
  /** Returns false when the editor cannot answer, so the caller runs its fallback. */
  expandSelection: () => boolean;
  shrinkSelection: () => boolean;
  peekReferences: () => boolean;
}

let active: ActiveCodeMirrorNavigation | null = null;

export function setActiveCodeMirrorNavigation(navigation: ActiveCodeMirrorNavigation) {
  active = navigation;
}

export function clearActiveCodeMirrorNavigation(ownerId: string) {
  if (active?.ownerId === ownerId) active = null;
}

export function getActiveCodeMirrorNavigation(): ActiveCodeMirrorNavigation | null {
  return active;
}
