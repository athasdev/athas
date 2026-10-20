/**
 * Reactive lookup for the active keybinding of a command.
 *
 * Composes the user override (from `useKeymapStore`) with the default
 * (from `keymapRegistry`). Every caller shares one table of effective
 * bindings, rebuilt only when the preset, the user's bindings or the
 * registered defaults change, so many shortcut hints stay cheap.
 */

import type { Keybinding } from "../types/keymaps.types";
import type { Settings } from "@/features/settings/types/settings.types";
import { useKeymapStore } from "../stores/keymaps.store";
import { getEffectiveKeybindingsByCommand } from "../services/effective-keymaps";
import { keymapRegistry } from "../services/keymap-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

let cached: {
  preset: Settings["keybindingPreset"];
  registryVersion: number;
  userKeybindings: Keybinding[];
  byCommand: Map<string, Keybinding>;
} | null = null;

function getBindingsByCommand(
  preset: Settings["keybindingPreset"],
  userKeybindings: Keybinding[],
): Map<string, Keybinding> {
  const registryVersion = keymapRegistry.getKeybindingsVersion();
  if (
    !cached ||
    cached.preset !== preset ||
    cached.registryVersion !== registryVersion ||
    cached.userKeybindings !== userKeybindings
  ) {
    cached = {
      preset,
      registryVersion,
      userKeybindings,
      byCommand: getEffectiveKeybindingsByCommand({
        preset,
        registryKeybindings: keymapRegistry.getAllKeybindings(),
        userKeybindings,
      }),
    };
  }
  return cached.byCommand;
}

export function useCommandShortcut(commandId?: string): string | undefined {
  const userKeybindings = useKeymapStore((state) => state.keybindings);
  const preset = useSettingsStore((state) => state.settings.keybindingPreset);
  if (!commandId) return undefined;

  return getBindingsByCommand(preset, userKeybindings).get(commandId)?.key;
}
