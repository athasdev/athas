import { useMemo } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useKeymapStore } from "../stores/keymaps.store";
import type { Command } from "../types/keymaps.types";
import { getEffectiveKeybindings } from "../utils/effective-keymaps";
import { findConflictingKeybindings } from "../utils/keybinding-conflicts";
import { keymapRegistry } from "../utils/registry";

interface ConflictInfo {
  hasConflict: boolean;
  conflictingCommands: Command[];
}

export function useKeybindingConflicts(
  keybinding: string,
  currentCommandId: string,
  whenClause?: string,
): ConflictInfo {
  const userKeybindings = useKeymapStore.use.keybindings();
  const preset = useSettingsStore((state) => state.settings.keybindingPreset);

  return useMemo(() => {
    const conflicting = findConflictingKeybindings({
      keybinding,
      commandId: currentCommandId,
      when: whenClause,
      effectiveKeybindings: getEffectiveKeybindings({
        preset,
        registryKeybindings: keymapRegistry.getAllKeybindings(),
        userKeybindings,
      }),
    });

    const conflictingCommands = conflicting
      .map((binding) => keymapRegistry.getCommand(binding.command))
      .filter((command): command is Command => command !== undefined);

    return {
      hasConflict: conflictingCommands.length > 0,
      conflictingCommands,
    };
  }, [keybinding, userKeybindings, preset, currentCommandId, whenClause]);
}
