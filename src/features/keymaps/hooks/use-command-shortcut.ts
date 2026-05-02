/**
 * Reactive lookup for the active keybinding of a command.
 *
 * Composes the user override (from `useKeymapStore`) with the default
 * (from `keymapRegistry`). The selector returns a primitive string so
 * reference equality short-circuits re-renders in the common case.
 */

import { useKeymapStore } from "../stores/store";
import { getEffectiveKeybindingForCommand } from "../utils/effective-keymaps";
import { keymapRegistry } from "../utils/registry";
import { useSettingsStore } from "@/features/settings/store";

export function useCommandShortcut(commandId?: string): string | undefined {
  const userKeybindings = useKeymapStore((state) => state.keybindings);
  const preset = useSettingsStore((state) => state.settings.keybindingPreset);
  if (!commandId) return undefined;

  return getEffectiveKeybindingForCommand({
    commandId,
    preset,
    registryKeybindings: keymapRegistry.getAllKeybindings(),
    userKeybindings,
  })?.key;
}
