import type { KeymapContext } from "../types/keymaps.types";

interface EffectiveKeymapContextOptions {
  isEditorTarget: boolean;
  isTerminalTarget: boolean;
}

export function resolveEffectiveKeymapContexts(
  contexts: Partial<KeymapContext>,
  { isEditorTarget, isTerminalTarget }: EffectiveKeymapContextOptions,
): Partial<KeymapContext> {
  return {
    ...contexts,
    editorFocus: isEditorTarget || contexts.editorFocus,
    terminalFocus: isTerminalTarget || contexts.terminalFocus,
  };
}
